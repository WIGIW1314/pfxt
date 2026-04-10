import type { FastifyInstance } from "fastify";
import { ScoreStatus, UserRole } from "@prisma/client";
import { prisma } from "../db.js";
import type { AuthRequest } from "../types.js";
import { getStudentSummaryMap, requireAdmin } from "../utils.js";
import { getOnlineSnapshot } from "../websocket.js";

export function registerAdminDashboardRoutes(app: FastifyInstance) {
  app.get("/api/admin/activities/:id/dashboard", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    await requireAdmin(request);
    const activityId = (request.params as { id: string }).id;
    const [onlineSnapshot, groups, students, judgeCount, scoreCount] = await Promise.all([
      getOnlineSnapshot(),
      prisma.group.findMany({
        where: { activityId },
        select: {
          id: true,
          name: true,
        },
      }),
      prisma.student.findMany({
        where: { activityId },
        select: {
          id: true,
          groupId: true,
        },
      }),
      prisma.activityUserRole.count({ where: { activityId, role: UserRole.JUDGE } }),
      prisma.score.count({ where: { activityId, status: ScoreStatus.SUBMITTED } }),
    ]);
    const summaryMap = await getStudentSummaryMap(activityId, students.map((student) => student.id));
    const studentsByGroup = new Map<string, string[]>();
    for (const student of students) {
      const list = studentsByGroup.get(student.groupId) || [];
      list.push(student.id);
      studentsByGroup.set(student.groupId, list);
    }

    const groupStats = groups.map((group) => {
      const groupStudentIds = studentsByGroup.get(group.id) || [];
      let completedCount = 0;
      let hasSubmittedCount = 0;

      for (const studentId of groupStudentIds) {
        const summary = summaryMap.get(studentId);
        if (!summary) continue;
        if (summary.isComplete) completedCount++;
        if (summary.submittedJudgeCount > 0) hasSubmittedCount++;
      }

      return {
        groupId: group.id,
        groupName: group.name,
        studentCount: groupStudentIds.length,
        completedCount,
        progress: groupStudentIds.length === 0
          ? 0
          : Number(
              (
                hasSubmittedCount / groupStudentIds.length
              ).toFixed(2),
            ),
      };
    });

    return {
      activityId,
      activityCount: 1,
      groupCount: groups.length,
      studentCount: students.length,
      judgeCount,
      onlineUserCount: onlineSnapshot.total,
      onlineJudgeCount: onlineSnapshot.judges,
      onlineAdminCount: onlineSnapshot.admins,
      onlineSecretaryCount: onlineSnapshot.secretaries,
      onlineUsers: onlineSnapshot.users,
      completedStudentCount: groupStats.reduce((sum, item) => sum + item.completedCount, 0),
      scoreCount,
      groupStats,
    };
  });
}
