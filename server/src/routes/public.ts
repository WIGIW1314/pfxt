import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { addPublicSseClient, removePublicSseClient } from "../websocket.js";

export async function registerPublicRoutes(app: FastifyInstance) {
  // 获取当前激活活动的完整公开信息（无需登录）
  app.get("/api/public/active-activity", async (_req, reply) => {
    const activity = await prisma.activity.findFirst({
      where: { isActive: true, isPublicVisible: true },
      include: {
        groups: {
          orderBy: { sortOrder: "asc" },
          include: {
            students: {
              orderBy: { orderNo: "asc" },
              include: { customRole: true } as any,
            },
            activityRoles: {
              orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] as any,
              include: {
                user: { select: { id: true, realName: true, username: true } },
                customRole: true,
              } as any,
            },
          },
        },
        templates: {
          include: { items: { orderBy: { sortOrder: "asc" } } },
        },
        customRoles: { orderBy: { sortOrder: "asc" } },
      } as any,
    });

    if (!activity) {
      return { available: false };
    }

    const data = activity as any;
    let announcementFiles: unknown[] = [];
    if (typeof data.announcementFiles === "string") {
      try {
        announcementFiles = JSON.parse(data.announcementFiles);
      } catch {
        announcementFiles = [];
      }
    }

    // 只返回公开需要的字段，不暴露敏感信息
    return {
      id: data.id,
      name: data.name,
      code: data.code,
      description: data.description,
      type: data.type,
      scoreMode: data.scoreMode,
      activeTemplateId: data.activeTemplateId ?? null,
      announcement: data.announcement ?? null,
      announcementFiles,
      groups: (data.groups || []).map((g: any) => ({
        id: g.id,
        name: g.name,
        sortOrder: g.sortOrder,
        location: g.location,
        scheduleTime: g.scheduleTime,
        startTime: g.startTime,
        endTime: g.endTime,
        qrcodeUrl: g.qrcodeUrl,
        students: (g.students || []).map((s: any) => ({
          id: s.id,
          name: s.name,
          studentNo: s.studentNo,
          className: s.className,
          orderNo: s.orderNo,
          customRole: s.customRole
            ? { name: s.customRole.name, color: s.customRole.color, description: s.customRole.description }
            : null,
        })),
        judges: (g.activityRoles || []).map((ar: any) => ({
          realName: ar.user.realName,
          customRole: ar.customRole
            ? { name: ar.customRole.name, color: ar.customRole.color, description: ar.customRole.description }
            : null,
        })),
      })),
      templates: (data.templates || []).map((t: any) => ({
        id: t.id,
        name: t.name,
        items: (t.items || []).map((item: any) => ({
          id: item.id,
          name: item.name,
          maxScore: item.maxScore,
          description: item.description,
          sortOrder: item.sortOrder,
        })),
      })),
      customRoles: (data.customRoles || []).map((r: any) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        color: r.color,
        sortOrder: r.sortOrder,
      })),
    };
  });

  // SSE 端点：公开页面实时事件推送（无需登录）
  app.get("/api/public/events", async (_req, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    reply.raw.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
    addPublicSseClient(reply);

    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(": heartbeat\n\n");
      } catch {
        clearInterval(heartbeat);
        removePublicSseClient(reply);
      }
    }, 15000);

    _req.raw.on("close", () => {
      clearInterval(heartbeat);
      removePublicSseClient(reply);
    });

    // Don't close the reply — keep-alive
    return reply;
  });
}
