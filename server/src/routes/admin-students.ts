import type { FastifyInstance } from "fastify";
import fs from "node:fs/promises";
import path from "node:path";
import { UserRole } from "@prisma/client";
import { prisma } from "../db.js";
import type { AuthRequest } from "../types.js";
import { broadcast } from "../websocket.js";
import {
  createHttpError,
  ensureActivityUnlocked,
  ensureStudentActivityUnlocked,
  getStudentSummaryMap,
  logOperation,
  requireAdmin,
} from "../utils.js";
import { resolveUploadPathFromUrl, uploadsDir } from "./admin-shared.js";
import { parseWorkbook } from "./helpers.js";

const STUDENT_ARTWORK_MAX = 5;
const STUDENT_ARTWORK_ADMIN_MAX = 2;
const ARTWORK_ALLOWED_TYPES = new Set(["image/webp", "image/jpeg", "image/png", "image/jpg"]);
const ARTWORK_MAX_FILE_SIZE = 5 * 1024 * 1024;

function isVotingActivity(activity: { type?: string | null } | null | undefined) {
  return activity?.type === "投票";
}

function normalizeArtworkFilename(activityId: string, studentId: string) {
  const activityPart = String(activityId || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24) || "activity";
  const studentPart = String(studentId || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24) || "student";
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `artwork_${activityPart}_${studentPart}_${Date.now()}_${randomPart}.webp`;
}

async function safeUnlinkByUrl(url?: string | null) {
  const filePath = resolveUploadPathFromUrl(url);
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch {
    // ignore missing files
  }
}

