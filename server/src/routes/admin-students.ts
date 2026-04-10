import type { FastifyInstance } from "fastify";
import { UserRole } from "@prisma/client";
import { prisma } from "../db.js";
import type { AuthRequest } from "../types.js";
import { broadcast } from "../websocket.js";
import {
  ensureActivityUnlocked,
  ensureStudentActivityUnlocked,
  getStudentSummaryMap,
  requireAdmin,
} from "../utils.js";
import { parseWorkbook } from "./helpers.js";

export function registerAdminStudentRoutes(app: FastifyInstance) {
  app.get("/api/admin/activities/:activityId/students", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const activityId = (request.params as { activityId: string }).activityId;
    const query = request.query as { limit?: string };
    const take = Math.min(Number(query.limit) || 500, 1000);
    const students = await prisma.student.findMany({
      where: { activityId },
      orderBy: [{ group: { sortOrder: "asc" } }, { orderNo: "asc" }],
      take,
      select: {
        id: true,
        activityId: true,
        groupId: true,
        studentNo: true,
        name: true,
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
      },
    });
    const summaryMap = await getStudentSummaryMap(activityId, students.map((student) => student.id));

    return students.map((student) => ({
      ...student,
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
    await ensureStudentActivityUnlocked((request.params as { id: string }).id);
    const student = await prisma.student.delete({
      where: { id: (request.params as { id: string }).id },
    });
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
    const pendingAssignments: Array<{
      activityId: string;
      studentId: string;
      judgeUserId: string;
      groupId: string;
    }> = [];

    // Process student rows with concurrency (avoid serial upserts)
    const BATCH_CONCURRENCY = 10;
    const validRows = rows.filter((row) => groupMap.get(String(row[4] ?? "")));
    let idx = 0;
    while (idx < validRows.length) {
      const chunk = validRows.slice(idx, idx + BATCH_CONCURRENCY);
      idx += BATCH_CONCURRENCY;
      const students = await Promise.all(
        chunk.map((row) => {
          const group = groupMap.get(String(row[4] ?? ""))!;
          const customRoleName = String(row[6] ?? "").trim();
          const customRole = customRoleName ? customRoleMap.get(customRoleName) : undefined;
          return prisma.student.upsert({
            where: { activityId_studentNo: { activityId, studentNo: String(row[0] ?? "") } },
            update: {
              name: String(row[1] ?? ""),
              gender: String(row[2] ?? ""),
              className: String(row[3] ?? ""),
              groupId: group.id,
              orderNo: Number(row[5] ?? 0),
              customRoleId: customRole?.id ?? undefined,
            },
            create: {
              activityId,
              groupId: group.id,
              studentNo: String(row[0] ?? ""),
              name: String(row[1] ?? ""),
              gender: String(row[2] ?? ""),
              className: String(row[3] ?? ""),
              orderNo: Number(row[5] ?? 0),
              customRoleId: customRole?.id || null,
            },
          }).then((student) => ({ student, row }));
        }),
      );
      for (const { student, row } of students) {
        const group = groupMap.get(String(row[4] ?? ""))!;
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
}
