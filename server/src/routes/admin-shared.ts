import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../db.js";

const __dir = path.dirname(fileURLToPath(import.meta.url));
// admin-shared.ts is always at {src,dist}/routes/, so go up 2 levels to reach server root
const serverDir = path.resolve(__dir, "..", "..");

export const uploadsDir = path.resolve(serverDir, "uploads");
if (!fsSync.existsSync(uploadsDir)) fsSync.mkdirSync(uploadsDir, { recursive: true });

const UPLOAD_URL_PREFIX = "/api/uploads/";

export function getUploadRelativePathFromUrl(url?: string | null) {
  if (!url || !url.startsWith(UPLOAD_URL_PREFIX)) return null;
  const relativePath = decodeURIComponent(url.slice(UPLOAD_URL_PREFIX.length)).replace(/\\/g, "/");
  if (!relativePath) return null;
  return relativePath;
}

export function getUploadFilenameFromUrl(url?: string | null) {
  const relativePath = getUploadRelativePathFromUrl(url);
  if (!relativePath) return null;
  return path.basename(relativePath);
}

export function resolveUploadPath(filename: string) {
  const filePath = path.resolve(uploadsDir, filename);
  return filePath.startsWith(uploadsDir) ? filePath : null;
}

export function resolveUploadPathFromUrl(url?: string | null) {
  const relativePath = getUploadRelativePathFromUrl(url);
  if (!relativePath) return null;
  return resolveUploadPath(relativePath);
}

type AnnouncementFileMeta = {
  name?: string;
  url?: string;
  type?: string;
  description?: string;
};

export function parseAnnouncementFiles(raw: unknown): AnnouncementFileMeta[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function cleanupUnusedAnnouncementFiles(activityId: string, announcementFiles: AnnouncementFileMeta[]) {
  const referencedUrls = new Set<string>();
  const activities = await prisma.activity.findMany({
    where: { id: { not: activityId } },
    select: { announcementFiles: true },
  });

  for (const item of activities) {
    parseAnnouncementFiles(item.announcementFiles).forEach((file) => {
      if (file.url) {
        referencedUrls.add(file.url);
      }
    });
  }

  const explicitFiles = new Set(
    announcementFiles
      .map((file) => getUploadFilenameFromUrl(file.url))
      .filter((value): value is string => Boolean(value)),
  );

  const prefixedFiles = new Set<string>();
  try {
    const entries = await fs.readdir(uploadsDir);
    entries
      .filter((name) => name.startsWith(`${activityId}_`))
      .forEach((name) => prefixedFiles.add(name));
  } catch {
    return;
  }

  const targetFiles = new Set([...explicitFiles, ...prefixedFiles]);
  await Promise.all(
    Array.from(targetFiles).map(async (filename) => {
      const url = `/api/uploads/${filename}`;
      if (referencedUrls.has(url)) return;
      const filePath = resolveUploadPath(filename);
      if (!filePath) return;
      try {
        await fs.unlink(filePath);
      } catch {
        // ignore missing files
      }
    }),
  );
}
