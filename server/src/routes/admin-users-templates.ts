import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { ScoreStatus, UserRole } from "@prisma/client";
import { prisma } from "../db.js";
import type { AuthRequest } from "../types.js";
import { broadcast } from "../websocket.js";
import {
  createHttpError,
  ensureActivityUnlocked,
  ensureTemplateActivityUnlocked,
  getStudentSummaryMap,
  requireAdmin,
} from "../utils.js";
import { parseWorkbook } from "./helpers.js";

async function assertTemplateUnused(templateId: string) {
  const scoreCount = await prisma.score.count({ where: { templateId } });
  if (scoreCount > 0) {
    throw createHttpError("该模板已被评分记录使用，不能修改或删除", 409);
  }
}

export async function registerAdminUsersTemplateRoutes(app: FastifyInstance) {
  app.get("/api/admin/users", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    return prisma.user.findMany({
      select: { id: true, username: true, realName: true, role: true, isActive: true },
      orderBy: { createdAt: "asc" },
    });
  });

  app.get("/api/admin/activities/:activityId/users", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    return prisma.activityUserRole.findMany({
      where: {
        activityId: (request.params as { activityId: string }).activityId,
      },
      select: {
        id: true,
        activityId: true,
        userId: true,
        role: true,
        groupId: true,
        customRoleId: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            username: true,
            realName: true,
            isActive: true,
            lastLoginAt: true,
          },
        },
        group: {
          select: {
            id: true,
            name: true,
          },
        },
        customRole: {
          select: {
            id: true,
            name: true,
            color: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });
  });

  app.post("/api/admin/activity-user-roles", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const body = request.body as {
      activityId: string;
      userId?: string;
      username?: string;
      realName?: string;
      password?: string;
      phone?: string;
      role: UserRole;
      groupId?: string;
      customRoleId?: string;
    };
    await ensureActivityUnlocked(body.activityId);

    let userId = body.userId;

    if (!userId) {
      const existing = await prisma.user.findUnique({ where: { username: body.username! } });
      if (existing) {
        userId = existing.id;
      } else {
        const passwordHash = await bcrypt.hash(body.password ?? "123456", 10);
        const user = await prisma.user.create({
          data: {
            username: body.username!,
            realName: body.realName!,
            passwordHash,
            phone: body.phone,
            role: body.role,
            forceChangePassword: true,
          },
        });
        userId = user.id;
      }
    }

    const existingBinding = await prisma.activityUserRole.findFirst({
      where: { activityId: body.activityId, userId },
    });
    if (existingBinding) {
      throw createHttpError("该用户已在当前活动中分配了角色", 409);
    }

    if (body.groupId) {
      const group = await prisma.group.findUnique({ where: { id: body.groupId } });
      if (!group || group.activityId !== body.activityId) {
        throw createHttpError("所选分组不属于当前活动", 400);
      }
    }

    const relation = await prisma.activityUserRole.create({
      data: {
        activityId: body.activityId,
        userId,
        role: body.role,
        groupId: body.groupId,
        customRoleId: body.customRoleId || null,
        isPrimary: true,
      },
      include: {
        user: true,
        group: true,
        customRole: true,
      },
    });

    if (body.role === UserRole.JUDGE && body.groupId) {
      const students = await prisma.student.findMany({
        where: { activityId: body.activityId, groupId: body.groupId },
      });
      await prisma.scoreAssignment.createMany({
        data: students.map((student) => ({
          activityId: body.activityId,
          studentId: student.id,
          judgeUserId: userId!,
          groupId: body.groupId!,
        })),
        // @ts-expect-error skipDuplicates works at runtime with SQLite
        skipDuplicates: true,
      });
    }

    broadcast("judge.updated", { activityId: body.activityId });
    return relation;
  });

  app.put("/api/admin/activity-user-roles/:id", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const relationId = (request.params as { id: string }).id;
    const body = request.body as {
      username?: string;
      realName?: string;
      role: UserRole;
      groupId?: string | null;
      customRoleId?: string | null;
    };

    const currentRelation = await prisma.activityUserRole.findUniqueOrThrow({
      where: { id: relationId },
      include: { user: true },
    });
    await ensureActivityUnlocked(currentRelation.activityId);

    if (body.username || body.realName) {
      await prisma.user.update({
        where: { id: currentRelation.userId },
        data: {
          username: body.username ?? currentRelation.user.username,
          realName: body.realName ?? currentRelation.user.realName,
        },
      });
    }

    const updatedRelation = await prisma.activityUserRole.update({
      where: { id: relationId },
      data: {
        role: body.role,
        groupId: body.groupId || null,
        customRoleId: body.customRoleId !== undefined ? (body.customRoleId || null) : undefined,
      },
      include: {
        user: true,
        group: true,
        customRole: true,
      },
    });

    await prisma.scoreAssignment.deleteMany({
      where: {
        activityId: currentRelation.activityId,
        judgeUserId: currentRelation.userId,
      },
    });

    await prisma.score.deleteMany({
      where: {
        activityId: currentRelation.activityId,
        judgeUserId: currentRelation.userId,
      },
    });

    if (updatedRelation.role === UserRole.JUDGE && updatedRelation.groupId) {
      const students = await prisma.student.findMany({
        where: {
          activityId: updatedRelation.activityId,
          groupId: updatedRelation.groupId,
        },
      });
      if (students.length) {
        await prisma.scoreAssignment.createMany({
          data: students.map((student) => ({
            activityId: updatedRelation.activityId,
            studentId: student.id,
            judgeUserId: updatedRelation.userId,
            groupId: updatedRelation.groupId!,
          })),
          // @ts-expect-error skipDuplicates works at runtime with SQLite
          skipDuplicates: true,
        });
      }
    }

    broadcast("judge.updated", { activityId: updatedRelation.activityId });
    broadcast("student.updated", { activityId: updatedRelation.activityId });
    return updatedRelation;
  });

  app.delete("/api/admin/activity-user-roles/:id", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const relationId = (request.params as { id: string }).id;
    const relation = await prisma.activityUserRole.findUniqueOrThrow({
      where: { id: relationId },
    });
    await ensureActivityUnlocked(relation.activityId);

    await prisma.scoreAssignment.deleteMany({
      where: {
        activityId: relation.activityId,
        judgeUserId: relation.userId,
        ...(relation.groupId ? { groupId: relation.groupId } : {}),
      },
    });
    await prisma.score.deleteMany({
      where: {
        activityId: relation.activityId,
        judgeUserId: relation.userId,
        ...(relation.groupId ? { groupId: relation.groupId } : {}),
      },
    });
    await prisma.activityUserRole.delete({
      where: { id: relationId },
    });

    broadcast("judge.updated", { activityId: relation.activityId });
    broadcast("student.updated", { activityId: relation.activityId });
    return { success: true };
  });

  app.post("/api/admin/activities/:activityId/judges/import", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const activityId = (request.params as { activityId: string }).activityId;
    await ensureActivityUnlocked(activityId);
    const rows = await parseWorkbook(await request.file());
    const groups = await prisma.group.findMany({ where: { activityId } });
    const groupMap = new Map(groups.map((group) => [group.name, group]));
    const customRoles = await prisma.activityCustomRole.findMany({ where: { activityId } });
    const customRoleMap = new Map(customRoles.map((r) => [r.name, r]));

    for (const row of rows) {
      const username = String(row[1] ?? "");
      const realName = String(row[0] ?? "");
      const passwordHash = await bcrypt.hash(String(row[2] ?? "123456"), 10);
      let user = await prisma.user.findUnique({ where: { username } });
      if (!user) {
        user = await prisma.user.create({
          data: {
            username,
            realName,
            passwordHash,
            role: UserRole.JUDGE,
            forceChangePassword: true,
          },
        });
      }

      const group = groupMap.get(String(row[3] ?? ""));
      const customRoleName = String(row[4] ?? "").trim();
      const customRole = customRoleName ? customRoleMap.get(customRoleName) : undefined;

      const existingRole = await prisma.activityUserRole.findFirst({
        where: { activityId, userId: user.id },
      });
      if (existingRole) {
        const updateData: Record<string, unknown> = {};
        if (group && existingRole.groupId !== group.id) updateData.groupId = group.id;
        if (customRole) updateData.customRoleId = customRole.id;
        if (Object.keys(updateData).length) {
          await prisma.activityUserRole.update({
            where: { id: existingRole.id },
            data: updateData,
          });
        }
      } else {
        await prisma.activityUserRole.create({
          data: {
            activityId,
            userId: user.id,
            role: UserRole.JUDGE,
            groupId: group?.id,
            customRoleId: customRole?.id || null,
            isPrimary: true,
          },
        });
      }

      if (group) {
        const students = await prisma.student.findMany({ where: { activityId, groupId: group.id } });
        await prisma.scoreAssignment.createMany({
          data: students.map((student) => ({
            activityId,
            studentId: student.id,
            judgeUserId: user.id,
            groupId: group.id,
          })),
          // @ts-expect-error skipDuplicates works at runtime with SQLite
          skipDuplicates: true,
        });
      }
    }

    broadcast("judge.updated", { activityId });
    return { success: true, count: rows.length };
  });

  app.post("/api/admin/users/:id/reset-password", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const hash = await bcrypt.hash("123456", 10);
    await prisma.user.update({
      where: { id: (request.params as { id: string }).id },
      data: { passwordHash: hash, forceChangePassword: true },
    });
    return { success: true, password: "123456" };
  });

  app.post("/api/admin/users/:id/enable", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    await prisma.user.update({ where: { id: (request.params as { id: string }).id }, data: { isActive: true } });
    return { success: true };
  });

  app.post("/api/admin/users/:id/disable", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    await prisma.user.update({ where: { id: (request.params as { id: string }).id }, data: { isActive: false } });
    return { success: true };
  });

  app.get("/api/admin/activities/:activityId/templates", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    return prisma.scoreTemplate.findMany({
      where: { activityId: (request.params as { activityId: string }).activityId },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
  });

  app.post("/api/admin/activities/:activityId/templates", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const activityId = (request.params as { activityId: string }).activityId;
    await ensureActivityUnlocked(activityId);
    const body = request.body as {
      name: string;
      scoreMode: string;
      totalScore: number;
      isDefault?: boolean;
      items: Array<{ name: string; maxScore: number; sortOrder: number; isRequired?: boolean; description?: string }>;
    };

    const template = await prisma.scoreTemplate.create({
      data: {
        activityId,
        name: body.name,
        scoreMode: body.scoreMode,
        totalScore: body.totalScore,
        isDefault: body.isDefault ?? true,
        items: {
          create: body.items.map((item) => ({
            name: item.name,
            maxScore: item.maxScore,
            sortOrder: item.sortOrder,
            isRequired: item.isRequired ?? true,
            description: item.description || null,
          })),
        },
      },
      include: { items: true },
    });

    const activity = await prisma.activity.findUniqueOrThrow({
      where: { id: activityId },
      select: { activeTemplateId: true },
    });
    if (!activity.activeTemplateId) {
      await prisma.activity.update({
        where: { id: activityId },
        data: {
          activeTemplateId: template.id,
          scoreMode: template.scoreMode,
        },
      });
      broadcast("activity.updated", { activityId });
    }

    broadcast("template.updated", { activityId });
    return template;
  });

  app.put("/api/admin/templates/:id", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const templateId = (request.params as { id: string }).id;
    await ensureTemplateActivityUnlocked(templateId);
    await assertTemplateUnused(templateId);
    const body = request.body as {
      name: string;
      scoreMode: string;
      totalScore: number;
      items: Array<{ id?: string; name: string; maxScore: number; sortOrder: number; isRequired?: boolean; description?: string }>;
    };

    await prisma.scoreItem.deleteMany({ where: { templateId } });
    const template = await prisma.scoreTemplate.update({
      where: { id: templateId },
      data: {
        name: body.name,
        scoreMode: body.scoreMode,
        totalScore: body.totalScore,
        items: {
          create: body.items.map((item) => ({
            name: item.name,
            maxScore: item.maxScore,
            sortOrder: item.sortOrder,
            isRequired: item.isRequired ?? true,
            description: item.description || null,
          })),
        },
      },
      include: { items: true },
    });
    const activity = await prisma.activity.findUniqueOrThrow({
      where: { id: template.activityId },
      select: { activeTemplateId: true },
    });
    if (activity.activeTemplateId === template.id) {
      await prisma.activity.update({
        where: { id: template.activityId },
        data: {
          scoreMode: template.scoreMode,
        },
      });
      broadcast("activity.updated", { activityId: template.activityId });
    }
    broadcast("template.updated", { activityId: template.activityId });
    return template;
  });

  app.delete("/api/admin/templates/:id", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const templateId = (request.params as { id: string }).id;
    const template = await prisma.scoreTemplate.findUniqueOrThrow({
      where: { id: templateId },
      select: { id: true, activityId: true },
    });
    await ensureActivityUnlocked(template.activityId);
    await assertTemplateUnused(templateId);

    const replacementTemplate = await prisma.scoreTemplate.findFirst({
      where: {
        activityId: template.activityId,
        id: { not: templateId },
      },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      select: { id: true, scoreMode: true },
    });

    await prisma.scoreTemplate.delete({
      where: { id: templateId },
    });

    await prisma.activity.update({
      where: { id: template.activityId },
      data: {
        activeTemplateId: replacementTemplate?.id ?? null,
        scoreMode: replacementTemplate?.scoreMode ?? "ITEMIZED",
      },
    });

    broadcast("template.updated", { activityId: template.activityId });
    broadcast("activity.updated", { activityId: template.activityId });
    return { success: true };
  });

  app.get("/api/admin/activities/:activityId/results", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const activityId = (request.params as { activityId: string }).activityId;
    const students = await prisma.student.findMany({
      where: { activityId },
      select: {
        id: true,
        activityId: true,
        groupId: true,
        studentNo: true,
        name: true,
        gender: true,
        className: true,
        orderNo: true,
        group: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: [{ group: { sortOrder: "asc" } }, { orderNo: "asc" }],
    });
    const summaryMap = await getStudentSummaryMap(activityId, students.map((student) => student.id));
    const enriched = students.map((student) => ({
      ...student,
      summary: summaryMap.get(student.id) || null,
    }));

    return enriched
      .sort((a, b) => (b.summary.finalScore ?? 0) - (a.summary.finalScore ?? 0))
      .map((student, index) => ({
        ...student,
        rankNo: index + 1,
      }));
  });

  app.get("/api/admin/activities/:activityId/statistics", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const activityId = (request.params as { activityId: string }).activityId;
    const students = await prisma.student.findMany({ where: { activityId } });
    const summaryMap = await getStudentSummaryMap(activityId, students.map((student) => student.id));
    const summaries = students
      .map((student) => summaryMap.get(student.id))
      .filter((item) => Boolean(item));
    return {
      completedCount: summaries.filter((item) => item.isComplete).length,
      draftCount: await prisma.score.count({ where: { activityId, status: ScoreStatus.DRAFT } }),
      submittedCount: await prisma.score.count({ where: { activityId, status: ScoreStatus.SUBMITTED } }),
      avgOfAvg:
        summaries.filter((item) => item.avgScore !== null).length === 0
          ? null
          : Number(
              (
                summaries
                  .filter((item) => item.avgScore !== null)
                  .reduce((sum, item) => sum + Number(item.avgScore), 0) /
                summaries.filter((item) => item.avgScore !== null).length
              ).toFixed(2),
            ),
    };
  });
}
