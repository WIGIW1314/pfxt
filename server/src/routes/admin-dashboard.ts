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
    const onlineSnapshot = await getOnlineSnapshot();
    const [groups, students, judges, submittedScores] = await Promise.all([
      prisma.group.findMany({ where: { activityId } }),
      prisma.student.findMany({ where: { activityId } }),
      prisma.activityUserRole.findMany({ where: { activityId, role: UserRole.JUDGE } }),
      prisma.score.findMany({ where: { activityId, status: ScoreStatus.SUBMITTED } }),
    ]);
    const summaryMap = await getStudentSummaryMap(activityId, students.map((student) => student.id));

    const groupStats = groups.map((group) => {
      const groupStudents = students.filter((student) => student.groupId === group.id);
      const completed = groupStudents
        .map((student) => summaryMap.get(student.id))
        .filter((item) => Boolean(item));

      return {
        groupId: group.id,
        groupName: group.name,
        studentCount: groupStudents.length,
        completedCount: completed.filter((item) => item?.isComplete).length,
        progress: groupStudents.length === 0
          ? 0
          : Number(
              (
                completed.filter((item) => item && item.submittedJudgeCount > 0).length / groupStudents.length
              ).toFixed(2),
            ),
      };
    });

    return {
      activityId,
      activityCount: 1,
      groupCount: groups.length,
      studentCount: students.length,
      judgeCount: judges.length,
      onlineUserCount: onlineSnapshot.total,
      onlineJudgeCount: onlineSnapshot.judges,
      onlineAdminCount: onlineSnapshot.admins,
      onlineSecretaryCount: onlineSnapshot.secretaries,
      onlineUsers: onlineSnapshot.users,
      completedStudentCount: groupStats.reduce((sum, item) => sum + item.completedCount, 0),
      scoreCount: submittedScores.length,
      groupStats,
    };
  });
}
