import type { FastifyInstance } from "fastify";
import ExcelJS from "exceljs";
import dayjs from "dayjs";
import { ScoreStatus } from "@prisma/client";
import { prisma } from "../db.js";
import type { AuthRequest } from "../types.js";
import { getStudentSummaryMap, requireAdmin } from "../utils.js";

function isVotingActivity(activity: { type?: string | null } | null | undefined): boolean {
  return activity?.type === "投票";
}

function formatExportScore(value: number | null | undefined, decimalPlaces = 2) {
  if (value === null || value === undefined) return "";
  return Number(value).toFixed(decimalPlaces);
}

function toExcelColumnName(index: number) {
  let current = index;
  let label = "";
  while (current > 0) {
    const remainder = (current - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    current = Math.floor((current - 1) / 26);
  }
  return label;
}

function buildContentDisposition(chineseName: string, fallbackName: string) {
  return `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(chineseName)}`;
}

export function registerAdminExportRoutes(app: FastifyInstance) {
  app.get("/api/admin/activities/:activityId/export/results", { preHandler: [app.authenticate] }, async (request: AuthRequest, reply) => {
    await requireAdmin(request);
    const activityId = (request.params as { activityId: string }).activityId;
    const [activity, results] = await Promise.all([
      prisma.activity.findUniqueOrThrow({
        where: { id: activityId },
        select: { name: true, code: true, avgDecimalPlaces: true, type: true },
      }),
      prisma.student.findMany({
        where: { activityId },
        include: {
          group: true,
          assignments: {
            where: { isRequired: true },
          },
          scores: {
            include: {
              judge: true,
              template: true,
              details: {
                include: { item: true },
                orderBy: { item: { sortOrder: "asc" } },
              },
            },
            orderBy: [{ submittedAt: "asc" }, { updatedAt: "asc" }],
          },
        },
        orderBy: [{ group: { sortOrder: "asc" } }, { orderNo: "asc" }],
      }),
    ]);
    const avgDecimalPlaces = activity.avgDecimalPlaces ?? 2;
    const votingMode = isVotingActivity(activity);

    // ▼ 投票模式导出 ▼
    if (votingMode) {
      const voteScores = await prisma.score.findMany({
        where: { activityId, status: ScoreStatus.SUBMITTED },
        include: { judge: { select: { realName: true } } },
      });
      const voteCountMap = new Map<string, { count: number; judges: string[] }>();
      for (const score of voteScores) {
        const existing = voteCountMap.get(score.studentId) || { count: 0, judges: [] as string[] };
        existing.count++;
        existing.judges.push(score.judge.realName);
        voteCountMap.set(score.studentId, existing);
      }

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "线上评分系统";
      workbook.created = new Date();

      const sheet = workbook.addWorksheet("投票结果");
      sheet.columns = [
        { header: "排名", key: "rankNo", width: 8 },
        { header: "组别", key: "groupName", width: 12 },
        { header: "顺序号", key: "orderNo", width: 10 },
        { header: "学号", key: "studentNo", width: 16 },
        { header: "姓名", key: "name", width: 12 },
        { header: "性别", key: "gender", width: 8 },
        { header: "班级", key: "className", width: 16 },
        { header: "得票数", key: "voteCount", width: 10 },
        { header: "投票评委", key: "judgeNames", width: 36 },
      ];

      const lastCol = toExcelColumnName(sheet.columns!.length);
      sheet.mergeCells(`A1:${lastCol}1`);
      const titleCell = sheet.getCell("A1");
      titleCell.value = `${activity.name} 投票结果表`;
      titleCell.font = { bold: true, size: 18, color: { argb: "1F2D3D" } };
      titleCell.alignment = { horizontal: "center", vertical: "middle" };
      titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "F5F9FF" } };
      sheet.getRow(1).height = 30;

      sheet.mergeCells(`A2:${lastCol}2`);
      sheet.getCell("A2").value = `活动编码：${activity.code}    导出时间：${dayjs().format("YYYY/MM/DD HH:mm:ss")}`;
      sheet.getCell("A2").font = { size: 11, color: { argb: "6B7A99" } };
      sheet.getCell("A2").alignment = { horizontal: "center", vertical: "middle" };
      sheet.getRow(2).height = 22;

      const headerRow = sheet.getRow(3);
      (sheet.columns as ExcelJS.Column[]).forEach((column, index) => {
        const cell = headerRow.getCell(index + 1);
        cell.value = column.header as string;
        cell.font = { bold: true, color: { argb: "2B3A55" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "DDEAFB" } };
        cell.border = { top: { style: "thin", color: { argb: "C9D8EE" } }, left: { style: "thin", color: { argb: "C9D8EE" } }, bottom: { style: "thin", color: { argb: "C9D8EE" } }, right: { style: "thin", color: { argb: "C9D8EE" } } };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      });
      headerRow.height = 24;

      const enriched = results.map((student: any) => {
        const vc = voteCountMap.get(student.id) || { count: 0, judges: [] };
        return { student, voteCount: vc.count, judgeNames: vc.judges.join("、") };
      });

      enriched.sort((a: any, b: any) => b.voteCount - a.voteCount)
        .forEach((item: any, index: number) => {
          const row = sheet.addRow({
            rankNo: index + 1,
            groupName: item.student.group?.name || "",
            orderNo: item.student.orderNo,
            studentNo: item.student.studentNo,
            name: item.student.name,
            gender: item.student.gender || "",
            className: item.student.className || "",
            voteCount: item.voteCount,
            judgeNames: item.judgeNames || "暂无",
          });
          row.height = 24;
          row.eachCell((cell) => {
            cell.border = { top: { style: "thin", color: { argb: "E4ECF8" } }, left: { style: "thin", color: { argb: "E4ECF8" } }, bottom: { style: "thin", color: { argb: "E4ECF8" } }, right: { style: "thin", color: { argb: "E4ECF8" } } };
            cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
            if (row.number % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FAFCFF" } };
          });
        });

      sheet.views = [{ state: "frozen", ySplit: 3 }];
      sheet.autoFilter = `A3:${lastCol}3`;

      const buffer = await workbook.xlsx.writeBuffer();
      reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      reply.header("Content-Disposition", buildContentDisposition(`${activity.name}投票结果表.xlsx`, "voting-results.xlsx"));
      return reply.send(buffer);
    }
    // ▲ 投票模式导出结束 ▼

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "线上评分系统";
    workbook.created = new Date();

    const summarySheet = workbook.addWorksheet("成绩总表");
    const summaryColumns = [
      { header: "排名", key: "rankNo", width: 8 },
      { header: "组别", key: "groupName", width: 12 },
      { header: "顺序号", key: "orderNo", width: 10 },
      { header: "学号", key: "studentNo", width: 16 },
      { header: "姓名", key: "name", width: 12 },
      { header: "性别", key: "gender", width: 8 },
      { header: "班级", key: "className", width: 16 },
      { header: "应评委数", key: "requiredJudgeCount", width: 10 },
      { header: "已提交数", key: "submittedJudgeCount", width: 10 },
      { header: "提交率", key: "submitRate", width: 10 },
      { header: "总分", key: "totalSubmittedScore", width: 12 },
      { header: "平均分", key: "avgScore", width: 12 },
      { header: "最终分", key: "finalScore", width: 12 },
      { header: "完成状态", key: "isComplete", width: 12 },
      { header: "已评分委", key: "judgeNames", width: 24 },
      { header: "评语汇总", key: "comments", width: 34 },
    ];
    summarySheet.columns = summaryColumns;
    const summaryLastColumn = toExcelColumnName(summaryColumns.length);
    summarySheet.mergeCells(`A1:${summaryLastColumn}1`);
    summarySheet.getCell("A1").value = `${activity.name} 成绩汇总表`;
    summarySheet.getCell("A1").font = { bold: true, size: 18, color: { argb: "1F2D3D" } };
    summarySheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
    summarySheet.getCell("A1").fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "F5F9FF" },
    };
    summarySheet.getRow(1).height = 30;

    summarySheet.mergeCells(`A2:${summaryLastColumn}2`);
    summarySheet.getCell("A2").value = `活动编码：${activity.code}    导出时间：${dayjs().format("YYYY/MM/DD HH:mm:ss")}    保留小数位：${avgDecimalPlaces}`;
    summarySheet.getCell("A2").font = { size: 11, color: { argb: "6B7A99" } };
    summarySheet.getCell("A2").alignment = { horizontal: "center", vertical: "middle" };
    summarySheet.getRow(2).height = 22;
    summarySheet.getRow(3).height = 6;

    const summaryHeaderRow = summarySheet.getRow(4);
    summaryColumns.forEach((column, index) => {
      const cell = summaryHeaderRow.getCell(index + 1);
      cell.value = column.header;
      cell.font = { bold: true, color: { argb: "2B3A55" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "DDEAFB" },
      };
      cell.border = {
        top: { style: "thin", color: { argb: "C9D8EE" } },
        left: { style: "thin", color: { argb: "C9D8EE" } },
        bottom: { style: "thin", color: { argb: "C9D8EE" } },
        right: { style: "thin", color: { argb: "C9D8EE" } },
      };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    });
    summaryHeaderRow.height = 24;

    const summaryMap = await getStudentSummaryMap(activityId, results.map((student) => student.id));
    const enrichedResults = results.map((student) => {
      const summary = summaryMap.get(student.id);
      const submittedScores = student.scores.filter((score) => score.status === ScoreStatus.SUBMITTED);
      const totalSubmittedScore = submittedScores.reduce((sum, score) => sum + Number(score.totalScore || 0), 0);
      const judgeNames = submittedScores.map((score) => score.judge.realName).join("、");
      const comments = submittedScores
        .filter((score) => score.comment)
        .map((score) => `${score.judge.realName}：${score.comment}`)
        .join("；");
      const submitRate = student.assignments.length
        ? `${Math.round((submittedScores.length / student.assignments.length) * 100)}%`
        : "0%";
      return {
        student,
        summary,
        totalSubmittedScore,
        judgeNames,
        comments,
        submitRate,
      };
    });

    enrichedResults
      .sort((a, b) => (b.summary.finalScore ?? 0) - (a.summary.finalScore ?? 0))
      .forEach((item, index) => {
        const row = summarySheet.addRow({
          rankNo: index + 1,
          groupName: item.student.group.name,
          orderNo: item.student.orderNo,
          studentNo: item.student.studentNo,
          name: item.student.name,
          gender: item.student.gender || "",
          className: item.student.className || "",
          requiredJudgeCount: item.summary.requiredJudgeCount,
          submittedJudgeCount: item.summary.submittedJudgeCount,
          submitRate: item.submitRate,
          totalSubmittedScore: formatExportScore(item.totalSubmittedScore, avgDecimalPlaces),
          avgScore: formatExportScore(item.summary.avgScore, avgDecimalPlaces),
          finalScore: formatExportScore(item.summary.finalScore, avgDecimalPlaces),
          isComplete: item.summary.isComplete ? "已完成" : "进行中",
          judgeNames: item.judgeNames || "暂无",
          comments: item.comments || "",
        });
        row.height = 24;
        row.eachCell((cell) => {
          cell.border = {
            top: { style: "thin", color: { argb: "E4ECF8" } },
            left: { style: "thin", color: { argb: "E4ECF8" } },
            bottom: { style: "thin", color: { argb: "E4ECF8" } },
            right: { style: "thin", color: { argb: "E4ECF8" } },
          };
          cell.alignment = {
            horizontal: "center",
            vertical: "middle",
            wrapText: true,
          };
          if (row.number % 2 === 1) {
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FAFCFF" },
            };
          }
        });
      });

    summarySheet.views = [{ state: "frozen", ySplit: 4 }];
    summarySheet.autoFilter = `A4:${summaryLastColumn}4`;

    const detailSheet = workbook.addWorksheet("评分明细");
    const detailColumns = [
      { header: "组别", key: "groupName", width: 12 },
      { header: "顺序号", key: "orderNo", width: 10 },
      { header: "学号", key: "studentNo", width: 16 },
      { header: "姓名", key: "name", width: 12 },
      { header: "班级", key: "className", width: 16 },
      { header: "评委姓名", key: "judgeName", width: 14 },
      { header: "评委账号", key: "judgeUsername", width: 16 },
      { header: "评分状态", key: "status", width: 12 },
      { header: "评分模板", key: "templateName", width: 16 },
      { header: "总分", key: "totalScore", width: 12 },
      { header: "分项明细", key: "detailText", width: 42 },
      { header: "评语", key: "comment", width: 28 },
      { header: "提交时间", key: "submittedAt", width: 18 },
    ];
    detailSheet.columns = detailColumns;
    const detailLastColumn = toExcelColumnName(detailColumns.length);
    detailSheet.mergeCells(`A1:${detailLastColumn}1`);
    detailSheet.getCell("A1").value = `${activity.name} 评分明细表`;
    detailSheet.getCell("A1").font = { bold: true, size: 18, color: { argb: "1F2D3D" } };
    detailSheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
    detailSheet.getRow(1).height = 30;

    const detailHeaderRow = detailSheet.getRow(3);
    detailColumns.forEach((column, index) => {
      const cell = detailHeaderRow.getCell(index + 1);
      cell.value = column.header;
      cell.font = { bold: true, color: { argb: "2B3A55" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "E7F1FF" },
      };
      cell.border = {
        top: { style: "thin", color: { argb: "C9D8EE" } },
        left: { style: "thin", color: { argb: "C9D8EE" } },
        bottom: { style: "thin", color: { argb: "C9D8EE" } },
        right: { style: "thin", color: { argb: "C9D8EE" } },
      };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    });
    detailHeaderRow.height = 24;

    for (const student of results) {
      for (const score of student.scores) {
        const detailText = score.details
          .map((detail) => `${detail.item.name}:${formatExportScore(detail.scoreValue, avgDecimalPlaces)}`)
          .join("；");
        const row = detailSheet.addRow({
          groupName: student.group.name,
          orderNo: student.orderNo,
          studentNo: student.studentNo,
          name: student.name,
          className: student.className || "",
          judgeName: score.judge.realName,
          judgeUsername: score.judge.username,
          status: score.status === ScoreStatus.SUBMITTED ? "已提交" : "草稿",
          templateName: score.template?.name || "",
          totalScore: formatExportScore(score.totalScore, avgDecimalPlaces),
          detailText,
          comment: score.comment || "",
          submittedAt: score.submittedAt ? dayjs(score.submittedAt).format("YYYY/MM/DD HH:mm:ss") : "",
        });
        row.height = 24;
        row.eachCell((cell) => {
          cell.border = {
            top: { style: "thin", color: { argb: "E4ECF8" } },
            left: { style: "thin", color: { argb: "E4ECF8" } },
            bottom: { style: "thin", color: { argb: "E4ECF8" } },
            right: { style: "thin", color: { argb: "E4ECF8" } },
          };
          cell.alignment = {
            horizontal: "center",
            vertical: "middle",
            wrapText: true,
          };
        });
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const chineseName = `${activity.name}成绩汇总表.xlsx`;
    reply.header("Content-Disposition", buildContentDisposition(chineseName, "activity-results.xlsx"));
    return reply.send(buffer);
  });
}
