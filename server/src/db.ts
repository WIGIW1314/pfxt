import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.basename(path.resolve(__dir, "..")) === "dist"
  ? path.resolve(__dir, "..", "..")
  : path.resolve(__dir, "..");
const envPath = path.resolve(serverDir, ".env");

if (!process.env.DATABASE_URL && fsSync.existsSync(envPath)) {
  const envContent = fsSync.readFileSync(envPath, "utf8");
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

// Resolve relative DATABASE_URL to absolute path based on serverDir so Prisma
// finds the correct file regardless of process.cwd()
if (process.env.DATABASE_URL && /^file:\.\.?[\\/]/.test(process.env.DATABASE_URL)) {
  const relativePart = process.env.DATABASE_URL.slice("file:".length);
  process.env.DATABASE_URL = "file:" + path.resolve(serverDir, relativePart).replace(/\\/g, "/");
}

function resolveSqlitePath() {
  const rawUrl = process.env.DATABASE_URL || "";
  if (!rawUrl.startsWith("file:")) return null;

  let filePath = "";
  try {
    const parsed = new URL(rawUrl);
    filePath = decodeURIComponent(parsed.pathname || "");
  } catch {
    filePath = rawUrl.slice("file:".length);
  }
  if (!filePath) return null;

  if (/^\/[A-Za-z]:\//.test(filePath)) {
    filePath = filePath.slice(1);
  }

  filePath = filePath.replace(/\//g, path.sep);

  if (path.isAbsolute(filePath)) {
    return filePath;
  }

  return path.resolve(serverDir, filePath);
}

export const prisma = new PrismaClient();

export async function ensureRuntimeSchema() {
  const sqlitePath = resolveSqlitePath();
  if (sqlitePath) {
    await fs.mkdir(path.dirname(sqlitePath), { recursive: true });
    const fallbackDbPath = path.resolve(serverDir, "prisma", "dev.db");
    if (!fsSync.existsSync(sqlitePath) && fsSync.existsSync(fallbackDbPath)) {
      await fs.copyFile(fallbackDbPath, sqlitePath);
    }
  }

  const tables = (await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='Activity';`,
  )) || [];
  if (tables.length === 0) {
    return;
  }

  const columns = (await prisma.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("Activity");`)) || [];
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("activeTemplateId")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Activity" ADD COLUMN "activeTemplateId" TEXT;`);
  }

  if (!columnNames.has("avgDecimalPlaces")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Activity" ADD COLUMN "avgDecimalPlaces" INTEGER NOT NULL DEFAULT 2;`);
  }

  if (!columnNames.has("announcement")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Activity" ADD COLUMN "announcement" TEXT;`);
  }

  if (!columnNames.has("announcementFiles")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Activity" ADD COLUMN "announcementFiles" TEXT;`);
  }

  // Group lock & time columns
  const groupColumns = (await prisma.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("Group");`)) || [];
  const groupColNames = new Set(groupColumns.map((c) => c.name));

  if (!groupColNames.has("isLocked")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Group" ADD COLUMN "isLocked" BOOLEAN NOT NULL DEFAULT 0;`);
  }
  if (!groupColNames.has("startTime")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Group" ADD COLUMN "startTime" DATETIME;`);
  }
  if (!groupColNames.has("endTime")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Group" ADD COLUMN "endTime" DATETIME;`);
  }
  if (!groupColNames.has("qrcodeUrl")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Group" ADD COLUMN "qrcodeUrl" TEXT;`);
  }

  // ActivityCustomRole 表
  const customRoleTables = (await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='ActivityCustomRole';`,
  )) || [];
  if (customRoleTables.length === 0) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "ActivityCustomRole" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "activityId" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "color" TEXT DEFAULT '#409eff',
        "sortOrder" INTEGER NOT NULL DEFAULT 0,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "ActivityCustomRole_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX "ActivityCustomRole_activityId_name_key" ON "ActivityCustomRole"("activityId", "name");`,
    );
  }

  // ActivityUserRole.customRoleId
  const aurColumns = (await prisma.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("ActivityUserRole");`)) || [];
  const aurColNames = new Set(aurColumns.map((c) => c.name));
  if (!aurColNames.has("customRoleId")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "ActivityUserRole" ADD COLUMN "customRoleId" TEXT;`);
  }

  // Student.customRoleId
  const studentColumns = (await prisma.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("Student");`)) || [];
  const studentColNames = new Set(studentColumns.map((c) => c.name));
  if (!studentColNames.has("customRoleId")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Student" ADD COLUMN "customRoleId" TEXT;`);
  }

  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_group_activity_sort" ON "Group"("activityId", "sortOrder");`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_activity_user_role_activity_role_group" ON "ActivityUserRole"("activityId", "role", "groupId");`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_student_activity_group_order" ON "Student"("activityId", "groupId", "orderNo");`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_score_assignment_activity_judge" ON "ScoreAssignment"("activityId", "judgeUserId");`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_score_assignment_activity_student" ON "ScoreAssignment"("activityId", "studentId");`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_score_activity_student_status" ON "Score"("activityId", "studentId", "status");`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_score_activity_judge_status" ON "Score"("activityId", "judgeUserId", "status");`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_operation_log_created_at" ON "OperationLog"("createdAt");`);
}
