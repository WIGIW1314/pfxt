import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { UserRole } from "@prisma/client";
import { prisma } from "./db.js";
import { removePresence, touchPresence } from "./presence.js";
import type { AuthRequest } from "./types.js";
import { createHttpError } from "./utils.js";

const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const LOGIN_MAX_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// 周期清理过期的限速记录，防止 Map 无限增长
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of loginAttempts) {
    if (now >= record.resetAt) loginAttempts.delete(ip);
  }
}, LOGIN_WINDOW_MS).unref();

function checkLoginRate(ip: string) {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (record && now < record.resetAt) {
    if (record.count >= LOGIN_MAX_ATTEMPTS) {
      throw createHttpError("登录尝试过于频繁，请5分钟后再试", 429);
    }
    record.count++;
  } else {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  }
}

export async function registerAuth(app: FastifyInstance) {
  app.decorate("authenticate", async function authenticate(request: AuthRequest, reply) {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ message: "未登录或登录已失效" });
    }
  });

  app.post("/api/auth/login", async (request, reply) => {
    checkLoginRate(request.ip);
    const body = request.body as { username: string; password: string };
    const user = await prisma.user.findUnique({ where: { username: body.username } });

    if (!user || !user.isActive) {
      return reply.code(401).send({ message: "账号不存在或已禁用" });
    }

    const matched = await bcrypt.compare(body.password, user.passwordHash);
    if (!matched) {
      return reply.code(401).send({ message: "用户名或密码错误" });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const token = await reply.jwtSign({
      userId: user.id,
      username: user.username,
      role: user.role,
    });

    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        realName: user.realName,
        role: user.role,
        forceChangePassword: user.forceChangePassword,
      },
    };
  });

  app.get("/api/auth/me", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: request.user.userId },
      include: {
        activityRoles: {
          include: {
            activity: true,
            group: true,
          },
        },
      },
    });

    return {
      id: user.id,
      username: user.username,
      realName: user.realName,
      role: user.role,
      phone: user.phone,
      forceChangePassword: user.forceChangePassword,
      activityRoles: user.activityRoles,
    };
  });

  app.post("/api/auth/change-password", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    const body = request.body as { oldPassword: string; newPassword: string };
    const user = await prisma.user.findUniqueOrThrow({ where: { id: request.user.userId } });
    const matched = await bcrypt.compare(body.oldPassword, user.passwordHash);
    if (!matched) {
      return { success: false, message: "旧密码错误" };
    }

    const hash = await bcrypt.hash(body.newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hash, forceChangePassword: false },
    });

    return { success: true };
  });

  app.post("/api/presence/ping", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    const body = (request.body || {}) as { activityId?: string; groupId?: string };
    touchPresence({
      userId: request.user.userId,
      username: request.user.username,
      role: request.user.role,
      activityId: body.activityId ?? null,
      groupId: body.groupId ?? null,
    });
    return { success: true };
  });

  app.post("/api/presence/offline", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    removePresence(request.user.userId);
    return { success: true };
  });
}

export function isAdmin(role: UserRole) {
  return role === UserRole.SUPER_ADMIN || role === UserRole.ACTIVITY_ADMIN;
}
