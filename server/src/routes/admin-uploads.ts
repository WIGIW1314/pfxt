import type { FastifyInstance } from "fastify";
import type { AuthRequest } from "../types.js";
import { createHttpError, requireAdmin } from "../utils.js";
import { processImage } from "../image.js";
import { uploadsDir } from "./admin-shared.js";

export function registerAdminUploadRoutes(app: FastifyInstance) {
  /* ---------- 二维码图片上传（处理为 WebP + 缩略图） ---------- */
  app.post("/api/admin/groups/qrcode-upload", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);

    const file = await request.file();
    if (!file) throw createHttpError("未上传文件", 400);

    const mimeType = file.mimetype;
    const allowedImageTypes = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp"];
    if (!allowedImageTypes.includes(mimeType)) {
      throw createHttpError("仅支持 JPG、PNG、GIF、WebP、BMP 格式的图片", 400);
    }

    // 2MB limit
    const buf = await file.toBuffer();
    if (buf.length > 2 * 1024 * 1024) {
      throw createHttpError("图片大小不能超过 2MB", 400);
    }

    const result = await processImage(buf, mimeType, uploadsDir, "qrcode");
    if (!result) {
      throw createHttpError("图片处理失败", 500);
    }

    return {
      thumb: result.thumb.url,
      medium: result.medium.url,
      original: result.original.url,
      meta: result,
    };
  });
}
