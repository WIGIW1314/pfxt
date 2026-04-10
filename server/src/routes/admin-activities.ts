import type { FastifyInstance } from "fastify";
import { UserRole } from "@prisma/client";
import { prisma } from "../db.js";
import type { AuthRequest } from "../types.js";
import { broadcast } from "../websocket.js";
import {
  createHttpError,
  logOperation,
  requireAdmin,
  toDateOrNull,
} from "../utils.js";
import {
  parseAnnouncementFiles,
  cleanupUnusedAnnouncementFiles,
} from "./admin-shared.js";

function formatActivityListItem(activity: any) {
  return {
    ...activity,
    announcementFiles: parseAnnouncementFiles(activity.announcementFiles),
    groupCount: activity._count.groups,
    studentCount: activity._count.students,
    judgeCount: activity.activityRoles.length,
  };
}

async function normalizeActiveActivity() {
  const activities = await prisma.activity.findMany({
    orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
    select: { id: true, isActive: true, createdAt: true },
  });

  if (!activities.length) {
    return [];
  }

  const activeActivities = activities.filter((item) => item.isActive);
  if (activeActivities.length !== 1) {
    const keepActiveId = activeActivities[0]?.id || activities[0].id;
    await prisma.$transaction([
      prisma.activity.updateMany({
        where: { id: { not: keepActiveId } },
        data: { isActive: false },
      }),
      prisma.activity.update({
        where: { id: keepActiveId },
        data: { isActive: true },
      }),
    ]);
  }

  return prisma.activity.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      code: true,
      description: true,
      type: true,
      scoreMode: true,
      calcMode: true,
      activeTemplateId: true,
      avgDecimalPlaces: true,
      isActive: true,
      isLocked: true,
      isPublicVisible: true,
      showExportZip: true,
      showExportXlsx: true,
      showCommentUi: true,
      showQuestionUi: true,
      allowEditScore: true,
      showAvgToJudge: true,
      showPeerScoresToJudge: true,
      showGroupProgressToSecretary: true,
      showVoteCountToJudge: true,
      startTime: true,
      endTime: true,
      announcement: true,
      announcementFiles: true,
      judgeAnnouncement: true,
      judgeAnnouncementFiles: true,
      createdAt: true,
      templates: {
        select: {
          id: true,
          name: true,
          isDefault: true,
        },
      },
      _count: {
        select: {
          groups: true,
          students: true,
        },
      },
      activityRoles: {
        where: { role: UserRole.JUDGE },
        select: { id: true },
      },
    },
  });
}

