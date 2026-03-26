// 强制使用北京时间 (UTC+8)
process.env.TZ = "Asia/Shanghai";

import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import path from "node:path";
import fsSync from "node:fs";
import { fileURLToPath } from "node:url";
import { registerAuth } from "./auth.js";
import { ensureRuntimeSchema } from "./db.js";
import { registerRoutes } from "./routes/index.js";
import { registerWsRoute } from "./websocket.js";

const app = Fastify({ logger: false });

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32) {
  console.error("[FATAL] JWT_SECRET 未配置或长度不足 32 个字符，拒绝启动！");
  process.exit(1);
}

const allowedOrigin = process.env.CORS_ORIGIN;

app.setErrorHandler((error, _request, reply) => {
  const message = error instanceof Error ? error.message : "请求失败";
  const statusCode = typeof (error as { statusCode?: number })?.statusCode === "number"
    ? (error as { statusCode: number }).statusCode
    : 400;
  reply.code(statusCode).send({ message });
});

await app.register(cors, {
  origin: allowedOrigin ? allowedOrigin.split(",").map((s) => s.trim()) : false,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
});
await app.register(jwt, { secret: jwtSecret });
await app.register(multipart);
await app.register(websocket);

// --- 静态文件：上传的公告附件 ---
const __dir = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.basename(path.resolve(__dir, "..")) === "dist"
  ? path.resolve(__dir, "..", "..")
  : path.resolve(__dir, "..");
const uploadsDir = path.resolve(serverDir, "uploads");
if (!fsSync.existsSync(uploadsDir)) fsSync.mkdirSync(uploadsDir, { recursive: true });
await app.register(fastifyStatic, {
  root: uploadsDir,
  prefix: "/api/uploads/",
  decorateReply: false,
});

await ensureRuntimeSchema();

await registerAuth(app);
await registerRoutes(app);
registerWsRoute(app);

app.get("/api/health", async () => ({ ok: true }));

const port = Number(process.env.PORT ?? 3100);
await app.listen({ port, host: "0.0.0.0" });
console.log(`server running on http://127.0.0.1:${port}`);
