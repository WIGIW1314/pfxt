import type { FastifyInstance } from "fastify";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import bcrypt from "bcryptjs";
import dayjs from "dayjs";
import { ScoreStatus, UserRole } from "@prisma/client";
import { prisma } from "../db.js";
import type { AuthRequest } from "../types.js";
import { broadcast, getOnlineSnapshot } from "../websocket.js";
import {
  createHttpError,
  ensureActivityUnlocked,
  ensureGroupActivityUnlocked,
  ensureStudentActivityUnlocked,
  getStudentSummaryMap,
  logOperation,
  requireAdmin,
  toDateOrNull,
} from "../utils.js";
import { parseWorkbook } from "./helpers.js";

function formatExportScore(value: number | null | undefined, decimalPlaces = 2) {
  if (value === null || value === undefined) return "";
  return Number(value).toFixed(decimalPlaces);
}

function toExcelColumnName(index: number) {
  let current = index;
  let label = "";
  while (current > 0) {
    const remainder = (current - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    current = Math.floor((current - 1) / 26);
  }
  return label;
}

function buildContentDisposition(chineseName: string, fallbackName: string) {
  return `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(chineseName)}`;
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
      allowEditScore: true,
      showAvgToJudge: true,
      startTime: true,
      endTime: true,
      announcement: true,
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

export async function registerAdminCoreRoutes(app: FastifyInstance) {
  app.get("/api/admin/activities", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const normalized = await normalizeActiveActivity();
    if (normalized.length) {
      return normalized.map((activity) => ({
        ...activity,
        groupCount: activity._count.groups,
        studentCount: activity._count.students,
        judgeCount: activity.activityRoles.length,
      }));
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
        allowEditScore: true,
        showAvgToJudge: true,
        startTime: true,
        endTime: true,
        announcement: true,
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
    // 补充 announcementFiles (兼容 Prisma client 未重新生成)
    try {
      const rows = await prisma.$queryRaw<Array<{ id: string; announcementFiles: string | null }>>`
        SELECT "id", "announcementFiles" FROM "Activity"
      `;
      const map = new Map(rows.map(r => [r.id, r.announcementFiles]));
      for (const a of activities as any[]) {
        const raw = map.get(a.id);
        a.announcementFiles = raw ? JSON.parse(raw) : [];
      }
    } catch { /* column may not exist yet */ }
    return activities.map((activity) => ({
      ...activity,
      groupCount: activity._count.groups,
      studentCount: activity._count.students,
      judgeCount: activity.activityRoles.length,
    }));
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
    };

    const activeCount = await prisma.activity.count({
      where: { isActive: true },
    });

    const activity = await prisma.activity.create({
      data: {
        ...body,
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
      select: { isLocked: true },
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

    for (const field of ["startTime", "endTime"] as const) {
      if (body[field] !== undefined) {
        body[field] = toDateOrNull(body[field]);
      }
    }

    // announcementFiles 通过 raw SQL 更新 (Prisma client 可能尚未重新生成)
    let announcementFilesValue: string | undefined;
    if (body.announcementFiles !== undefined) {
      announcementFilesValue = typeof body.announcementFiles === "string"
        ? body.announcementFiles
        : JSON.stringify(body.announcementFiles);
      delete body.announcementFiles;
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

    broadcast("activity.updated", { activityId: activity.id });
    return activity;
  });

  app.delete("/api/admin/activities/:id", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const activityId = (request.params as { id: string }).id;
    const activity = await prisma.activity.findUniqueOrThrow({
      where: { id: activityId },
    });

    if (activity.isLocked) {
      throw createHttpError("当前活动已锁定，请解锁后再删除", 423);
    }

    await prisma.activity.delete({
      where: { id: activityId },
    });

    if (activity.isActive) {
      const fallback = await prisma.activity.findFirst({
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (fallback) {
        await prisma.activity.update({
          where: { id: fallback.id },
          data: { isActive: true },
        });
      }
    }

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

  /* ---------- 公告附件上传 ---------- */
  const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const uploadsDir = path.resolve(serverDir, "uploads");
  if (!fsSync.existsSync(uploadsDir)) fsSync.mkdirSync(uploadsDir, { recursive: true });

  app.post("/api/admin/activities/:id/upload", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const activityId = (request.params as { id: string }).id;
    await prisma.activity.findUniqueOrThrow({ where: { id: activityId } });

    const file = await request.file();
    if (!file) throw createHttpError("未上传文件", 400);

    const ext = path.extname(file.filename).toLowerCase();
    const allowedExts = [".pdf", ".docx"];
    if (!allowedExts.includes(ext)) {
      throw createHttpError("仅支持 PDF 和 DOCX 文件", 400);
    }

    const safeName = `${activityId}_${Date.now()}${ext}`;
    const filePath = path.resolve(uploadsDir, safeName);

    // Ensure the file stays inside uploadsDir (path traversal protection)
    if (!filePath.startsWith(uploadsDir)) {
      throw createHttpError("非法文件路径", 400);
    }

    const buf = await file.toBuffer();
    await fs.writeFile(filePath, buf);

    const fileType = ext === ".pdf" ? "pdf" : "docx";
    return {
      name: file.filename,
      url: `/api/uploads/${safeName}`,
      type: fileType,
    };
  });

  app.get("/api/admin/activities/:id/dashboard", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const activityId = (request.params as { id: string }).id;
    const onlineSnapshot = await getOnlineSnapshot();
    const [groups, students, judges, submittedScores] = await Promise.all([
      prisma.group.findMany({ where: { activityId } }),
      prisma.student.findMany({ where: { activityId } }),
      prisma.activityUserRole.findMany({ where: { activityId, role: UserRole.JUDGE } }),
      prisma.score.findMany({ where: { activityId, status: ScoreStatus.SUBMITTED } }),
    ]);
    const summaryMap = await getStudentSummaryMap(activityId, students.map((student) => student.id));

    const groupStats = groups.map((group) => {
      const groupStudents = students.filter((student) => student.groupId === group.id);
      const completed = groupStudents
        .map((student) => summaryMap.get(student.id))
        .filter((item) => Boolean(item));

      return {
        groupId: group.id,
        groupName: group.name,
        studentCount: groupStudents.length,
        completedCount: completed.filter((item) => item?.isComplete).length,
        progress: groupStudents.length === 0
          ? 0
          : Number(
              (
                completed.filter((item) => item && item.submittedJudgeCount > 0).length / groupStudents.length
              ).toFixed(2),
            ),
      };
    });

    return {
      activityId,
      activityCount: 1,
      groupCount: groups.length,
      studentCount: students.length,
      judgeCount: judges.length,
      onlineUserCount: onlineSnapshot.total,
      onlineJudgeCount: onlineSnapshot.judges,
      onlineAdminCount: onlineSnapshot.admins,
      onlineSecretaryCount: onlineSnapshot.secretaries,
      onlineUsers: onlineSnapshot.users,
      completedStudentCount: groupStats.reduce((sum, item) => sum + item.completedCount, 0),
      scoreCount: submittedScores.length,
      groupStats,
    };
  });

  app.get("/api/admin/activities/:activityId/groups", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const groups = await prisma.group.findMany({
      where: { activityId: (request.params as { activityId: string }).activityId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        activityId: true,
        name: true,
        sortOrder: true,
        location: true,
        scheduleTime: true,
        note: true,
        isLocked: true,
        startTime: true,
        endTime: true,
        qrcodeUrl: true,
        _count: {
          select: {
            students: true,
          },
        },
        activityRoles: {
          select: {
            id: true,
            role: true,
            userId: true,
            customRoleId: true,
            user: {
              select: {
                id: true,
                username: true,
                realName: true,
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
        },
      },
    });
    return groups.map((group) => ({
      ...group,
      studentCount: group._count.students,
    }));
  });

  app.post("/api/admin/activities/:activityId/groups", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    await ensureActivityUnlocked((request.params as { activityId: string }).activityId);
    const body = request.body as { name: string; sortOrder?: number; location?: string; note?: string; scheduleTime?: string; qrcodeUrl?: string };
    const group = await prisma.group.create({
      data: {
        activityId: (request.params as { activityId: string }).activityId,
        name: body.name,
        sortOrder: body.sortOrder ?? 0,
        location: body.location,
        scheduleTime: toDateOrNull(body.scheduleTime),
        qrcodeUrl: body.qrcodeUrl || null,
        note: body.note,
      },
    });
    broadcast("group.updated", { activityId: group.activityId });
    return group;
  });

  app.post("/api/admin/activities/:activityId/groups/import", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const activityId = (request.params as { activityId: string }).activityId;
    await ensureActivityUnlocked(activityId);
    const rows = await parseWorkbook(await request.file());

    const validRows = rows.filter((row) => String(row[0] ?? "").trim());
    await Promise.all(
      validRows.map((row) => {
        const name = String(row[0]).trim();
        return prisma.group.upsert({
          where: { activityId_name: { activityId, name } },
          update: {
            sortOrder: Number(row[1] ?? 0),
            location: String(row[2] ?? ""),
            scheduleTime: toDateOrNull(row[3]),
            note: String(row[4] ?? ""),
          },
          create: {
            activityId,
            name,
            sortOrder: Number(row[1] ?? 0),
            location: String(row[2] ?? ""),
            scheduleTime: toDateOrNull(row[3]),
            note: String(row[4] ?? ""),
          },
        });
      }),
    );

    broadcast("group.updated", { activityId });
    return { success: true, count: validRows.length };
  });

  app.put("/api/admin/groups/:id", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const groupId = (request.params as { id: string }).id;
    const currentGroup = await prisma.group.findUniqueOrThrow({
      where: { id: groupId },
      select: { isLocked: true, activityId: true },
    });
    await ensureActivityUnlocked(currentGroup.activityId);

    const body = request.body as Record<string, unknown>;

    // Allow lock-only updates even if group is locked
    const fields = Object.keys(body);
    const lockOnlyUpdate = fields.length > 0 && fields.every((f) => f === "isLocked");
    if (currentGroup.isLocked && !lockOnlyUpdate) {
      throw createHttpError("当前分组已锁定，只允许解锁后再编辑", 423);
    }

    body.scheduleTime = toDateOrNull(body.scheduleTime);
    body.startTime = toDateOrNull(body.startTime);
    body.endTime = toDateOrNull(body.endTime);
    const group = await prisma.group.update({
      where: { id: groupId },
      data: body,
    });
    broadcast("group.updated", { activityId: group.activityId });
    return group;
  });

  app.delete("/api/admin/groups/:id", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const groupId = (request.params as { id: string }).id;
    const group = await prisma.group.findUniqueOrThrow({
      where: { id: groupId },
      select: { id: true, activityId: true, name: true },
    });
    await ensureActivityUnlocked(group.activityId);

    await prisma.group.delete({
      where: { id: groupId },
    });

    broadcast("group.updated", { activityId: group.activityId });
    broadcast("student.updated", { activityId: group.activityId });
    broadcast("judge.updated", { activityId: group.activityId });
    return { success: true };
  });

  app.get("/api/admin/activities/:activityId/students", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const activityId = (request.params as { activityId: string }).activityId;
    const students = await prisma.student.findMany({
      where: { activityId },
      orderBy: [{ group: { sortOrder: "asc" } }, { orderNo: "asc" }],
      select: {
        id: true,
        activityId: true,
        groupId: true,
        studentNo: true,
        name: true,
        gender: true,
        className: true,
        orderNo: true,
        customRoleId: true,
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
    });
    const summaryMap = await getStudentSummaryMap(activityId, students.map((student) => student.id));

    return students.map((student) => ({
      ...student,
      summary: summaryMap.get(student.id) || null,
    }));
  });

  app.post("/api/admin/activities/:activityId/students", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const activityId = (request.params as { activityId: string }).activityId;
    await ensureActivityUnlocked(activityId);
    const body = request.body as {
      groupId: string;
      studentNo: string;
      name: string;
      gender?: string;
      className?: string;
      orderNo?: number;
      customRoleId?: string;
    };

    const student = await prisma.student.create({
      data: {
        activityId,
        groupId: body.groupId,
        studentNo: body.studentNo,
        name: body.name,
        gender: body.gender,
        className: body.className,
        orderNo: body.orderNo ?? 0,
        customRoleId: body.customRoleId || null,
      },
    });

    const judges = await prisma.activityUserRole.findMany({
      where: { activityId, groupId: body.groupId, role: UserRole.JUDGE },
    });

    if (judges.length) {
      await prisma.scoreAssignment.createMany({
        data: judges.map((judge) => ({
          activityId,
          studentId: student.id,
          judgeUserId: judge.userId,
          groupId: body.groupId,
        })),
      });
    }

    broadcast("student.updated", { activityId });
    return student;
  });

  app.put("/api/admin/students/:id", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    await ensureStudentActivityUnlocked((request.params as { id: string }).id);
    const student = await prisma.student.update({
      where: { id: (request.params as { id: string }).id },
      data: request.body as Record<string, unknown>,
    });
    broadcast("student.updated", { activityId: student.activityId });
    return student;
  });

  app.delete("/api/admin/students/:id", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    await ensureStudentActivityUnlocked((request.params as { id: string }).id);
    const student = await prisma.student.delete({
      where: { id: (request.params as { id: string }).id },
    });
    broadcast("student.updated", { activityId: student.activityId });
    return { success: true };
  });

  app.post("/api/admin/activities/:activityId/students/import", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const activityId = (request.params as { activityId: string }).activityId;
    await ensureActivityUnlocked(activityId);
    const rows = await parseWorkbook(await request.file());
    const groups = await prisma.group.findMany({ where: { activityId } });
    const groupMap = new Map(groups.map((group) => [group.name, group]));
    const judges = await prisma.activityUserRole.findMany({ where: { activityId, role: UserRole.JUDGE } });
    const judgesByGroup = new Map<string, typeof judges>();
    for (const judge of judges) {
      if (!judge.groupId) continue;
      const list = judgesByGroup.get(judge.groupId) || [];
      list.push(judge);
      judgesByGroup.set(judge.groupId, list);
    }
    const customRoles = await prisma.activityCustomRole.findMany({ where: { activityId } });
    const customRoleMap = new Map(customRoles.map((r) => [r.name, r]));
    const pendingAssignments: Array<{
      activityId: string;
      studentId: string;
      judgeUserId: string;
      groupId: string;
    }> = [];

    // Process student rows with concurrency (avoid serial upserts)
    const BATCH_CONCURRENCY = 10;
    const validRows = rows.filter((row) => groupMap.get(String(row[4] ?? "")));
    let idx = 0;
    while (idx < validRows.length) {
      const chunk = validRows.slice(idx, idx + BATCH_CONCURRENCY);
      idx += BATCH_CONCURRENCY;
      const students = await Promise.all(
        chunk.map((row) => {
          const group = groupMap.get(String(row[4] ?? ""))!;
          const customRoleName = String(row[6] ?? "").trim();
          const customRole = customRoleName ? customRoleMap.get(customRoleName) : undefined;
          return prisma.student.upsert({
            where: { activityId_studentNo: { activityId, studentNo: String(row[0] ?? "") } },
            update: {
              name: String(row[1] ?? ""),
              gender: String(row[2] ?? ""),
              className: String(row[3] ?? ""),
              groupId: group.id,
              orderNo: Number(row[5] ?? 0),
              customRoleId: customRole?.id ?? undefined,
            },
            create: {
              activityId,
              groupId: group.id,
              studentNo: String(row[0] ?? ""),
              name: String(row[1] ?? ""),
              gender: String(row[2] ?? ""),
              className: String(row[3] ?? ""),
              orderNo: Number(row[5] ?? 0),
              customRoleId: customRole?.id || null,
            },
          }).then((student) => ({ student, row }));
        }),
      );
      for (const { student, row } of students) {
        const group = groupMap.get(String(row[4] ?? ""))!;
        for (const judge of judgesByGroup.get(group.id) || []) {
          pendingAssignments.push({
            activityId,
            studentId: student.id,
            judgeUserId: judge.userId,
            groupId: group.id,
          });
        }
      }
    }

    if (pendingAssignments.length) {
      const uniquePendingAssignments = Array.from(
        new Map(
          pendingAssignments.map((assignment) => [
            `${assignment.studentId}:${assignment.judgeUserId}`,
            assignment,
          ]),
        ).values(),
      );
      const existingAssignments = await prisma.scoreAssignment.findMany({
        where: {
          activityId,
          studentId: { in: uniquePendingAssignments.map((assignment) => assignment.studentId) },
        },
        select: {
          studentId: true,
          judgeUserId: true,
        },
      });
      const existingAssignmentKeys = new Set(
        existingAssignments.map((assignment) => `${assignment.studentId}:${assignment.judgeUserId}`),
      );
      const assignmentsToCreate = uniquePendingAssignments.filter(
        (assignment) => !existingAssignmentKeys.has(`${assignment.studentId}:${assignment.judgeUserId}`),
      );

      if (assignmentsToCreate.length) {
        await prisma.scoreAssignment.createMany({
          data: assignmentsToCreate,
        });
      }
    }

    broadcast("student.updated", { activityId });
    return { success: true, count: validRows.length };
  });

  app.get("/api/admin/activities/:activityId/export/results", { preHandler: [app.authenticate] }, async (request: AuthRequest, reply) => {
    await requireAdmin(request);
    const activityId = (request.params as { activityId: string }).activityId;
    const [activity, results] = await Promise.all([
      prisma.activity.findUniqueOrThrow({
        where: { id: activityId },
        select: { name: true, code: true, avgDecimalPlaces: true },
      }),
      prisma.student.findMany({
        where: { activityId },
        include: {
          group: true,
          assignments: {
            where: { isRequired: true },
          },
          scores: {
            include: {
              judge: true,
              template: true,
              details: {
                include: { item: true },
                orderBy: { item: { sortOrder: "asc" } },
              },
            },
            orderBy: [{ submittedAt: "asc" }, { updatedAt: "asc" }],
          },
        },
        orderBy: [{ group: { sortOrder: "asc" } }, { orderNo: "asc" }],
      }),
    ]);
    const avgDecimalPlaces = activity.avgDecimalPlaces ?? 2;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "线上评分系统";
    workbook.created = new Date();

    const summarySheet = workbook.addWorksheet("成绩总表");
    const summaryColumns = [
      { header: "排名", key: "rankNo", width: 8 },
      { header: "组别", key: "groupName", width: 12 },
      { header: "顺序号", key: "orderNo", width: 10 },
      { header: "学号", key: "studentNo", width: 16 },
      { header: "姓名", key: "name", width: 12 },
      { header: "性别", key: "gender", width: 8 },
      { header: "班级", key: "className", width: 16 },
      { header: "应评委数", key: "requiredJudgeCount", width: 10 },
      { header: "已提交数", key: "submittedJudgeCount", width: 10 },
      { header: "提交率", key: "submitRate", width: 10 },
      { header: "总分", key: "totalSubmittedScore", width: 12 },
      { header: "平均分", key: "avgScore", width: 12 },
      { header: "最终分", key: "finalScore", width: 12 },
      { header: "完成状态", key: "isComplete", width: 12 },
      { header: "已评分委", key: "judgeNames", width: 24 },
      { header: "评语汇总", key: "comments", width: 34 },
    ];
    summarySheet.columns = summaryColumns;
    const summaryLastColumn = toExcelColumnName(summaryColumns.length);
    summarySheet.mergeCells(`A1:${summaryLastColumn}1`);
    summarySheet.getCell("A1").value = `${activity.name} 成绩汇总表`;
    summarySheet.getCell("A1").font = { bold: true, size: 18, color: { argb: "1F2D3D" } };
    summarySheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
    summarySheet.getCell("A1").fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "F5F9FF" },
    };
    summarySheet.getRow(1).height = 30;

    summarySheet.mergeCells(`A2:${summaryLastColumn}2`);
    summarySheet.getCell("A2").value = `活动编码：${activity.code}    导出时间：${dayjs().format("YYYY/MM/DD HH:mm:ss")}    保留小数位：${avgDecimalPlaces}`;
    summarySheet.getCell("A2").font = { size: 11, color: { argb: "6B7A99" } };
    summarySheet.getCell("A2").alignment = { horizontal: "center", vertical: "middle" };
    summarySheet.getRow(2).height = 22;
    summarySheet.getRow(3).height = 6;

    const summaryHeaderRow = summarySheet.getRow(4);
    summaryColumns.forEach((column, index) => {
      const cell = summaryHeaderRow.getCell(index + 1);
      cell.value = column.header;
      cell.font = { bold: true, color: { argb: "2B3A55" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "DDEAFB" },
      };
      cell.border = {
        top: { style: "thin", color: { argb: "C9D8EE" } },
        left: { style: "thin", color: { argb: "C9D8EE" } },
        bottom: { style: "thin", color: { argb: "C9D8EE" } },
        right: { style: "thin", color: { argb: "C9D8EE" } },
      };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    });
    summaryHeaderRow.height = 24;

    const summaryMap = await getStudentSummaryMap(activityId, results.map((student) => student.id));
    const enrichedResults = results.map((student) => {
      const summary = summaryMap.get(student.id);
      const submittedScores = student.scores.filter((score) => score.status === ScoreStatus.SUBMITTED);
      const totalSubmittedScore = submittedScores.reduce((sum, score) => sum + Number(score.totalScore || 0), 0);
      const judgeNames = submittedScores.map((score) => score.judge.realName).join("、");
      const comments = submittedScores
        .filter((score) => score.comment)
        .map((score) => `${score.judge.realName}：${score.comment}`)
        .join("；");
      const submitRate = student.assignments.length
        ? `${Math.round((submittedScores.length / student.assignments.length) * 100)}%`
        : "0%";
      return {
        student,
        summary,
        totalSubmittedScore,
        judgeNames,
        comments,
        submitRate,
      };
    });

    enrichedResults
      .sort((a, b) => (b.summary.finalScore ?? 0) - (a.summary.finalScore ?? 0))
      .forEach((item, index) => {
        const row = summarySheet.addRow({
          rankNo: index + 1,
          groupName: item.student.group.name,
          orderNo: item.student.orderNo,
          studentNo: item.student.studentNo,
          name: item.student.name,
          gender: item.student.gender || "",
          className: item.student.className || "",
          requiredJudgeCount: item.summary.requiredJudgeCount,
          submittedJudgeCount: item.summary.submittedJudgeCount,
          submitRate: item.submitRate,
          totalSubmittedScore: formatExportScore(item.totalSubmittedScore, avgDecimalPlaces),
          avgScore: formatExportScore(item.summary.avgScore, avgDecimalPlaces),
          finalScore: formatExportScore(item.summary.finalScore, avgDecimalPlaces),
          isComplete: item.summary.isComplete ? "已完成" : "进行中",
          judgeNames: item.judgeNames || "暂无",
          comments: item.comments || "",
        });
        row.height = 24;
        row.eachCell((cell) => {
          cell.border = {
            top: { style: "thin", color: { argb: "E4ECF8" } },
            left: { style: "thin", color: { argb: "E4ECF8" } },
            bottom: { style: "thin", color: { argb: "E4ECF8" } },
            right: { style: "thin", color: { argb: "E4ECF8" } },
          };
          cell.alignment = {
            horizontal: "center",
            vertical: "middle",
            wrapText: true,
          };
          if (row.number % 2 === 1) {
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FAFCFF" },
            };
          }
        });
      });

    summarySheet.views = [{ state: "frozen", ySplit: 4 }];
    summarySheet.autoFilter = `A4:${summaryLastColumn}4`;

    const detailSheet = workbook.addWorksheet("评分明细");
    const detailColumns = [
      { header: "组别", key: "groupName", width: 12 },
      { header: "顺序号", key: "orderNo", width: 10 },
      { header: "学号", key: "studentNo", width: 16 },
      { header: "姓名", key: "name", width: 12 },
      { header: "班级", key: "className", width: 16 },
      { header: "评委姓名", key: "judgeName", width: 14 },
      { header: "评委账号", key: "judgeUsername", width: 16 },
      { header: "评分状态", key: "status", width: 12 },
      { header: "评分模板", key: "templateName", width: 16 },
      { header: "总分", key: "totalScore", width: 12 },
      { header: "分项明细", key: "detailText", width: 42 },
      { header: "评语", key: "comment", width: 28 },
      { header: "提交时间", key: "submittedAt", width: 18 },
    ];
    detailSheet.columns = detailColumns;
    const detailLastColumn = toExcelColumnName(detailColumns.length);
    detailSheet.mergeCells(`A1:${detailLastColumn}1`);
    detailSheet.getCell("A1").value = `${activity.name} 评分明细表`;
    detailSheet.getCell("A1").font = { bold: true, size: 18, color: { argb: "1F2D3D" } };
    detailSheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
    detailSheet.getRow(1).height = 30;

    const detailHeaderRow = detailSheet.getRow(3);
    detailColumns.forEach((column, index) => {
      const cell = detailHeaderRow.getCell(index + 1);
      cell.value = column.header;
      cell.font = { bold: true, color: { argb: "2B3A55" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "E7F1FF" },
      };
      cell.border = {
        top: { style: "thin", color: { argb: "C9D8EE" } },
        left: { style: "thin", color: { argb: "C9D8EE" } },
        bottom: { style: "thin", color: { argb: "C9D8EE" } },
        right: { style: "thin", color: { argb: "C9D8EE" } },
      };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    });
    detailHeaderRow.height = 24;

    for (const student of results) {
      for (const score of student.scores) {
        const detailText = score.details
          .map((detail) => `${detail.item.name}:${formatExportScore(detail.scoreValue, avgDecimalPlaces)}`)
          .join("；");
        const row = detailSheet.addRow({
          groupName: student.group.name,
          orderNo: student.orderNo,
          studentNo: student.studentNo,
          name: student.name,
          className: student.className || "",
          judgeName: score.judge.realName,
          judgeUsername: score.judge.username,
          status: score.status === ScoreStatus.SUBMITTED ? "已提交" : "草稿",
          templateName: score.template?.name || "",
          totalScore: formatExportScore(score.totalScore, avgDecimalPlaces),
          detailText,
          comment: score.comment || "",
          submittedAt: score.submittedAt ? dayjs(score.submittedAt).format("YYYY/MM/DD HH:mm:ss") : "",
        });
        row.height = 24;
        row.eachCell((cell) => {
          cell.border = {
            top: { style: "thin", color: { argb: "E4ECF8" } },
            left: { style: "thin", color: { argb: "E4ECF8" } },
            bottom: { style: "thin", color: { argb: "E4ECF8" } },
            right: { style: "thin", color: { argb: "E4ECF8" } },
          };
          cell.alignment = {
            horizontal: "center",
            vertical: "middle",
            wrapText: true,
          };
        });
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const chineseName = `${activity.name}成绩汇总表.xlsx`;
    reply.header("Content-Disposition", buildContentDisposition(chineseName, "activity-results.xlsx"));
    return reply.send(buffer);
  });

  app.get("/api/admin/logs", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    return prisma.operationLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  });

  app.post("/api/admin/logs", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const body = request.body as {
      operatorName?: string;
      module: string;
      action: string;
      targetType: string;
      targetId?: string;
      beforeData?: string;
      afterData?: string;
    };

    return prisma.operationLog.create({
      data: {
        operatorId: request.user.userId,
        operatorName: body.operatorName || request.user.username,
        module: body.module,
        action: body.action,
        targetType: body.targetType,
        targetId: body.targetId || null,
        beforeData: body.beforeData || null,
        afterData: body.afterData || null,
      },
    });
  });

  app.put("/api/admin/logs/:id", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const logId = (request.params as { id: string }).id;
    const body = request.body as {
      operatorName?: string;
      module?: string;
      action?: string;
      targetType?: string;
      targetId?: string;
      beforeData?: string;
      afterData?: string;
    };

    return prisma.operationLog.update({
      where: { id: logId },
      data: {
        operatorName: body.operatorName,
        module: body.module,
        action: body.action,
        targetType: body.targetType,
        targetId: body.targetId ?? null,
        beforeData: body.beforeData ?? null,
        afterData: body.afterData ?? null,
      },
    });
  });

  app.delete("/api/admin/logs/:id", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const logId = (request.params as { id: string }).id;
    await prisma.operationLog.delete({
      where: { id: logId },
    });
    return { success: true };
  });

  // ─── ActivityCustomRole CRUD ─────────────────────────────────────

  app.get("/api/admin/activities/:activityId/custom-roles", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const activityId = (request.params as { activityId: string }).activityId;
    const roles = await prisma.activityCustomRole.findMany({
      where: { activityId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        activityId: true,
        name: true,
        description: true,
        color: true,
        sortOrder: true,
        _count: {
          select: {
            userRoles: true,
            students: true,
          },
        },
      },
    });
    return roles.map((role) => ({
      ...role,
      userRoleCount: role._count.userRoles,
      studentCount: role._count.students,
    }));
  });

  app.post("/api/admin/activities/:activityId/custom-roles", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const activityId = (request.params as { activityId: string }).activityId;
    await ensureActivityUnlocked(activityId);
    const body = request.body as { name: string; description?: string; color?: string; sortOrder?: number };
    if (!body.name?.trim()) throw createHttpError("角色名称不能为空", 400);
    const role = await prisma.activityCustomRole.create({
      data: {
        activityId,
        name: body.name.trim(),
        description: body.description || null,
        color: body.color || "#409eff",
        sortOrder: body.sortOrder ?? 0,
      },
    });
    broadcast("customRole.updated", { activityId });
    return role;
  });

  app.put("/api/admin/custom-roles/:id", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const id = (request.params as { id: string }).id;
    const existing = await prisma.activityCustomRole.findUniqueOrThrow({ where: { id } });
    await ensureActivityUnlocked(existing.activityId);
    const body = request.body as { name?: string; description?: string; color?: string; sortOrder?: number };
    if (body.name !== undefined && !body.name.trim()) throw createHttpError("角色名称不能为空", 400);
    const role = await prisma.activityCustomRole.update({
      where: { id },
      data: {
        name: body.name?.trim(),
        description: body.description,
        color: body.color,
        sortOrder: body.sortOrder,
      },
    });
    broadcast("customRole.updated", { activityId: existing.activityId });
    return role;
  });

  app.delete("/api/admin/custom-roles/:id", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const id = (request.params as { id: string }).id;
    const existing = await prisma.activityCustomRole.findUniqueOrThrow({ where: { id } });
    await ensureActivityUnlocked(existing.activityId);
    await prisma.activityCustomRole.delete({ where: { id } });
    broadcast("customRole.updated", { activityId: existing.activityId });
    return { success: true };
  });

  app.post("/api/admin/activities/:activityId/custom-roles/batch-delete", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const activityId = (request.params as { activityId: string }).activityId;
    await ensureActivityUnlocked(activityId);
    const { ids } = request.body as { ids: string[] };
    if (!ids?.length) throw createHttpError("请选择要删除的角色", 400);
    await prisma.activityCustomRole.deleteMany({ where: { id: { in: ids }, activityId } });
    broadcast("customRole.updated", { activityId });
    return { success: true, count: ids.length };
  });
}
