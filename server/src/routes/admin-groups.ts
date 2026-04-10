import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import type { AuthRequest } from "../types.js";
import { broadcast } from "../websocket.js";
import {
  createHttpError,
  ensureActivityUnlocked,
  requireAdmin,
  toDateOrNull,
} from "../utils.js";
import { parseWorkbook } from "./helpers.js";

export function registerAdminGroupRoutes(app: FastifyInstance) {
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
        qrcodeMeta: true,
        _count: {
          select: {
            students: true,
          },
        },
        activityRoles: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
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
    const body = request.body as { name: string; sortOrder?: number; location?: string; note?: string; scheduleTime?: string; qrcodeUrl?: string; qrcodeMeta?: string };
    const group = await prisma.group.create({
      data: {
        activityId: (request.params as { activityId: string }).activityId,
        name: body.name,
        sortOrder: body.sortOrder ?? 0,
        location: body.location,
        scheduleTime: toDateOrNull(body.scheduleTime),
        qrcodeUrl: body.qrcodeUrl || null,
        qrcodeMeta: body.qrcodeMeta || null,
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
}
