import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import type { AuthRequest } from "../types.js";
import { broadcast } from "../websocket.js";
import { createHttpError, ensureActivityUnlocked, requireAdmin } from "../utils.js";

export function registerAdminCustomRoleRoutes(app: FastifyInstance) {
  /* ---------- 自定义角色列表 ---------- */
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

  /* ---------- 新建角色 ---------- */
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

  /* ---------- 编辑角色 ---------- */
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

  /* ---------- 删除角色 ---------- */
  app.delete("/api/admin/custom-roles/:id", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const id = (request.params as { id: string }).id;
    const existing = await prisma.activityCustomRole.findUniqueOrThrow({ where: { id } });
    await ensureActivityUnlocked(existing.activityId);
    await prisma.activityCustomRole.delete({ where: { id } });
    broadcast("customRole.updated", { activityId: existing.activityId });
    return { success: true };
  });

  /* ---------- 批量删除角色 ---------- */
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
