import { ActivityCalcMode, ScoreStatus, UserRole } from "@prisma/client";
import ExcelJS from "exceljs";
import { prisma } from "./db.js";
import type { AuthRequest, ScoreSummary } from "./types.js";

export function createHttpError(message: string, statusCode = 400) {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

export function toDateOrNull(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    // ExcelJS 将单元格日期解析为 UTC，需将 UTC 分量视为本地（北京）时间
    return new Date(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(),
      value.getUTCHours(), value.getUTCMinutes(), value.getUTCSeconds());
  }
  const s = String(value).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function requireAdmin(request: AuthRequest) {
  if (request.user.role === UserRole.SUPER_ADMIN || request.user.role === UserRole.ACTIVITY_ADMIN) {
    return;
  }

  throw createHttpError("无权限访问", 403);
}

export async function getCurrentJudgeActivity(userId: string) {
  return prisma.activityUserRole.findFirst({
    where: {
      userId,
      role: { in: [UserRole.JUDGE, UserRole.SECRETARY] },
      activity: { isActive: true },
    },
    include: {
      activity: {
        include: {
          templates: { include: { items: { orderBy: { sortOrder: "asc" } } } },
        },
      },
      group: true,
      customRole: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });
}

export function calcSummary(
  calcMode: ActivityCalcMode,
  submittedScores: Array<{ totalScore: number }>,
  requiredJudgeCount: number,
  avgDecimalPlaces = 2,
): ScoreSummary {
  const submittedJudgeCount = submittedScores.length;
  const isComplete = requiredJudgeCount > 0 && submittedJudgeCount >= requiredJudgeCount;

  if (submittedJudgeCount === 0) {
    return {
      requiredJudgeCount,
      submittedJudgeCount,
      avgScore: null,
      finalScore: null,
      isComplete: false,
    };
  }

  const rawScores = submittedScores.map((item) => item.totalScore);
  let scoresForCalc = [...rawScores];

  if (calcMode === ActivityCalcMode.DROP_EXTREMES && rawScores.length > 2) {
    const sorted = [...rawScores].sort((a, b) => a - b);
    scoresForCalc = sorted.slice(1, sorted.length - 1);
  }

  const avg = Number(
    (scoresForCalc.reduce((sum, score) => sum + score, 0) / scoresForCalc.length).toFixed(avgDecimalPlaces),
  );

  const finalScore = calcMode === ActivityCalcMode.ALL_SUBMITTED && !isComplete ? null : avg;

  return {
    requiredJudgeCount,
    submittedJudgeCount,
    avgScore: avg,
    finalScore,
    isComplete,
  };
}

export async function getStudentSummary(activityId: string, studentId: string) {
  const summaryMap = await getStudentSummaryMap(activityId, [studentId]);
  return summaryMap.get(studentId) || calcSummary(ActivityCalcMode.SIMPLE_AVG, [], 0, 2);
}

export async function getStudentSummaryMap(activityId: string, studentIds: string[]) {
  const uniqueStudentIds = Array.from(new Set(studentIds.filter(Boolean)));
  const summaryMap = new Map<string, ScoreSummary>();

  if (!uniqueStudentIds.length) {
    return summaryMap;
  }

  const [activity, assignmentRows, scoreRows] = await Promise.all([
    prisma.activity.findUniqueOrThrow({
      where: { id: activityId },
      select: {
        calcMode: true,
        avgDecimalPlaces: true,
      },
    }),
    prisma.scoreAssignment.groupBy({
      by: ["studentId"],
      where: {
        activityId,
        studentId: { in: uniqueStudentIds },
        isRequired: true,
      },
      _count: { _all: true },
    }),
    prisma.score.findMany({
      where: {
        activityId,
        studentId: { in: uniqueStudentIds },
        status: ScoreStatus.SUBMITTED,
      },
      select: {
        studentId: true,
        totalScore: true,
      },
    }),
  ]);

  const requiredJudgeCountMap = new Map(
    assignmentRows.map((row) => [row.studentId, row._count._all]),
  );
  const submittedScoreMap = new Map<string, Array<{ totalScore: number }>>();

  for (const score of scoreRows) {
    const list = submittedScoreMap.get(score.studentId) || [];
    list.push({ totalScore: score.totalScore });
    submittedScoreMap.set(score.studentId, list);
  }

  for (const studentId of uniqueStudentIds) {
    summaryMap.set(
      studentId,
      calcSummary(
        activity.calcMode,
        submittedScoreMap.get(studentId) || [],
        requiredJudgeCountMap.get(studentId) || 0,
        activity.avgDecimalPlaces ?? 2,
      ),
    );
  }

  return summaryMap;
}

export async function createWorkbookTemplate(
  sheetName: string,
  columns: Array<{ header: string; key: string; width?: number }>,
  sampleRows: Array<Record<string, string | number>>,
) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = columns;
  sampleRows.forEach((row) => sheet.addRow(row));
  sheet.getRow(1).font = { bold: true };
  return workbook.xlsx.writeBuffer();
}

function isOutsideTimeWindow(startTime?: Date | null, endTime?: Date | null) {
  if (!startTime && !endTime) return false;
  const now = new Date();
  if (startTime && now < startTime) return true;
  if (endTime && now > endTime) return true;
  return false;
}

export async function ensureActivityUnlocked(activityId: string) {
  const activity = await prisma.activity.findUniqueOrThrow({
    where: { id: activityId },
    select: {
      id: true,
      isLocked: true,
      startTime: true,
      endTime: true,
      name: true,
    },
  });

  if (activity.isLocked) {
    throw createHttpError("当前活动已锁定，只读", 423);
  }

  if (isOutsideTimeWindow(activity.startTime, activity.endTime)) {
    throw createHttpError("当前不在活动开放时间内", 423);
  }

  return activity;
}

export async function ensureGroupUnlocked(groupId: string) {
  const group = await prisma.group.findUniqueOrThrow({
    where: { id: groupId },
    select: {
      id: true,
      isLocked: true,
      startTime: true,
      endTime: true,
      name: true,
      activityId: true,
    },
  });

  if (group.isLocked) {
    throw createHttpError(`分组「${group.name}」已锁定，只读`, 423);
  }

  if (isOutsideTimeWindow(group.startTime, group.endTime)) {
    throw createHttpError(`当前不在分组「${group.name}」的开放时间内`, 423);
  }

  return group;
}

export async function ensureGroupActivityUnlocked(groupId: string) {
  const group = await prisma.group.findUniqueOrThrow({
    where: { id: groupId },
    select: {
      activityId: true,
    },
  });

  await ensureActivityUnlocked(group.activityId);
  return group;
}

export async function ensureStudentActivityUnlocked(studentId: string) {
  const student = await prisma.student.findUniqueOrThrow({
    where: { id: studentId },
    select: {
      activityId: true,
    },
  });

  await ensureActivityUnlocked(student.activityId);
  return student;
}

export async function ensureTemplateActivityUnlocked(templateId: string) {
  const template = await prisma.scoreTemplate.findUniqueOrThrow({
    where: { id: templateId },
    select: {
      activityId: true,
    },
  });

  await ensureActivityUnlocked(template.activityId);
  return template;
}

export async function logOperation(input: {
  operatorId?: string;
  operatorName: string;
  module: string;
  action: string;
  targetType: string;
  targetId?: string;
  beforeData?: unknown;
  afterData?: unknown;
}) {
  await prisma.operationLog.create({
    data: {
      operatorId: input.operatorId,
      operatorName: input.operatorName,
      module: input.module,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      beforeData: input.beforeData ? JSON.stringify(input.beforeData) : null,
      afterData: input.afterData ? JSON.stringify(input.afterData) : null,
    },
  });
}
