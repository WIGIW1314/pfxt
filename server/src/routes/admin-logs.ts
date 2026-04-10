import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import type { AuthRequest } from "../types.js";
import { requireAdmin } from "../utils.js";

export function registerAdminLogsRoutes(app: FastifyInstance) {
  /* ---------- 日志列表 ---------- */
  app.get("/api/admin/logs", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const logs = await prisma.operationLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        operator: { select: { id: true, realName: true, username: true } },
      },
    });
    return logs;
  });

  /* ---------- 新建日志 ---------- */
  app.post("/api/admin/logs", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const body = request.body as Record<string, unknown>;
    const log = await prisma.operationLog.create({
      data: {
        operatorId: request.user.userId,
        operatorName: request.user.username,
        module: String(body.module ?? ""),
        action: String(body.action ?? ""),
        targetType: String(body.targetType ?? ""),
        targetId: body.targetId ? String(body.targetId) : null,
        beforeData: body.beforeData ? String(body.beforeData) : null,
        afterData: body.afterData ? String(body.afterData) : null,
      },
    });
    return log;
  });

  /* ---------- 编辑日志 ---------- */
  app.put("/api/admin/logs/:id", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const logId = (request.params as { id: string }).id;
    const body = request.body as Record<string, unknown>;
    const log = await prisma.operationLog.update({
      where: { id: logId },
      data: {
        module: body.module ? String(body.module) : undefined,
        action: body.action ? String(body.action) : undefined,
        targetType: body.targetType ? String(body.targetType) : undefined,
        targetId: body.targetId !== undefined ? (body.targetId ? String(body.targetId) : null) : undefined,
        beforeData: body.beforeData !== undefined ? (body.beforeData ? String(body.beforeData) : null) : undefined,
        afterData: body.afterData !== undefined ? (body.afterData ? String(body.afterData) : null) : undefined,
      },
    });
    return log;
  });

  /* ---------- 删除日志 ---------- */
  app.delete("/api/admin/logs/:id", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const logId = (request.params as { id: string }).id;
    await prisma.operationLog.delete({ where: { id: logId } });
    return { success: true };
  });
}