export function registerAdminActivityRoutes(app: FastifyInstance) {
  app.get("/api/admin/activities", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const normalized = await normalizeActiveActivity();
    if (normalized.length) {
      return normalized.map(formatActivityListItem);
    }
    const activities = await prisma.activity.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        code: true,
        description: true,
        type: true,
        scoreMode: true,
        calcMode: true,
        activeTemplateId: true,
        avgDecimalPlaces: true,
        isActive: true,
        isLocked: true,
        isPublicVisible: true,
        showExportZip: true,
        showExportXlsx: true,
        showCommentUi: true,
        showQuestionUi: true,
        allowEditScore: true,
        showAvgToJudge: true,
        showPeerScoresToJudge: true,
        showGroupProgressToSecretary: true,
        showVoteCountToJudge: true,
        startTime: true,
        endTime: true,
        announcement: true,
        announcementFiles: true,
        judgeAnnouncement: true,
        judgeAnnouncementFiles: true,
        createdAt: true,
        templates: {
          select: {
            id: true,
            name: true,
            isDefault: true,
          },
        },
        _count: {
          select: {
            groups: true,
            students: true,
          },
        },
        activityRoles: {
          where: { role: UserRole.JUDGE },
          select: { id: true },
        },
      },
    });
    return activities.map(formatActivityListItem);
  });

  app.post("/api/admin/activities", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const body = request.body as {
      name: string;
      code: string;
      description?: string;
      type: string;
      scoreMode: string;
      calcMode: "SIMPLE_AVG" | "DROP_EXTREMES" | "WEIGHTED_AVG" | "ALL_SUBMITTED";
      startTime?: string | null;
      endTime?: string | null;
      isPublicVisible?: boolean;
    };

    const activeCount = await prisma.activity.count({
      where: { isActive: true },
    });

    const activity = await prisma.activity.create({
      data: {
        ...body,
        startTime: toDateOrNull(body.startTime),
        endTime: toDateOrNull(body.endTime),
        isPublicVisible: body.isPublicVisible ?? true,
        createdBy: request.user.userId,
        isActive: activeCount === 0,
      },
    });

    await logOperation({
      operatorId: request.user.userId,
      operatorName: request.user.username,
      module: "activity",
      action: "create",
      targetType: "Activity",
      targetId: activity.id,
      afterData: activity,
    });

    broadcast("activity.updated", { activityId: activity.id });
    return activity;
  });

  app.put("/api/admin/activities/:id", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const activityId = (request.params as { id: string }).id;
    const body = request.body as Record<string, unknown>;
    const currentActivity = await prisma.activity.findUniqueOrThrow({
      where: { id: activityId },
      select: { isLocked: true, type: true },
    });

    const fields = Object.keys(body);
    const lockOnlyUpdate = fields.length > 0 && fields.every((field) => field === "isLocked");
    if (currentActivity.isLocked && !lockOnlyUpdate) {
      throw createHttpError("当前活动已锁定，只允许解锁后再编辑", 423);
    }

    if (body.activeTemplateId) {
      const template = await prisma.scoreTemplate.findFirst({
        where: {
          id: String(body.activeTemplateId),
          activityId,
        },
        select: { id: true, scoreMode: true },
      });
      if (!template) {
        throw createHttpError("所选模板不属于当前活动", 400);
      }
      body.scoreMode = template.scoreMode;
    }

    if (body.avgDecimalPlaces !== undefined) {
      const decimalPlaces = Number(body.avgDecimalPlaces);
      if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 4) {
        throw createHttpError("平均分小数位数必须在 0 到 4 之间", 400);
      }
      body.avgDecimalPlaces = decimalPlaces;
    }

    // 活动类型切换检测（评分 ↔ 投票）
    const currentType = currentActivity.type as string | undefined;
    const newType = body.type !== undefined ? String(body.type) : currentType;
    const typeChanged = String(newType) !== String(currentType);

    if (typeChanged) {
      const scoreCount = await prisma.score.count({ where: { activityId } });
      const studentCount = await prisma.student.count({ where: { activityId } });

      if ((scoreCount > 0 || studentCount > 0) && body.__confirmTypeSwitch !== true) {
        throw createHttpError(
          `切换活动类型将清除所有现有评分数据（${scoreCount} 条评分记录，${studentCount} 个学生及分配信息）。如确认切换，请在请求中传入 __confirmTypeSwitch: true`,
          409,
        );
      }

      if (body.__confirmTypeSwitch === true) {
        await prisma.$transaction([
          prisma.scoreDetail.deleteMany({ where: { score: { activityId } } }),
          prisma.score.deleteMany({ where: { activityId } }),
          prisma.scoreAssignment.deleteMany({ where: { activityId } }),
        ]);
      }
    }
    delete (body as Record<string, unknown>).__confirmTypeSwitch;

    for (const field of ["startTime", "endTime"] as const) {
      if (body[field] !== undefined) {
        body[field] = toDateOrNull(body[field]);
      }
    }

    // announcementFiles / judgeAnnouncementFiles 通过 raw SQL 更新 (JSON 字段)
    let announcementFilesValue: string | undefined;
    if (body.announcementFiles !== undefined) {
      announcementFilesValue = typeof body.announcementFiles === "string"
        ? body.announcementFiles
        : JSON.stringify(body.announcementFiles);
      delete body.announcementFiles;
    }
    let judgeAnnouncementFilesValue: string | undefined;
    if (body.judgeAnnouncementFiles !== undefined) {
      judgeAnnouncementFilesValue = typeof body.judgeAnnouncementFiles === "string"
        ? body.judgeAnnouncementFiles
        : JSON.stringify(body.judgeAnnouncementFiles);
      delete body.judgeAnnouncementFiles;
    }

    const activity = await prisma.activity.update({
      where: { id: activityId },
      data: body,
    });

    if (announcementFilesValue !== undefined) {
      await prisma.$executeRawUnsafe(
        `UPDATE "Activity" SET "announcementFiles" = ? WHERE "id" = ?`,
        announcementFilesValue,
        activityId,
      );
    }
    if (judgeAnnouncementFilesValue !== undefined) {
      await prisma.$executeRawUnsafe(
        `UPDATE "Activity" SET "judgeAnnouncementFiles" = ? WHERE "id" = ?`,
        judgeAnnouncementFilesValue,
        activityId,
      );
    }

    broadcast("activity.updated", { activityId: activity.id });
    return activity;
  });

  app.post("/api/admin/activities/:id/clone", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const sourceActivityId = (request.params as { id: string }).id;
    const body = request.body as {
      name: string;
      code: string;
      description?: string;
      type: string;
      startTime?: string | null;
      endTime?: string | null;
      isPublicVisible?: boolean;
    };

    if (!body.name?.trim()) {
      throw createHttpError("请填写活动名称", 400);
    }
    if (!body.code?.trim()) {
      throw createHttpError("请填写活动编码", 400);
    }

    const sourceActivity = await prisma.activity.findUniqueOrThrow({
      where: { id: sourceActivityId },
      include: {
        customRoles: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        },
        templates: {
          orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
          include: {
            items: {
              orderBy: { sortOrder: "asc" },
            },
          },
        },
      },
    });

    const clonedActivity = await prisma.$transaction(async (tx) => {
      const activity = await tx.activity.create({
        data: {
          name: body.name.trim(),
          code: body.code.trim(),
          description: body.description?.trim() || null,
          type: body.type?.trim() || sourceActivity.type,
          scoreMode: sourceActivity.scoreMode,
          calcMode: sourceActivity.calcMode,
          activeTemplateId: null,
          avgDecimalPlaces: sourceActivity.avgDecimalPlaces,
          isActive: false,
          isLocked: false,
          isPublicVisible: body.isPublicVisible ?? false,
          showExportZip: sourceActivity.showExportZip,
          showExportXlsx: sourceActivity.showExportXlsx,
          showCommentUi: sourceActivity.showCommentUi,
          showQuestionUi: sourceActivity.showQuestionUi,
          allowEditScore: sourceActivity.allowEditScore,
          showAvgToJudge: sourceActivity.showAvgToJudge,
          showPeerScoresToJudge: sourceActivity.showPeerScoresToJudge,
          showGroupProgressToSecretary: sourceActivity.showGroupProgressToSecretary,
          announcement: sourceActivity.announcement,
          announcementFiles: sourceActivity.announcementFiles,
          judgeAnnouncement: sourceActivity.judgeAnnouncement,
          judgeAnnouncementFiles: sourceActivity.judgeAnnouncementFiles,
          startTime: toDateOrNull(body.startTime),
          endTime: toDateOrNull(body.endTime),
          createdBy: request.user.userId,
        },
      });

      for (const role of sourceActivity.customRoles) {
        await tx.activityCustomRole.create({
          data: {
            activityId: activity.id,
            name: role.name,
            description: role.description,
            color: role.color,
            sortOrder: role.sortOrder,
          },
        });
      }

      const templateIdMap = new Map<string, string>();
      for (const template of sourceActivity.templates) {
        const newTemplate = await tx.scoreTemplate.create({
          data: {
            activityId: activity.id,
            name: template.name,
            scoreMode: template.scoreMode,
            totalScore: template.totalScore,
            isDefault: template.isDefault,
            items: {
              create: template.items.map((item) => ({
                name: item.name,
                maxScore: item.maxScore,
                weight: item.weight,
                isRequired: item.isRequired,
                sortOrder: item.sortOrder,
                description: item.description,
              })),
            },
          },
        });
        templateIdMap.set(template.id, newTemplate.id);
      }

      const nextActiveTemplateId =
        (sourceActivity.activeTemplateId && templateIdMap.get(sourceActivity.activeTemplateId)) ||
        templateIdMap.get(sourceActivity.templates.find((item) => item.isDefault)?.id || "") ||
        Array.from(templateIdMap.values())[0] ||
        null;

      return tx.activity.update({
        where: { id: activity.id },
        data: {
          activeTemplateId: nextActiveTemplateId,
        },
      });
    });

    await logOperation({
      operatorId: request.user.userId,
      operatorName: request.user.username,
      module: "activity",
      action: "clone",
      targetType: "Activity",
      targetId: clonedActivity.id,
      afterData: {
        id: clonedActivity.id,
        sourceActivityId,
        name: clonedActivity.name,
        code: clonedActivity.code,
      },
    });

    broadcast("activity.updated", { activityId: clonedActivity.id, sourceActivityId });
    return clonedActivity;
  });

  app.delete("/api/admin/activities/:id", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const activityId = (request.params as { id: string }).id;
    const activity = await prisma.activity.findUniqueOrThrow({
      where: { id: activityId },
      select: {
        id: true,
        name: true,
        code: true,
        isActive: true,
        isLocked: true,
        announcementFiles: true,
      },
    });

    if (activity.isLocked) {
      throw createHttpError("当前活动已锁定，请解锁后再删除", 423);
    }

    const announcementFiles = parseAnnouncementFiles(activity.announcementFiles);

    await prisma.$transaction(async (tx) => {
      await tx.scoreDetail.deleteMany({
        where: {
          score: {
            activityId,
          },
        },
      });
      await tx.score.deleteMany({ where: { activityId } });
      await tx.scoreAssignment.deleteMany({ where: { activityId } });
      await tx.student.deleteMany({ where: { activityId } });
      await tx.activityUserRole.deleteMany({ where: { activityId } });
      await tx.scoreItem.deleteMany({
        where: {
          template: {
            activityId,
          },
        },
      });
      await tx.scoreTemplate.deleteMany({ where: { activityId } });
      await tx.activityCustomRole.deleteMany({ where: { activityId } });
      await tx.group.deleteMany({ where: { activityId } });
      await tx.activity.delete({ where: { id: activityId } });

      if (activity.isActive) {
        const fallback = await tx.activity.findFirst({
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });
        if (fallback) {
          await tx.activity.update({
            where: { id: fallback.id },
            data: { isActive: true },
          });
        }
      }
    });

    await cleanupUnusedAnnouncementFiles(activityId, announcementFiles);

    await logOperation({
      operatorId: request.user.userId,
      operatorName: request.user.username,
      module: "activity",
      action: "delete",
      targetType: "Activity",
      targetId: activity.id,
      beforeData: activity,
    });

    broadcast("activity.updated", { activityId });
    return { success: true };
  });

  app.post("/api/admin/activities/:id/activate", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const activityId = (request.params as { id: string }).id;
    const activity = await prisma.activity.findUniqueOrThrow({
      where: { id: activityId },
      select: { id: true, name: true, isActive: true },
    });

    if (!activity.isActive) {
      await prisma.$transaction([
        prisma.activity.updateMany({
          where: { isActive: true },
          data: { isActive: false },
        }),
        prisma.activity.update({
          where: { id: activityId },
          data: { isActive: true },
        }),
      ]);
    }

    await logOperation({
      operatorId: request.user.userId,
      operatorName: request.user.username,
      module: "activity",
      action: "activate",
      targetType: "Activity",
      targetId: activity.id,
      afterData: { id: activity.id, name: activity.name, isActive: true },
    });

    broadcast("activity.updated", { activityId });
    return { success: true };
  });
}