export function registerAdminStudentRoutes(app: FastifyInstance) {
  app.get("/api/admin/activities/:activityId/students", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const activityId = (request.params as { activityId: string }).activityId;
    const query = request.query as { limit?: string };
    const take = Math.min(Number(query.limit) || 500, 1000);
    const [activity, students] = await Promise.all([
      prisma.activity.findUnique({
        where: { id: activityId },
        select: { type: true },
      }),
      prisma.student.findMany({
        where: { activityId },
        orderBy: [{ group: { sortOrder: "asc" } }, { orderNo: "asc" }],
        take,
        select: {
          id: true,
          activityId: true,
          groupId: true,
          studentNo: true,
          name: true,
          workName: true,
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
          artworks: {
            select: {
              id: true,
              url: true,
              uploaderType: true,
              uploadedById: true,
              createdAt: true,
            },
            orderBy: { createdAt: "desc" },
          },
        },
      }),
    ]);
    const summaryMap = await getStudentSummaryMap(activityId, students.map((student) => student.id));
    const votingMode = isVotingActivity(activity);

    return students.map((student) => ({
      ...student,
      artworkCount: student.artworks.length,
      canVote: votingMode ? student.artworks.length > 0 : true,
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
      workName?: string | null;
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
        workName: String(body.workName ?? "").trim() || null,
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
    const studentId = (request.params as { id: string }).id;
    await ensureStudentActivityUnlocked(studentId);
    const artworkRows = await prisma.studentArtwork.findMany({
      where: { studentId },
      select: { url: true },
    });
    const student = await prisma.student.delete({
      where: { id: studentId },
    });
    await Promise.all(artworkRows.map((row) => safeUnlinkByUrl(row.url)));
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
    const normalizeText = (value: unknown) => String(value ?? "").trim();
    const normalizeOptionalText = (value: unknown) => {
      const text = normalizeText(value);
      return text || null;
    };
    const parseImportRow = (row: Array<string | number | undefined>) => {
      const oldGroupName = normalizeText(row[4]);
      const newGroupName = normalizeText(row[5]);
      const useNewTemplate = groupMap.has(newGroupName) || (!groupMap.has(oldGroupName) && row.length >= 7);
      const groupName = useNewTemplate ? newGroupName : oldGroupName;
      return {
        studentNo: normalizeText(row[0]),
        name: normalizeText(row[1]),
        gender: normalizeText(row[2]),
        className: normalizeText(row[3]),
        workName: useNewTemplate ? normalizeOptionalText(row[4]) : null,
        groupName,
        orderNo: Number(row[useNewTemplate ? 6 : 5] ?? 0),
        customRoleName: normalizeText(row[useNewTemplate ? 7 : 6]),
      };
    };
    const pendingAssignments: Array<{
      activityId: string;
      studentId: string;
      judgeUserId: string;
      groupId: string;
    }> = [];

    // Process student rows with concurrency (avoid serial upserts)
    const BATCH_CONCURRENCY = 10;
    const normalizedRows = rows.map(parseImportRow);
    const validRows = normalizedRows.filter((row) => row.studentNo && groupMap.get(row.groupName));
    let idx = 0;
    while (idx < validRows.length) {
      const chunk = validRows.slice(idx, idx + BATCH_CONCURRENCY);
      idx += BATCH_CONCURRENCY;
      const students = await Promise.all(
        chunk.map((row) => {
          const group = groupMap.get(row.groupName)!;
          const customRoleName = row.customRoleName;
          const customRole = customRoleName ? customRoleMap.get(customRoleName) : undefined;
          return prisma.student.upsert({
            where: { activityId_studentNo: { activityId, studentNo: row.studentNo } },
            update: {
              name: row.name,
              workName: row.workName,
              gender: row.gender,
              className: row.className,
              groupId: group.id,
              orderNo: row.orderNo,
              customRoleId: customRole?.id ?? undefined,
            },
            create: {
              activityId,
              groupId: group.id,
              studentNo: row.studentNo,
              name: row.name,
              workName: row.workName,
              gender: row.gender,
              className: row.className,
              orderNo: row.orderNo,
              customRoleId: customRole?.id || null,
            },
          }).then((student) => ({ student, row }));
        }),
      );
      for (const { student, row } of students) {
        const group = groupMap.get(row.groupName)!;
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

  app.post("/api/admin/students/:id/artworks", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const studentId = (request.params as { id: string }).id;
    const student = await prisma.student.findUniqueOrThrow({
      where: { id: studentId },
      select: {
        id: true,
        activityId: true,
        name: true,
        activity: {
          select: { type: true },
        },
      },
    });
    await ensureActivityUnlocked(student.activityId);
    if (!isVotingActivity(student.activity)) {
      throw createHttpError("仅投票模式支持上传作品图", 400);
    }

    const file = await request.file();
    if (!file) throw createHttpError("未上传文件", 400);
    if (!ARTWORK_ALLOWED_TYPES.has(file.mimetype.toLowerCase())) {
      throw createHttpError("仅支持上传 JPG、PNG 或 WebP 图片", 400);
    }
    const fileBuffer = await file.toBuffer();
    if (!fileBuffer.length) throw createHttpError("上传文件为空", 400);
    if (fileBuffer.length > ARTWORK_MAX_FILE_SIZE) {
      throw createHttpError("图片不能超过 5MB，请压缩后重试", 400);
    }

    const artworkDir = path.resolve(uploadsDir, "artworks");
    await fs.mkdir(artworkDir, { recursive: true });
    const filename = normalizeArtworkFilename(student.activityId, student.id);
    const filePath = path.resolve(artworkDir, filename);
    await fs.writeFile(filePath, fileBuffer);
    const fileUrl = `/api/uploads/artworks/${filename}`;

    try {
      const artwork = await prisma.$transaction(async (tx) => {
        const [totalCount, adminCount] = await Promise.all([
          tx.studentArtwork.count({ where: { studentId: student.id } }),
          tx.studentArtwork.count({ where: { studentId: student.id, uploaderType: "ADMIN" } }),
        ]);
        if (totalCount >= STUDENT_ARTWORK_MAX) {
          throw createHttpError(`每位学生最多上传 ${STUDENT_ARTWORK_MAX} 张作品图`, 400);
        }
        if (adminCount >= STUDENT_ARTWORK_ADMIN_MAX) {
          throw createHttpError(`管理员最多为该学生上传 ${STUDENT_ARTWORK_ADMIN_MAX} 张作品图`, 400);
        }

        return tx.studentArtwork.create({
          data: {
            activityId: student.activityId,
            studentId: student.id,
            uploadedById: request.user.userId,
            uploaderType: "ADMIN",
            url: fileUrl,
            fileName: file.filename || filename,
            mimeType: file.mimetype,
            fileSize: fileBuffer.length,
          },
          select: {
            id: true,
            url: true,
            uploaderType: true,
            uploadedById: true,
            createdAt: true,
          },
        });
      });

      const artworkCount = await prisma.studentArtwork.count({ where: { studentId: student.id } });
      broadcast("student.artwork.updated", { activityId: student.activityId, studentId: student.id });
      await logOperation({
        operatorId: request.user.userId,
        operatorName: request.user.username,
        module: "student",
        action: "upload",
        targetType: "artwork",
        targetId: artwork.id,
        afterData: {
          studentId: student.id,
          studentName: student.name,
          uploaderType: "ADMIN",
          url: artwork.url,
        },
      });
      return {
        artwork,
        artworkCount,
        canVote: artworkCount > 0,
      };
    } catch (error) {
      await safeUnlinkByUrl(fileUrl);
      throw error;
    }
  });

  app.delete("/api/admin/students/:id/artworks/:artworkId", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const { id: studentId, artworkId } = request.params as { id: string; artworkId: string };
    const student = await prisma.student.findUniqueOrThrow({
      where: { id: studentId },
      select: {
        id: true,
        activityId: true,
        name: true,
        activity: {
          select: { type: true },
        },
      },
    });
    await ensureActivityUnlocked(student.activityId);
    if (!isVotingActivity(student.activity)) {
      throw createHttpError("仅投票模式支持管理作品图", 400);
    }

    const artwork = await prisma.studentArtwork.findFirst({
      where: {
        id: artworkId,
        studentId: student.id,
      },
    });
    if (!artwork) {
      throw createHttpError("作品图不存在或已被删除", 404);
    }

    await prisma.studentArtwork.delete({ where: { id: artwork.id } });
    await safeUnlinkByUrl(artwork.url);
    const artworkCount = await prisma.studentArtwork.count({ where: { studentId: student.id } });
    broadcast("student.artwork.updated", { activityId: student.activityId, studentId: student.id });
    await logOperation({
      operatorId: request.user.userId,
      operatorName: request.user.username,
      module: "student",
      action: "delete",
      targetType: "artwork",
      targetId: artwork.id,
      beforeData: {
        studentId: student.id,
        studentName: student.name,
        uploaderType: artwork.uploaderType,
        url: artwork.url,
      },
    });
    return {
      success: true,
      artworkCount,
      canVote: artworkCount > 0,
    };
  });
}
