import type { FastifyInstance } from "fastify";
import { ScoreStatus, UserRole } from "@prisma/client";
import ExcelJS from "exceljs";
import dayjs from "dayjs";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
  convertInchesToTwip,
} from "docx";
import PDFDocument from "pdfkit";
import JSZip from "jszip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { prisma } from "../db.js";
import type { AuthRequest } from "../types.js";
import { broadcast } from "../websocket.js";
import { ensureActivityUnlocked, ensureGroupUnlocked, createHttpError, getCurrentJudgeActivity, getStudentSummary, getStudentSummaryMap, logOperation } from "../utils.js";

const AI_API_URL = process.env.AI_API_URL?.trim() || process.env.OLLAMA_API_URL?.trim() || "http://127.0.0.1:11434/api/chat";
const AI_MODEL = process.env.AI_MODEL?.trim() || process.env.OLLAMA_MODEL?.trim() || "qwen3:8b";
const AI_THINK = process.env.AI_THINK?.trim() || process.env.OLLAMA_THINK?.trim() || "";

function isChatApiUrl(url: string) {
  return /\/api\/chat(?:[/?#]|$)/i.test(url);
}

function buildAiRequestBody(prompt: string) {
  if (isChatApiUrl(AI_API_URL)) {
    const payload: {
      model: string;
      messages: Array<{ role: "user"; content: string }>;
      stream: false;
      think?: string;
    } = {
      model: AI_MODEL,
      messages: [
        { role: "user", content: prompt },
      ],
      stream: false,
    };

    if (AI_THINK) {
      payload.think = AI_THINK;
    }

    return payload;
  }

  return {
    model: AI_MODEL,
    prompt,
    stream: false,
  };
}

function extractAiText(data: { message?: { content?: unknown }; response?: unknown }) {
  if (typeof data.message?.content === "string") {
    return data.message.content;
  }
  if (typeof data.response === "string") {
    return data.response;
  }
  return "";
}

function resolveExistingPath(candidates: string[]) {
  for (const item of candidates) {
    if (fsSync.existsSync(item)) {
      return item;
    }
  }
  return candidates[0];
}

function compactPaths(items: Array<string | undefined>) {
  return items.filter((item): item is string => Boolean(item && item.trim()));
}

const currentFileDir = path.dirname(fileURLToPath(import.meta.url));
const PRIVATE_ASSETS_DIR = process.env.PRIVATE_ASSETS_DIR?.trim();
const SIGNATURE_DIR = resolveExistingPath(compactPaths([
  process.env.SIGNATURE_DIR ? path.resolve(process.env.SIGNATURE_DIR) : undefined,
  PRIVATE_ASSETS_DIR ? path.resolve(PRIVATE_ASSETS_DIR, "签名") : undefined,
  path.resolve(process.cwd(), "../pfxt-private/签名"),
  path.resolve(process.cwd(), "private/签名"),
  path.resolve(process.cwd(), "web/public/签名"),
  path.resolve(process.cwd(), "../web/public/签名"),
  path.resolve(currentFileDir, "../../../pfxt-private/签名"),
  path.resolve(currentFileDir, "../../../private/签名"),
  path.resolve(currentFileDir, "../../../web/public/签名"),
  path.resolve(currentFileDir, "../../../../pfxt-private/签名"),
  path.resolve(currentFileDir, "../../../../private/签名"),
  path.resolve(currentFileDir, "../../../../web/public/签名"),
]));
const PDF_FONT_PATH = [
  "C:\\Windows\\Fonts\\msyh.ttc",
  "C:\\Windows\\Fonts\\msyh.ttf",
  "C:\\Windows\\Fonts\\simhei.ttf",
  "C:\\Windows\\Fonts\\simsun.ttc",
].find((item) => fsSync.existsSync(item));

const DOCX_TEMPLATE_PATH = resolveExistingPath(compactPaths([
  process.env.DOCX_TEMPLATE_PATH ? path.resolve(process.env.DOCX_TEMPLATE_PATH) : undefined,
  PRIVATE_ASSETS_DIR ? path.resolve(PRIVATE_ASSETS_DIR, "微格教学技能评价表.docx") : undefined,
  path.resolve(process.cwd(), "../pfxt-private/微格教学技能评价表.docx"),
  path.resolve(process.cwd(), "private/微格教学技能评价表.docx"),
  path.resolve(process.cwd(), "web/public/微格教学技能评价表.docx"),
  path.resolve(process.cwd(), "../web/public/微格教学技能评价表.docx"),
  path.resolve(currentFileDir, "../../../pfxt-private/微格教学技能评价表.docx"),
  path.resolve(currentFileDir, "../../../private/微格教学技能评价表.docx"),
  path.resolve(currentFileDir, "../../../web/public/微格教学技能评价表.docx"),
  path.resolve(currentFileDir, "../../../../pfxt-private/微格教学技能评价表.docx"),
  path.resolve(currentFileDir, "../../../../private/微格教学技能评价表.docx"),
  path.resolve(currentFileDir, "../../../../web/public/微格教学技能评价表.docx"),
]));

function normalizeAiComment(raw: string) {
  const compact = String(raw || "")
    .replace(/[\r\n]+/g, "")
    .replace(/\s+/g, "")
    .replace(/["'“”‘’]/g, "")
    .trim();

  if (!compact) return "";

  const normalized = compact.replace(/[；;。.!！？?、]+/g, "|");
  const parts = normalized
    .split("|")
    .map((item) => item.trim().replace(/^[，,;；。、]+|[，,;；。、]+$/g, ""))
    .filter(Boolean)
    .filter((item) => item.length >= 6)
    .filter((item) => item.length <= 32);

  if (parts.length >= 2) {
    return parts.slice(0, 2).join("；");
  }

  if (parts.length === 1) {
    return parts[0];
  }

  const fallback = compact
    .replace(/[。.!！？?]/g, "")
    .replace(/[；;]/g, "；")
    .replace(/[，,]{2,}/g, "，")
    .replace(/[,，;；、]+$/g, "")
    .slice(0, 36)
    .replace(/[，,;；、]+$/g, "");

  return fallback || "教学思路清晰，整体表现自然";
}

function normalizeAiQuestions(raw: string) {
  const compact = String(raw || "")
    .replace(/[\r\n]+/g, "|")
    .replace(/["'“”‘’]/g, "")
    .trim();

  if (!compact) return [] as string[];

  const parts = compact
    .replace(/[；;。！？!?]+/g, "|")
    .split("|")
    .map((item) => item.trim())
    .map((item) => item.replace(/^[0-9一二三四五六七八九十]+[、.)）]?\s*/g, ""))
    .map((item) => item.replace(/^问题[:：]?/g, ""))
    .map((item) => item.replace(/[？?]+$/g, ""))
    .filter(Boolean)
    .filter((item) => item.length <= 30)
    .slice(0, 2)
    .map((item) => `${item}？`);

  return parts;
}

function getCommentToneGuide(totalScore: number) {
  if (totalScore < 60) {
    return "总评语气：明显指出不足，语气保持克制客观，优先点出需要改进的教学问题，不要写成鼓励口号。";
  }
  if (totalScore < 70) {
    return "总评语气：以问题为主，适当保留少量中性评价，突出基础能力仍需加强。";
  }
  if (totalScore < 80) {
    return "总评语气：中等偏稳，既写出已有表现，也点出1个较明显短板，语气平衡。";
  }
  if (totalScore < 90) {
    return "总评语气：整体肯定为主，可轻点一个细节改进方向，避免写得过满。";
  }
  if (totalScore < 100) {
    return "总评语气：明显肯定学生优势，突出亮点表现，措辞积极但不要夸张失真。";
  }
  return "总评语气：高度肯定整体表现，重点突出教学亮点、表达成熟度和课堂把控力。";
}

function summarizeScoreDetails(scoreDetails: Array<{
  name: string;
  maxScore: number;
  scoreValue: number;
  description?: string | null;
}>) {
  const items = scoreDetails.map((item) => ({
    ...item,
    ratio: item.maxScore > 0 ? item.scoreValue / item.maxScore : 0,
  }));
  const sorted = [...items].sort((a, b) => b.ratio - a.ratio || b.scoreValue - a.scoreValue);
  const strengths = sorted
    .filter((item) => item.ratio >= 0.85)
    .slice(0, 2)
    .map((item) => item.name);
  const weaknesses = [...sorted]
    .reverse()
    .filter((item) => item.ratio <= 0.65)
    .slice(0, 2)
    .map((item) => item.name);

  return {
    strengths,
    weaknesses,
  };
}

function buildCommentPrompt(params: {
  totalScore: number;
  customPrompt?: string;
  scoreDetails?: Array<{
    name: string;
    maxScore: number;
    scoreValue: number;
    description?: string | null;
  }>;
}) {
  const lines = [
    "你现在是师范生面试讲课评委，请根据下面的评分信息生成1句或2句简短评语。",
    params.customPrompt
      ? `额外要求：${params.customPrompt}`
      : "要求：结合分数高低判断学生表现，评语要贴合具体表现，不要空泛套话。",
    getCommentToneGuide(params.totalScore),
    "输出要求：每句12到28字；句意必须完整自然；不要半句停住；不要换行；不要编号；不要解释；句子之间用中文分号连接，不要用句号；只输出最终评语。",
  ];

  if (params.scoreDetails?.length) {
    const { strengths, weaknesses } = summarizeScoreDetails(params.scoreDetails);
    lines.push(`总分：${params.totalScore}分。`);
    lines.push("评分标准与得分：");
    params.scoreDetails.forEach((item, index) => {
      const description = item.description ? `；说明：${item.description}` : "";
      lines.push(`${index + 1}. ${item.name}（满分${item.maxScore}分）：得分${item.scoreValue}分${description}`);
    });
    if (strengths.length) {
      lines.push(`优先参考的亮点项：${strengths.join("、")}。`);
    }
    if (weaknesses.length) {
      lines.push(`优先参考的短板项：${weaknesses.join("、")}。`);
    }
    lines.push("写评语时优先依据高低分项判断学生的具体强弱，不要只复述总分。");
  } else {
    lines.push(`总分：${params.totalScore}分。`);
    lines.push("由于只有总分，没有分项明细，请按总分区间生成符合水平的整体评价。");
  }

  return lines.join("\n");
}

async function generateCommentByOllama(params: {
  totalScore: number;
  customPrompt?: string;
  scoreDetails?: Array<{
    name: string;
    maxScore: number;
    scoreValue: number;
    description?: string | null;
  }>;
}) {
  const customPrompt = params.customPrompt?.trim();
  const prompt = customPrompt || buildCommentPrompt(params);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(AI_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildAiRequestBody(prompt)),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw createHttpError(`AI 调用失败: ${response.status}`, 502);
    }

    const data = await response.json() as { message?: { content?: unknown }; response?: unknown };
    const rawText = extractAiText(data);
    if (!rawText) {
      throw createHttpError("AI 返回格式异常", 502);
    }
    if (customPrompt) {
      return rawText;
    }
    const text = normalizeAiComment(rawText);
    if (!text) {
      throw createHttpError("未生成有效评语", 502);
    }
    return text;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw createHttpError("AI 评语生成超时，请稍后重试", 504);
    }
    if ((err as { statusCode?: number })?.statusCode) throw err;
    throw createHttpError("AI 服务连接失败，请检查 Ollama 是否运行", 502);
  } finally {
    clearTimeout(timer);
  }
}

async function generateQuestionsByOllama(topic: string) {
  const prompt = `你现在是师范生面试考官，请围绕主题“${topic}”生成1到2个现场提问问题。要求：题目不要太难，适合师范生面试或讲课后的追问；语气自然；每题不超过30字；不要换行解释；不要答案；只输出题目本身。`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(AI_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildAiRequestBody(prompt)),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw createHttpError(`AI 调用失败: ${response.status}`, 502);
    }

    const data = await response.json() as { message?: { content?: unknown }; response?: unknown };
    const rawText = extractAiText(data);
    if (!rawText) {
      throw createHttpError("AI 返回格式异常", 502);
    }
    const questions = normalizeAiQuestions(rawText);
    if (!questions.length) {
      throw createHttpError("未生成有效问题", 502);
    }
    return questions;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw createHttpError("AI 问题生成超时，请稍后重试", 504);
    }
    if ((err as { statusCode?: number })?.statusCode) throw err;
    throw createHttpError("AI 服务连接失败，请检查 Ollama 是否运行", 502);
  } finally {
    clearTimeout(timer);
  }
}

function validateScoreInput(
  body: { totalScore: number; details: Array<{ itemId: string; scoreValue: number }> },
  template: { totalScore: number; scoreMode: string; items: Array<{ id: string; maxScore: number; name: string }> },
) {
  if (body.totalScore < 0 || body.totalScore > template.totalScore) {
    throw createHttpError(`总分应在0-${template.totalScore}之间`, 400);
  }
  if (template.scoreMode !== "TOTAL") {
    let detailSum = 0;
    for (const detail of body.details) {
      const item = template.items.find((i) => i.id === detail.itemId);
      if (!item) throw createHttpError(`评分项不存在: ${detail.itemId}`, 400);
      if (detail.scoreValue < 0 || detail.scoreValue > item.maxScore) {
        throw createHttpError(`「${item.name}」分数应在0-${item.maxScore}之间`, 400);
      }
      detailSum += detail.scoreValue;
    }
    if (Math.round(detailSum * 100) !== Math.round(body.totalScore * 100)) {
      throw createHttpError(`各项分数之和(${detailSum})与总分(${body.totalScore})不一致`, 400);
    }
  }
}

function buildContentDisposition(filename: string, fallback: string) {
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function toExcelColumnName(index: number) {
  let result = "";
  let current = index;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }
  return result;
}

function formatExportScore(value: number | null | undefined, decimalPlaces = 2) {
  if (value === null || value === undefined) return "";
  return Number(value).toFixed(decimalPlaces);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
) {
  if (items.length === 0) {
    return [] as R[];
  }

  const results = new Array<R>(items.length);
  let currentIndex = 0;

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (currentIndex < items.length) {
      const index = currentIndex;
      currentIndex += 1;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}

async function getJudgeExportContext(activityId: string, userId: string) {
  const binding = await prisma.activityUserRole.findFirstOrThrow({
    where: {
      activityId,
      userId,
      role: { in: [UserRole.JUDGE, UserRole.SECRETARY] },
      groupId: { not: null },
    },
    include: {
      activity: {
        include: {
          templates: {
            include: {
              items: { orderBy: { sortOrder: "asc" } },
            },
          },
        },
      },
      group: true,
    },
  });
  const { template } = await getEffectiveTemplate(activityId);

  const rawStudents = await prisma.student.findMany({
    where: {
      activityId,
      groupId: binding.groupId!,
    },
    include: {
      scores: {
        where: { judgeUserId: userId },
        include: {
          details: true,
        },
      },
    },
    orderBy: { orderNo: "asc" },
  });
  const studentIds = rawStudents.map((student) => student.id);
  const [summaryMap, submittedScores] = await Promise.all([
    getStudentSummaryMap(activityId, studentIds),
    prisma.score.findMany({
      where: {
        activityId,
        studentId: { in: studentIds },
        status: ScoreStatus.SUBMITTED,
      },
      select: {
        studentId: true,
        totalScore: true,
      },
    }),
  ]);

  const submittedScoreMap = new Map<string, Array<{ totalScore: number }>>();
  for (const score of submittedScores) {
    const list = submittedScoreMap.get(score.studentId) || [];
    list.push({ totalScore: score.totalScore });
    submittedScoreMap.set(score.studentId, list);
  }

  const exportMetricsMap = new Map<string, { totalScore: number; judgeCount: number; avgScore: string }>();
  for (const studentId of studentIds) {
    const studentScores = submittedScoreMap.get(studentId) || [];
    const summary = summaryMap.get(studentId);
    exportMetricsMap.set(studentId, {
      totalScore: studentScores.reduce((sum, item) => sum + Number(item.totalScore || 0), 0),
      judgeCount: studentScores.length,
      avgScore: formatExportScore(summary?.avgScore, binding.activity.avgDecimalPlaces ?? 2),
    });
  }

  const students = rawStudents.map((student) => ({
    ...student,
    summary: summaryMap.get(student.id) || null,
  }));

  return {
    binding,
    students,
    exportMetricsMap,
  };
}

async function getEffectiveTemplate(activityId: string, requestedTemplateId?: string) {
  const activity = await prisma.activity.findUniqueOrThrow({
    where: { id: activityId },
    include: {
      templates: {
        include: {
          items: { orderBy: { sortOrder: "asc" } },
        },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      },
    },
  });

  const selectedTemplate =
    activity.templates.find((item) => item.id === requestedTemplateId) ||
    activity.templates.find((item) => item.id === activity.activeTemplateId) ||
    activity.templates.find((item) => item.isDefault) ||
    activity.templates[0];

  if (!selectedTemplate) {
    throw new Error("当前活动尚未配置评分模板");
  }

  return { activity, template: selectedTemplate };
}

async function ensureJudgeAccess(activityId: string, studentId: string, userId: string) {
  const student = await prisma.student.findUniqueOrThrow({
    where: { id: studentId },
    select: {
      id: true,
      groupId: true,
    },
  });

  let assignment = await prisma.scoreAssignment.findUnique({
    where: {
      activityId_studentId_judgeUserId: {
        activityId,
        studentId,
        judgeUserId: userId,
      },
    },
  });

  if (assignment) {
    return { student, assignment };
  }

  const binding = await prisma.activityUserRole.findFirst({
    where: {
      activityId,
      userId,
      role: { in: [UserRole.JUDGE, UserRole.SECRETARY] },
      groupId: student.groupId,
    },
  });

  if (!binding) {
    throw new Error("你没有该学生的评分权限");
  }

  assignment = await prisma.scoreAssignment.create({
    data: {
      activityId,
      studentId,
      judgeUserId: userId,
      groupId: student.groupId,
      isRequired: binding.role === UserRole.JUDGE,
    },
  });

  return { student, assignment };
}

async function getAnonymousPeerScores(activityId: string, studentId: string, currentUserId: string) {
  const student = await prisma.student.findUniqueOrThrow({
    where: { id: studentId },
    select: { groupId: true },
  });
  const [bindings, scores] = await Promise.all([
    prisma.activityUserRole.findMany({
      where: {
        activityId,
        groupId: student.groupId,
        role: UserRole.JUDGE,
      },
      orderBy: [{ createdAt: "asc" }],
    }),
    prisma.score.findMany({
      where: {
        activityId,
        studentId,
        judgeUserId: { not: currentUserId },
      },
      orderBy: [{ submittedAt: "desc" }, { updatedAt: "desc" }],
      include: {
        details: true,
      },
    }),
  ]);

  const aliasMap = new Map(
    bindings.map((item, index) => [item.userId, `评委${index + 1}`]),
  );

  return scores
    .filter((score) => aliasMap.has(score.judgeUserId))
    .map((score) => ({
      id: score.id,
      anonymousCode: aliasMap.get(score.judgeUserId),
      totalScore: score.totalScore,
      status: score.status,
      comment: score.comment,
      submittedAt: score.submittedAt,
      details: score.details,
    }));
}

function normalizeNameForMatch(name: string) {
  return String(name || "")
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, "")
    .toLowerCase();
}

async function loadSignatureFileMap() {
  const map = new Map<string, string>();
  if (!fsSync.existsSync(SIGNATURE_DIR)) return map;
  const files = await fs.readdir(SIGNATURE_DIR);
  for (const filename of files) {
    const ext = path.extname(filename).toLowerCase();
    if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext)) continue;
    const base = path.basename(filename, ext);
    const normalized = normalizeNameForMatch(base);
    if (normalized && !map.has(normalized)) {
      map.set(normalized, path.resolve(SIGNATURE_DIR, filename));
    }
  }
  return map;
}

function pickRandomComment(comments: string[]) {
  if (!comments.length) return "";
  const index = Math.floor(Math.random() * comments.length);
  return comments[index];
}

function ensureRunFont(doc: any, run: any, fontName: string) {
  if (!run || !fontName) return;
  let runPr = run.getElementsByTagName("w:rPr")[0];
  if (!runPr) {
    runPr = doc.createElement("w:rPr");
    if (run.firstChild) {
      run.insertBefore(runPr, run.firstChild);
    } else {
      run.appendChild(runPr);
    }
  }
  let fonts = runPr.getElementsByTagName("w:rFonts")[0];
  if (!fonts) {
    fonts = doc.createElement("w:rFonts");
    runPr.appendChild(fonts);
  }
  fonts.setAttribute("w:ascii", fontName);
  fonts.setAttribute("w:hAnsi", fontName);
  fonts.setAttribute("w:eastAsia", fontName);
  fonts.setAttribute("w:cs", fontName);
}

function ensureRunFontSize(doc: any, run: any, halfPointSize: number) {
  if (!run || !halfPointSize) return;
  let runPr = run.getElementsByTagName("w:rPr")[0];
  if (!runPr) {
    runPr = doc.createElement("w:rPr");
    if (run.firstChild) {
      run.insertBefore(runPr, run.firstChild);
    } else {
      run.appendChild(runPr);
    }
  }
  let sz = runPr.getElementsByTagName("w:sz")[0];
  if (!sz) {
    sz = doc.createElement("w:sz");
    runPr.appendChild(sz);
  }
  let szCs = runPr.getElementsByTagName("w:szCs")[0];
  if (!szCs) {
    szCs = doc.createElement("w:szCs");
    runPr.appendChild(szCs);
  }
  const value = String(halfPointSize);
  sz.setAttribute("w:val", value);
  szCs.setAttribute("w:val", value);
}

function applyParagraphRunStyle(doc: any, paragraph: any, options?: { fontName?: string; halfPointSize?: number }) {
  if (!paragraph || !options) return;
  const runs = Array.from(paragraph.getElementsByTagName("w:r"));
  if (!runs.length) {
    const run = doc.createElement("w:r");
    paragraph.appendChild(run);
    if (options.fontName) ensureRunFont(doc, run, options.fontName);
    if (options.halfPointSize) ensureRunFontSize(doc, run, options.halfPointSize);
    return;
  }
  for (const run of runs as any[]) {
    if (options.fontName) ensureRunFont(doc, run, options.fontName);
    if (options.halfPointSize) ensureRunFontSize(doc, run, options.halfPointSize);
  }
}

function setParagraphText(doc: any, paragraph: any, text: string, fontName?: string, halfPointSize?: number) {
  if (!paragraph) return;
  const texts = paragraph.getElementsByTagName("w:t");
  if (texts.length > 0) {
    texts[0].textContent = text;
    for (let i = 1; i < texts.length; i += 1) {
      texts[i].textContent = "";
    }
    applyParagraphRunStyle(doc, paragraph, { fontName, halfPointSize });
    return;
  }

  let run = paragraph.getElementsByTagName("w:r")[0];
  if (!run) {
    run = doc.createElement("w:r");
    paragraph.appendChild(run);
  }
  const textNode = doc.createElement("w:t");
  textNode.appendChild(doc.createTextNode(text));
  run.appendChild(textNode);
  ensureRunFont(doc, run, fontName || "");
  if (halfPointSize) ensureRunFontSize(doc, run, halfPointSize);
}

function setCellText(doc: any, cell: any, text: string, fontName?: string, halfPointSize?: number) {
  if (!cell) return;
  let p = cell.getElementsByTagName("w:p")[0];
  if (!p) {
    p = doc.createElement("w:p");
    cell.appendChild(p);
  }
  setParagraphText(doc, p, text, fontName, halfPointSize);
}

function getImageContentType(ext: string) {
  const normalized = ext.toLowerCase();
  if (normalized === ".png") return "image/png";
  if (normalized === ".jpg" || normalized === ".jpeg") return "image/jpeg";
  if (normalized === ".webp") return "image/webp";
  return "application/octet-stream";
}

function ensureDocxImageContentType(zip: JSZip, ext: string) {
  const file = zip.file("[Content_Types].xml");
  if (!file) return;
  const lowerExt = ext.replace(/^\./, "").toLowerCase();
  const xmlPromise = file.async("string");
  return xmlPromise.then((xml) => {
    const dom = new DOMParser().parseFromString(xml, "application/xml");
    const defaults = Array.from(dom.getElementsByTagName("Default"));
    const exists = defaults.some((item: any) => (item.getAttribute("Extension") || "").toLowerCase() === lowerExt);
    if (!exists) {
      const node = dom.createElement("Default");
      node.setAttribute("Extension", lowerExt);
      node.setAttribute("ContentType", getImageContentType(`.${lowerExt}`));
      dom.documentElement.appendChild(node);
      zip.file("[Content_Types].xml", new XMLSerializer().serializeToString(dom));
    }
  });
}

function appendSignatureImageRun(doc: any, paragraph: any, relationId: string, imageName: string) {
  if (!paragraph) return;
  const run = doc.createElement("w:r");
  const drawing = doc.createElement("w:drawing");
  const inline = doc.createElement("wp:inline");
  inline.setAttribute("distT", "0");
  inline.setAttribute("distB", "0");
  inline.setAttribute("distL", "0");
  inline.setAttribute("distR", "0");

  const extent = doc.createElement("wp:extent");
  extent.setAttribute("cx", String(980000));
  extent.setAttribute("cy", String(340000));
  inline.appendChild(extent);

  const effectExtent = doc.createElement("wp:effectExtent");
  effectExtent.setAttribute("l", "0");
  effectExtent.setAttribute("t", "0");
  effectExtent.setAttribute("r", "0");
  effectExtent.setAttribute("b", "0");
  inline.appendChild(effectExtent);

  const docPr = doc.createElement("wp:docPr");
  docPr.setAttribute("id", String(Math.floor(Math.random() * 9000) + 1000));
  docPr.setAttribute("name", imageName);
  inline.appendChild(docPr);

  const cNv = doc.createElement("wp:cNvGraphicFramePr");
  const graphicLocks = doc.createElement("a:graphicFrameLocks");
  graphicLocks.setAttribute("xmlns:a", "http://schemas.openxmlformats.org/drawingml/2006/main");
  graphicLocks.setAttribute("noChangeAspect", "1");
  cNv.appendChild(graphicLocks);
  inline.appendChild(cNv);

  const graphic = doc.createElement("a:graphic");
  graphic.setAttribute("xmlns:a", "http://schemas.openxmlformats.org/drawingml/2006/main");
  const graphicData = doc.createElement("a:graphicData");
  graphicData.setAttribute("uri", "http://schemas.openxmlformats.org/drawingml/2006/picture");

  const pic = doc.createElement("pic:pic");
  pic.setAttribute("xmlns:pic", "http://schemas.openxmlformats.org/drawingml/2006/picture");

  const nvPicPr = doc.createElement("pic:nvPicPr");
  const cNvPr = doc.createElement("pic:cNvPr");
  cNvPr.setAttribute("id", "0");
  cNvPr.setAttribute("name", imageName);
  const cNvPicPr = doc.createElement("pic:cNvPicPr");
  nvPicPr.appendChild(cNvPr);
  nvPicPr.appendChild(cNvPicPr);
  pic.appendChild(nvPicPr);

  const blipFill = doc.createElement("pic:blipFill");
  const blip = doc.createElement("a:blip");
  blip.setAttribute("xmlns:r", "http://schemas.openxmlformats.org/officeDocument/2006/relationships");
  blip.setAttribute("r:embed", relationId);
  const stretch = doc.createElement("a:stretch");
  stretch.appendChild(doc.createElement("a:fillRect"));
  blipFill.appendChild(blip);
  blipFill.appendChild(stretch);
  pic.appendChild(blipFill);

  const spPr = doc.createElement("pic:spPr");
  const xfrm = doc.createElement("a:xfrm");
  const off = doc.createElement("a:off");
  off.setAttribute("x", "0");
  off.setAttribute("y", "0");
  const ext = doc.createElement("a:ext");
  ext.setAttribute("cx", String(980000));
  ext.setAttribute("cy", String(340000));
  xfrm.appendChild(off);
  xfrm.appendChild(ext);
  spPr.appendChild(xfrm);

  const prst = doc.createElement("a:prstGeom");
  prst.setAttribute("prst", "rect");
  prst.appendChild(doc.createElement("a:avLst"));
  spPr.appendChild(prst);
  pic.appendChild(spPr);

  graphicData.appendChild(pic);
  graphic.appendChild(graphicData);
  inline.appendChild(graphic);
  drawing.appendChild(inline);
  run.appendChild(drawing);
  paragraph.appendChild(run);
}

function appendParagraphTextRun(doc: any, paragraph: any, text: string) {
  if (!paragraph) return;
  const run = doc.createElement("w:r");
  const textNode = doc.createElement("w:t");
  textNode.appendChild(doc.createTextNode(text));
  run.appendChild(textNode);
  paragraph.appendChild(run);
}

function getParagraphPlainText(paragraph: any) {
  if (!paragraph) return "";
  const texts = Array.from(paragraph.getElementsByTagName("w:t"));
  return texts.map((node: any) => String(node.textContent || "")).join("");
}

function findParagraphByText(paragraphs: any[], matcher: (text: string) => boolean, preferLast = false) {
  if (preferLast) {
    for (let i = paragraphs.length - 1; i >= 0; i -= 1) {
      const text = getParagraphPlainText(paragraphs[i]);
      if (matcher(text)) return paragraphs[i];
    }
    return null;
  }
  for (const paragraph of paragraphs) {
    const text = getParagraphPlainText(paragraph);
    if (matcher(text)) return paragraph;
  }
  return null;
}

async function buildStudentEvaluationDocxByTemplate(params: {
  className?: string | null;
  studentName: string;
  itemScores: string[];
  comment: string;
  totalAvgScore: string;
  judgeNames: string[];
  signatureImages?: Array<{
    buffer: Buffer;
    ext: string;
    name: string;
  }>;
  scheduleDateText: string;
}) {
  const templateBuffer = await fs.readFile(DOCX_TEMPLATE_PATH);
  const zip = await JSZip.loadAsync(templateBuffer);
  const xmlFile = zip.file("word/document.xml");
  if (!xmlFile) {
    throw createHttpError("模板损坏：缺少 word/document.xml", 500);
  }

  const xml = await xmlFile.async("string");
  const dom = new DOMParser().parseFromString(xml, "application/xml");
  const paragraphs = Array.from(dom.getElementsByTagName("w:p"));
  const classParagraph = findParagraphByText(
    paragraphs,
    (text) => text.includes("班级") && (text.includes("姓名（讲课人）") || text.includes("姓名(讲课人)")),
  ) || paragraphs[2] || null;
  const signatureParagraph = findParagraphByText(
    paragraphs,
    (text) => text.includes("评价人（签名）") || text.includes("评价人(签名)"),
    true,
  ) || null;
  const dateParagraph = findParagraphByText(
    paragraphs,
    (text) => text.includes("年") && text.includes("月") && text.includes("日"),
    true,
  ) || null;

  setParagraphText(
    dom,
    classParagraph,
    `学院 服装学院  专业      班级 ${params.className || ""}  姓名（讲课人） ${params.studentName}`,
  );
  setParagraphText(dom, signatureParagraph, "评价人（签名） ");
  setParagraphText(dom, dateParagraph, params.scheduleDateText);

  const validSignatureImages = (params.signatureImages || []).filter((item) => Boolean(item?.buffer));
  if (signatureParagraph && validSignatureImages.length) {
    const relFile = zip.file("word/_rels/document.xml.rels");
    if (relFile) {
      const relXml = await relFile.async("string");
      const relDom = new DOMParser().parseFromString(relXml, "application/xml");
      const relsRoot = relDom.documentElement;
      const rels = Array.from(relDom.getElementsByTagName("Relationship"));
      let maxRid = 0;
      for (const rel of rels as any[]) {
        const id = String(rel.getAttribute("Id") || "");
        const matched = id.match(/^rId(\d+)$/);
        if (matched) maxRid = Math.max(maxRid, Number(matched[1]));
      }

      for (let i = 0; i < validSignatureImages.length; i += 1) {
        const item = validSignatureImages[i];
        const ext = item.ext.toLowerCase().startsWith(".") ? item.ext.toLowerCase() : `.${item.ext.toLowerCase()}`;
        const imageFilename = `signature-${Date.now()}-${i}-${Math.floor(Math.random() * 10000)}${ext}`;
        zip.file(`word/media/${imageFilename}`, item.buffer);
        await ensureDocxImageContentType(zip, ext);

        const newRid = `rId${maxRid + 1}`;
        maxRid += 1;
        const relation = relDom.createElement("Relationship");
        relation.setAttribute("Id", newRid);
        relation.setAttribute("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image");
        relation.setAttribute("Target", `media/${imageFilename}`);
        relsRoot.appendChild(relation);

        if (i > 0) {
          appendParagraphTextRun(dom, signatureParagraph, " ");
        }
        appendSignatureImageRun(dom, signatureParagraph, newRid, item.name || `signature-${i + 1}`);
      }

      zip.file("word/_rels/document.xml.rels", new XMLSerializer().serializeToString(relDom));
    }
  } else if (signatureParagraph && params.judgeNames.length) {
    setParagraphText(dom, signatureParagraph, `评价人（签名） ${params.judgeNames.join("、")}`);
  }

  const tables = Array.from(dom.getElementsByTagName("w:tbl"));
  const mainTable = tables[0];
  if (!mainTable) {
    throw createHttpError("模板损坏：缺少评分表格", 500);
  }

  const rows = Array.from(mainTable.getElementsByTagName("w:tr"));
  for (let i = 0; i < 10; i += 1) {
    const row = rows[i + 1];
    if (!row) continue;
    const cells = Array.from(row.getElementsByTagName("w:tc"));
    setCellText(dom, cells[3] || null, params.itemScores[i] || "");
  }

  const commentRow = rows[11];
  if (commentRow) {
    const cells = Array.from(commentRow.getElementsByTagName("w:tc"));
    setCellText(dom, cells[1] || null, params.comment);
  }

  const totalRow = rows[12];
  if (totalRow) {
    const cells = Array.from(totalRow.getElementsByTagName("w:tc"));
    setCellText(dom, cells[1] || null, params.totalAvgScore);
  }

  const serialized = new XMLSerializer().serializeToString(dom);
  zip.file("word/document.xml", serialized);
  return zip.generateAsync({ type: "nodebuffer" });
}

function buildStudentEvaluationPdf(params: {
  activityName: string;
  groupName: string;
  studentName: string;
  className?: string | null;
  itemRows: Array<{ name: string; description: string; maxScore: number; scoreText: string }>;
  totalAvgScore: string;
  comment: string;
  scheduleDateText: string;
  signatures: Array<{ judgeName: string; imageBuffer?: Buffer }>;
}) {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 32, bottom: 32, left: 34, right: 34 },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    if (PDF_FONT_PATH) {
      doc.font(PDF_FONT_PATH);
    }

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const left = doc.page.margins.left;
    const right = pageWidth - doc.page.margins.right;
    const contentWidth = right - left;

    doc.fontSize(18).text("教学技能评价表", left, 20, { width: contentWidth, align: "center" });
    doc.fontSize(11).text(params.activityName, left, 46, { width: contentWidth, align: "center" });

    doc.fontSize(12);
    const infoY = 70;
    doc.text(`班级：${params.className || ""}`, left, infoY);
    doc.text(`姓名（讲课人）：${params.studentName}`, left + 190, infoY);

    const tableTop = 108;
    const col1 = 84;
    const col2 = contentWidth - 84 - 52 - 52;
    const col3 = 52;
    const col4 = 52;
    const x1 = left;
    const x2 = x1 + col1;
    const x3 = x2 + col2;
    const x4 = x3 + col3;
    const drawRow = (y: number, h: number) => {
      doc.rect(x1, y, contentWidth, h).stroke();
      doc.moveTo(x2, y).lineTo(x2, y + h).stroke();
      doc.moveTo(x3, y).lineTo(x3, y + h).stroke();
      doc.moveTo(x4, y).lineTo(x4, y + h).stroke();
    };

    const headerH = 26;
    drawRow(tableTop, headerH);
    doc.fontSize(12).text("教学技能评价标准", x1, tableTop + 7, { width: col1 + col2, align: "center" });
    doc.text("分值", x3, tableTop + 7, { width: col3, align: "center" });
    doc.text("评分", x4, tableTop + 7, { width: col4, align: "center" });

    let y = tableTop + headerH;
    doc.fontSize(10.5);
    for (const item of params.itemRows) {
      const leftText = item.name;
      const descText = item.description || "";
      const leftH = doc.heightOfString(leftText, { width: col1 - 8, align: "center" });
      const descH = doc.heightOfString(descText, { width: col2 - 10, align: "left" });
      const rowH = Math.max(34, Math.max(leftH, descH) + 10);

      drawRow(y, rowH);
      doc.text(leftText, x1 + 4, y + 5, { width: col1 - 8, align: "center" });
      doc.text(descText, x2 + 5, y + 5, { width: col2 - 10, align: "left" });
      doc.text(String(item.maxScore), x3, y + 8, { width: col3, align: "center" });
      doc.text(item.scoreText || "", x4, y + 8, { width: col4, align: "center" });
      y += rowH;
    }

    const commentH = 92;
    drawRow(y, commentH);
    doc.fontSize(12).text("总体评价", x1, y + 34, { width: col1, align: "center" });
    doc.fontSize(11).text(params.comment || "", x2 + 6, y + 8, { width: contentWidth - col1 - 12, align: "left" });
    y += commentH;

    const totalH = 30;
    drawRow(y, totalH);
    doc.fontSize(13).text("总评成绩", x1, y + 8, { width: col1 + col2, align: "center" });
    doc.fontSize(13).text(params.totalAvgScore, x3, y + 8, { width: col3 + col4, align: "center" });
    y += totalH + 10;

    const dateY = pageHeight - doc.page.margins.bottom - 8;
    const sigCellW = 62;
    const sigCellH = 24;
    const sigGapX = 8;
    const sigGapY = 8;
    const sigCols = 3;
    const signAreaWidth = sigCols * sigCellW + (sigCols - 1) * sigGapX;
    const signStartX = right - signAreaWidth;
    let sigX = signStartX;
    let sigY = Math.max(y, dateY - 74);

    doc.fontSize(12).text("评价人（签名）", signStartX - 92, sigY + 4);
    for (const item of params.signatures) {
      if (sigX + sigCellW > right + 1) {
        sigX = signStartX;
        sigY += sigCellH + sigGapY;
      }
      if (item.imageBuffer) {
        try {
          doc.image(item.imageBuffer, sigX, sigY, { fit: [sigCellW, sigCellH], align: "center", valign: "center" });
        } catch {
          doc.fontSize(10).text(item.judgeName, sigX, sigY + 6, { width: sigCellW, align: "center" });
        }
      } else {
        doc.fontSize(10).text(item.judgeName, sigX, sigY + 6, { width: sigCellW, align: "center" });
      }
      sigX += sigCellW + sigGapX;
    }

    doc.fontSize(12).text(`${params.scheduleDateText}`, right - 170, dateY, { width: 170, align: "right" });
    doc.end();
  });
}

function createEvaluationFormTable(params: {
  itemRows: Array<{ name: string; description: string; maxScore: number; scoreText: string }>;
  totalAvgScore: string;
  comment: string;
}) {
  const columnWidths = [18, 56, 13, 13];

  const createCell = (
    text: string,
    widthPercent: number,
    options?: {
      header?: boolean;
      bold?: boolean;
      align?: "both" | "center" | "left" | "right" | "start" | "end" | "mediumKashida" | "distribute" | "numTab" | "highKashida" | "lowKashida" | "thaiDistribute";
      fontSize?: number;
      columnSpan?: number;
    },
  ) =>
    new TableCell({
      columnSpan: options?.columnSpan,
      width: { size: widthPercent, type: WidthType.PERCENTAGE },
      shading: options?.header
        ? { type: ShadingType.CLEAR, fill: "EAF2FD", color: "auto" }
        : undefined,
      borders: {
        top: { style: BorderStyle.SINGLE, size: 1, color: options?.header ? "C9D8EE" : "D9E4F2" },
        bottom: { style: BorderStyle.SINGLE, size: 1, color: options?.header ? "C9D8EE" : "D9E4F2" },
        left: { style: BorderStyle.SINGLE, size: 1, color: options?.header ? "C9D8EE" : "D9E4F2" },
        right: { style: BorderStyle.SINGLE, size: 1, color: options?.header ? "C9D8EE" : "D9E4F2" },
      },
      margins: {
        top: 100,
        bottom: 100,
        left: 100,
        right: 100,
      },
      children: [
        new Paragraph({
          alignment: options?.align || AlignmentType.CENTER,
          spacing: { line: 300 },
          children: [
            new TextRun({
              text,
              bold: options?.bold ?? options?.header,
              size: options?.fontSize || (options?.header ? 22 : 20),
              color: options?.header ? "2B3A55" : "1F2D3D",
            }),
          ],
        }),
      ],
    });

  const rows = [
    new TableRow({
      tableHeader: true,
      children: [
        createCell("教学技能评价标准", columnWidths[0] + columnWidths[1], { header: true, columnSpan: 2 }),
        createCell("分值", columnWidths[2], { header: true }),
        createCell("评分", columnWidths[3], { header: true }),
      ],
    }),
    ...params.itemRows.map((item) =>
      new TableRow({
        children: [
          createCell(item.name, columnWidths[0], { bold: true }),
          createCell(item.description || item.name, columnWidths[1], { align: AlignmentType.LEFT }),
          createCell(String(item.maxScore), columnWidths[2]),
          createCell(item.scoreText || "", columnWidths[3]),
        ],
      })),
    new TableRow({
      children: [
        createCell("总体评价", columnWidths[0], { bold: true }),
        createCell(params.comment || "整体表现较好，建议持续打磨教学细节", columnWidths[1] + columnWidths[2] + columnWidths[3], {
          columnSpan: 3,
          align: AlignmentType.LEFT,
        }),
      ],
    }),
    new TableRow({
      children: [
        createCell("总评成绩", columnWidths[0] + columnWidths[1], { bold: true, columnSpan: 2 }),
        createCell(params.totalAvgScore || "", columnWidths[2] + columnWidths[3], { bold: true, columnSpan: 2 }),
      ],
    }),
  ];

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows,
  });
}

function collectParagraphsFromNodes(nodes: any[]): any[] {
  const result: any[] = [];
  for (const node of nodes) {
    if (node.nodeName === "w:p") result.push(node);
    if (typeof node.getElementsByTagName === "function") {
      result.push(...Array.from(node.getElementsByTagName("w:p")));
    }
  }
  return result;
}

function collectTablesFromNodes(nodes: any[]): any[] {
  const result: any[] = [];
  for (const node of nodes) {
    if (node.nodeName === "w:tbl") result.push(node);
    if (typeof node.getElementsByTagName === "function") {
      result.push(...Array.from(node.getElementsByTagName("w:tbl")));
    }
  }
  return result;
}

async function buildStudentEvaluationSummaryByTemplate(params: {
  students: Array<{
    orderNo: number;
    className?: string | null;
    studentName: string;
    itemScores: string[];
    totalAvgScore: string;
    comment: string;
  }>;
  judgeNames: string[];
  signatureImages: Array<{ buffer: Buffer; ext: string; name: string }>;
  scheduleDateText: string;
}): Promise<Buffer> {
  if (!params.students.length) {
    return buildStudentEvaluationSummaryDocx({
      activityName: "",
      groupName: "",
      judgeNames: params.judgeNames,
      scheduleDateText: params.scheduleDateText,
      entries: [],
    });
  }

  const templateBuffer = await fs.readFile(DOCX_TEMPLATE_PATH);
  const zip = await JSZip.loadAsync(templateBuffer);
  const xmlFile = zip.file("word/document.xml");
  if (!xmlFile) throw createHttpError("模板损坏：缺少 word/document.xml", 500);

  const xml = await xmlFile.async("string");
  const dom = new DOMParser().parseFromString(xml, "application/xml");
  const body = dom.getElementsByTagName("w:body")[0];

  const allBodyChildren = Array.from(body.childNodes) as any[];
  const sectPr = allBodyChildren.find((n) => n.nodeName === "w:sectPr") ?? null;
  const templateContent = allBodyChildren.filter((n) => n.nodeName !== "w:sectPr");

  // Deep-clone original template content as master (before any modifications)
  const masterNodes = templateContent.map((n) => n.cloneNode(true));

  // Remove original content from body
  for (const node of templateContent) {
    body.removeChild(node);
  }

  // Add signature images to the zip once, collect shared rIds
  const validSigImages = (params.signatureImages || []).filter((i) => Boolean(i?.buffer));
  const signatureRids: string[] = [];

  if (validSigImages.length) {
    const relFile = zip.file("word/_rels/document.xml.rels");
    if (relFile) {
      const relXml = await relFile.async("string");
      const relDom = new DOMParser().parseFromString(relXml, "application/xml");
      const relsRoot = relDom.documentElement;
      let maxRid = 0;
      for (const rel of Array.from(relDom.getElementsByTagName("Relationship")) as any[]) {
        const matched = String(rel.getAttribute("Id") || "").match(/^rId(\d+)$/);
        if (matched) maxRid = Math.max(maxRid, Number(matched[1]));
      }
      for (let i = 0; i < validSigImages.length; i += 1) {
        const item = validSigImages[i];
        const ext = item.ext.toLowerCase().startsWith(".") ? item.ext.toLowerCase() : `.${item.ext.toLowerCase()}`;
        const imageFilename = `summary-sig-${i}${ext}`;
        zip.file(`word/media/${imageFilename}`, item.buffer);
        await ensureDocxImageContentType(zip, ext);
        const newRid = `rId${maxRid + 1}`;
        maxRid += 1;
        signatureRids.push(newRid);
        const rel = relDom.createElement("Relationship");
        rel.setAttribute("Id", newRid);
        rel.setAttribute("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image");
        rel.setAttribute("Target", `media/${imageFilename}`);
        relsRoot.appendChild(rel);
      }
      zip.file("word/_rels/document.xml.rels", new XMLSerializer().serializeToString(relDom));
    }
  }

  // For each student: clone master nodes, fill data, append to body
  for (let idx = 0; idx < params.students.length; idx += 1) {
    const student = params.students[idx];
    const studentNodes = masterNodes.map((n) => n.cloneNode(true));

    // Page break before every student after the first
    if (idx > 0) {
      const breakPar = dom.createElement("w:p");
      const breakRun = dom.createElement("w:r");
      const breakEl = dom.createElement("w:br");
      breakEl.setAttribute("w:type", "page");
      breakRun.appendChild(breakEl);
      breakPar.appendChild(breakRun);
      if (sectPr) {
        body.insertBefore(breakPar, sectPr);
      } else {
        body.appendChild(breakPar);
      }
    }

    // Append student nodes
    for (const node of studentNodes) {
      if (sectPr) {
        body.insertBefore(node, sectPr);
      } else {
        body.appendChild(node);
      }
    }

    // Find and modify student-specific paragraphs (search only within this student's nodes)
    const studentParagraphs = collectParagraphsFromNodes(studentNodes);
    const classParagraph = findParagraphByText(
      studentParagraphs,
      (text) => text.includes("班级") && (text.includes("姓名（讲课人）") || text.includes("姓名(讲课人)")),
    ) ?? null;
    const signatureParagraph = findParagraphByText(
      studentParagraphs,
      (text) => text.includes("评价人（签名）") || text.includes("评价人(签名)"),
      true,
    ) ?? null;
    const dateParagraph = findParagraphByText(
      studentParagraphs,
      (text) => text.includes("年") && text.includes("月") && text.includes("日"),
      true,
    ) ?? null;

    setParagraphText(
      dom,
      classParagraph,
      `学院 服装学院  专业      班级 ${student.className || ""}  姓名（讲课人） ${student.studentName}`,
    );
    setParagraphText(dom, dateParagraph, params.scheduleDateText);

    if (signatureParagraph) {
      if (signatureRids.length) {
        setParagraphText(dom, signatureParagraph, "评价人（签名） ");
        for (let i = 0; i < signatureRids.length; i += 1) {
          if (i > 0) appendParagraphTextRun(dom, signatureParagraph, " ");
          appendSignatureImageRun(dom, signatureParagraph, signatureRids[i], validSigImages[i].name || `signature-${i + 1}`);
        }
      } else if (params.judgeNames.length) {
        setParagraphText(dom, signatureParagraph, `评价人（签名） ${params.judgeNames.join("、")}`);
      }
    }

    // Fill table scores and comment
    const studentTables = collectTablesFromNodes(studentNodes);
    const mainTable = studentTables[0];
    if (mainTable) {
      const rows = Array.from(mainTable.getElementsByTagName("w:tr")) as any[];
      for (let i = 0; i < 10; i += 1) {
        const row = rows[i + 1];
        if (!row) continue;
        const cells = Array.from(row.getElementsByTagName("w:tc")) as any[];
        setCellText(dom, cells[3] ?? null, student.itemScores[i] || "");
      }
      const commentRow = rows[11];
      if (commentRow) {
        const cells = Array.from(commentRow.getElementsByTagName("w:tc")) as any[];
        setCellText(dom, cells[1] ?? null, student.comment);
      }
      const totalRow = rows[12];
      if (totalRow) {
        const cells = Array.from(totalRow.getElementsByTagName("w:tc")) as any[];
        setCellText(dom, cells[1] ?? null, student.totalAvgScore);
      }
    }
  }

  zip.file("word/document.xml", new XMLSerializer().serializeToString(dom));
  return zip.generateAsync({ type: "nodebuffer" });
}

async function buildStudentEvaluationSummaryDocx(params: {
  activityName: string;
  groupName: string;
  judgeNames: string[];
  scheduleDateText: string;
  entries: Array<{
    orderNo: number;
    studentName: string;
    className?: string | null;
    itemRows: Array<{ name: string; description: string; maxScore: number; scoreText: string }>;
    totalAvgScore: string;
    comment: string;
  }>;
}) {
  const children: Array<Paragraph | Table> = [];
  const judgeLine = params.judgeNames.length ? params.judgeNames.join("、") : "________________";

  if (!params.entries.length) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 180 },
        children: [new TextRun({ text: `${params.groupName}教学技能评价表`, bold: true, size: 32, color: "1F2D3D" })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: "暂无可导出的学生数据", size: 22, color: "6B7A99" })],
      }),
    );
  } else {
    params.entries.forEach((entry, index) => {
      children.push(
        new Paragraph({
          pageBreakBefore: index > 0,
          alignment: AlignmentType.CENTER,
          spacing: { after: 120 },
          children: [new TextRun({ text: "教学技能评价表", bold: true, size: 30, color: "1F2D3D" })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 100 },
          children: [new TextRun({ text: `${params.activityName} · ${params.groupName}`, size: 22, color: "6B7A99" })],
        }),
        new Paragraph({
          spacing: { after: 120 },
          children: [
            new TextRun({ text: `序号：${entry.orderNo}    `, size: 21, bold: true }),
            new TextRun({ text: `班级：${entry.className || ""}    `, size: 21 }),
            new TextRun({ text: `姓名（讲课人）：${entry.studentName}`, size: 21 }),
          ],
        }),
        createEvaluationFormTable({
          itemRows: entry.itemRows,
          totalAvgScore: entry.totalAvgScore,
          comment: entry.comment,
        }),
        new Paragraph({
          spacing: { before: 160, after: 80 },
          children: [
            new TextRun({ text: `评价人（签名）：${judgeLine}`, size: 21 }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          spacing: { after: 80 },
          children: [new TextRun({ text: params.scheduleDateText, size: 21 })],
        }),
      );
    });
  }

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: "宋体",
            size: 21,
            color: "1F2D3D",
          },
          paragraph: {
            spacing: { line: 300 },
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(0.55),
              bottom: convertInchesToTwip(0.55),
              left: convertInchesToTwip(0.55),
              right: convertInchesToTwip(0.55),
            },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}

export async function registerJudgeRoutes(app: FastifyInstance) {
  app.get("/api/judge/current-activity", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    return getCurrentJudgeActivity(request.user.userId);
  });

  app.get("/api/judge/activities/:activityId/students", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    const { activityId } = request.params as { activityId: string };
    const bindings = await prisma.activityUserRole.findMany({
      where: {
        activityId,
        userId: request.user.userId,
        role: { in: [UserRole.JUDGE, UserRole.SECRETARY] },
      },
    });
    const groupIds = bindings.map((item) => item.groupId).filter(Boolean) as string[];

    const students = await prisma.student.findMany({
      where: { activityId, groupId: { in: groupIds } },
      include: {
        group: true,
        customRole: true,
        scores: {
          where: { judgeUserId: request.user.userId },
          include: { details: true },
        },
      },
      orderBy: [{ group: { sortOrder: "asc" } }, { orderNo: "asc" }],
    });
    const summaryMap = await getStudentSummaryMap(activityId, students.map((student) => student.id));

    return students.map((student) => ({
      ...student,
      myScoreStatus: student.scores[0]?.status ?? null,
      summary: summaryMap.get(student.id) || null,
    }));
  });

  app.get("/api/judge/activities/:activityId/students/:studentId", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    const { activityId, studentId } = request.params as { activityId: string; studentId: string };
    const [student, peerScores] = await Promise.all([
      prisma.student.findFirstOrThrow({
        where: { id: studentId, activityId },
        include: {
          group: true,
          activity: { include: { templates: { include: { items: { orderBy: { sortOrder: "asc" } } } } } },
          scores: {
            where: { judgeUserId: request.user.userId },
            include: { details: true },
          },
        },
      }),
      getAnonymousPeerScores(activityId, studentId, request.user.userId),
    ]);
    return {
      ...student,
      peerScores,
      summary: await getStudentSummary(activityId, student.id),
    };
  });

  app.post("/api/judge/activities/:activityId/students/:studentId/generate-comment", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    const { activityId, studentId } = request.params as { activityId: string; studentId: string };
    const body = request.body as {
      totalScore: number;
      prompt?: string;
      templateId?: string;
      details?: Array<{ itemId: string; scoreValue: number }>;
    };

    if (!Number.isFinite(Number(body.totalScore))) {
      throw createHttpError("总分无效", 400);
    }

    const customPrompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    await ensureJudgeAccess(activityId, studentId, request.user.userId);
    let scoreDetails: Array<{
      name: string;
      maxScore: number;
      scoreValue: number;
      description?: string | null;
    }> = [];

    if (Array.isArray(body.details) && body.details.length) {
      const { template } = await getEffectiveTemplate(activityId, body.templateId);
      const detailMap = new Map(
        body.details
          .filter((item) => item && typeof item.itemId === "string" && Number.isFinite(Number(item.scoreValue)))
          .map((item) => [item.itemId, Number(item.scoreValue)]),
      );

      if (template.scoreMode !== "TOTAL" && template.items?.length) {
        scoreDetails = template.items
          .filter((item) => detailMap.has(item.id))
          .map((item) => ({
            name: item.name,
            maxScore: item.maxScore,
            scoreValue: detailMap.get(item.id) || 0,
            description: item.description,
          }));
      }
    }

    const comment = await generateCommentByOllama({
      totalScore: Number(body.totalScore),
      customPrompt: customPrompt || undefined,
      scoreDetails,
    });
    return { comment };
  });

  app.post("/api/judge/activities/:activityId/students/:studentId/generate-questions", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    const { activityId, studentId } = request.params as { activityId: string; studentId: string };
    const body = request.body as { topic?: string };
    const topic = String(body.topic || "师范生面试问题").trim() || "师范生面试问题";

    await ensureJudgeAccess(activityId, studentId, request.user.userId);
    const questions = await generateQuestionsByOllama(topic);
    return { questions };
  });

  app.post("/api/judge/activities/:activityId/students/:studentId/save-draft", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    const { activityId, studentId } = request.params as { activityId: string; studentId: string };
    const body = request.body as {
      templateId: string;
      totalScore: number;
      comment?: string;
      details: Array<{ itemId: string; scoreValue: number }>;
    };

    await ensureActivityUnlocked(activityId);
    const { template } = await getEffectiveTemplate(activityId, body.templateId);
    const { student } = await ensureJudgeAccess(activityId, studentId, request.user.userId);
    await ensureGroupUnlocked(student.groupId);
    validateScoreInput(body, template);

    const score = await prisma.score.upsert({
      where: {
        activityId_studentId_judgeUserId: {
          activityId,
          studentId,
          judgeUserId: request.user.userId,
        },
      },
      update: {
        templateId: template.id,
        totalScore: body.totalScore,
        comment: body.comment,
        status: ScoreStatus.DRAFT,
        details: {
          deleteMany: {},
          create: body.details.map((item) => ({
            itemId: item.itemId,
            scoreValue: item.scoreValue,
          })),
        },
      },
      create: {
        activityId,
        studentId,
        judgeUserId: request.user.userId,
        groupId: student.groupId,
        templateId: template.id,
        totalScore: body.totalScore,
        comment: body.comment,
        status: ScoreStatus.DRAFT,
        details: {
          create: body.details.map((item) => ({
            itemId: item.itemId,
            scoreValue: item.scoreValue,
          })),
        },
      },
      include: { details: true },
    });

    broadcast("score.updated", { activityId, studentId, status: "DRAFT" });
    return score;
  });

  app.post("/api/judge/activities/:activityId/students/:studentId/submit-score", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    const { activityId, studentId } = request.params as { activityId: string; studentId: string };
    const body = request.body as {
      templateId: string;
      totalScore: number;
      comment?: string;
      details: Array<{ itemId: string; scoreValue: number }>;
    };

    const [, { template }, access] = await Promise.all([
      ensureActivityUnlocked(activityId),
      getEffectiveTemplate(activityId, body.templateId),
      ensureJudgeAccess(activityId, studentId, request.user.userId),
    ]);
    const { student } = access;
    await ensureGroupUnlocked(student.groupId);
    validateScoreInput(body, template);

    const score = await prisma.score.upsert({
      where: {
        activityId_studentId_judgeUserId: {
          activityId,
          studentId,
          judgeUserId: request.user.userId,
        },
      },
      update: {
        templateId: template.id,
        totalScore: body.totalScore,
        comment: body.comment,
        status: ScoreStatus.SUBMITTED,
        submittedAt: new Date(),
        details: {
          deleteMany: {},
          create: body.details.map((item) => ({
            itemId: item.itemId,
            scoreValue: item.scoreValue,
          })),
        },
      },
      create: {
        activityId,
        studentId,
        judgeUserId: request.user.userId,
        groupId: student.groupId,
        templateId: template.id,
        totalScore: body.totalScore,
        comment: body.comment,
        status: ScoreStatus.SUBMITTED,
        submittedAt: new Date(),
        details: {
          create: body.details.map((item) => ({
            itemId: item.itemId,
            scoreValue: item.scoreValue,
          })),
        },
      },
    });

    await logOperation({
      operatorId: request.user.userId,
      operatorName: request.user.username,
      module: "score",
      action: "submit",
      targetType: "Student",
      targetId: studentId,
      afterData: { totalScore: body.totalScore, studentId, activityId },
    });

    const summary = await getStudentSummary(activityId, studentId);
    broadcast("score.updated", { activityId, studentId, status: "SUBMITTED", summary });
    return { score, summary };
  });

  // --- Batch save-draft ---
  app.post("/api/judge/activities/:activityId/batch-save-draft", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    const { activityId } = request.params as { activityId: string };
    const body = request.body as {
      templateId: string;
      rows: Array<{
        studentId: string;
        totalScore: number;
        comment?: string;
        details: Array<{ itemId: string; scoreValue: number }>;
      }>;
    };

    if (!Array.isArray(body.rows) || body.rows.length === 0) {
      throw createHttpError("rows 不能为空", 400);
    }

    // One-time shared checks
    await ensureActivityUnlocked(activityId);
    const { template } = await getEffectiveTemplate(activityId, body.templateId);

    const results = await mapWithConcurrency(body.rows, 5, async (row) => {
      const { student } = await ensureJudgeAccess(activityId, row.studentId, request.user.userId);
      validateScoreInput({ totalScore: row.totalScore, details: row.details }, template);

      const score = await prisma.score.upsert({
        where: {
          activityId_studentId_judgeUserId: {
            activityId,
            studentId: row.studentId,
            judgeUserId: request.user.userId,
          },
        },
        update: {
          templateId: template.id,
          totalScore: row.totalScore,
          comment: row.comment,
          status: ScoreStatus.DRAFT,
          details: {
            deleteMany: {},
            create: row.details.map((item) => ({ itemId: item.itemId, scoreValue: item.scoreValue })),
          },
        },
        create: {
          activityId,
          studentId: row.studentId,
          judgeUserId: request.user.userId,
          groupId: student.groupId,
          templateId: template.id,
          totalScore: row.totalScore,
          comment: row.comment,
          status: ScoreStatus.DRAFT,
          details: {
            create: row.details.map((item) => ({ itemId: item.itemId, scoreValue: item.scoreValue })),
          },
        },
        include: { details: true },
      });

      return { studentId: row.studentId, score, groupId: student.groupId };
    });

    // Validate group locks once per unique groupId (deduplicated)
    const uniqueGroupIds = [...new Set(results.map((r) => r.groupId).filter(Boolean))];
    await Promise.all(uniqueGroupIds.map((gid) => ensureGroupUnlocked(gid)));

    broadcast("score.updated", { activityId, batchSize: results.length, status: "DRAFT" });
    return { results: results.map(({ groupId: _g, ...rest }) => rest) };
  });

  // --- Batch submit-score ---
  app.post("/api/judge/activities/:activityId/batch-submit-score", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    const { activityId } = request.params as { activityId: string };
    const body = request.body as {
      templateId: string;
      rows: Array<{
        studentId: string;
        totalScore: number;
        comment?: string;
        details: Array<{ itemId: string; scoreValue: number }>;
      }>;
    };

    if (!Array.isArray(body.rows) || body.rows.length === 0) {
      throw createHttpError("rows 不能为空", 400);
    }

    // One-time shared checks
    await ensureActivityUnlocked(activityId);
    const { template } = await getEffectiveTemplate(activityId, body.templateId);

    const upsertResults = await mapWithConcurrency(body.rows, 5, async (row) => {
      const { student } = await ensureJudgeAccess(activityId, row.studentId, request.user.userId);
      validateScoreInput({ totalScore: row.totalScore, details: row.details }, template);

      const score = await prisma.score.upsert({
        where: {
          activityId_studentId_judgeUserId: {
            activityId,
            studentId: row.studentId,
            judgeUserId: request.user.userId,
          },
        },
        update: {
          templateId: template.id,
          totalScore: row.totalScore,
          comment: row.comment,
          status: ScoreStatus.SUBMITTED,
          submittedAt: new Date(),
          details: {
            deleteMany: {},
            create: row.details.map((item) => ({ itemId: item.itemId, scoreValue: item.scoreValue })),
          },
        },
        create: {
          activityId,
          studentId: row.studentId,
          judgeUserId: request.user.userId,
          groupId: student.groupId,
          templateId: template.id,
          totalScore: row.totalScore,
          comment: row.comment,
          status: ScoreStatus.SUBMITTED,
          submittedAt: new Date(),
          details: {
            create: row.details.map((item) => ({ itemId: item.itemId, scoreValue: item.scoreValue })),
          },
        },
        include: { details: true },
      });

      return { studentId: row.studentId, score, groupId: student.groupId, totalScore: row.totalScore };
    });

    // Validate group locks once per unique groupId (deduplicated)
    const uniqueGroupIds = [...new Set(upsertResults.map((r) => r.groupId).filter(Boolean))];
    await Promise.all(uniqueGroupIds.map((gid) => ensureGroupUnlocked(gid)));

    // Log all operations in parallel
    await Promise.all(upsertResults.map((r) =>
      logOperation({
        operatorId: request.user.userId,
        operatorName: request.user.username,
        module: "score",
        action: "submit",
        targetType: "Student",
        targetId: r.studentId,
        afterData: { totalScore: r.totalScore, studentId: r.studentId, activityId },
      }),
    ));

    // Fetch all summaries in one batch query
    const summaryMap = await getStudentSummaryMap(activityId, upsertResults.map((r) => r.studentId));

    const results = upsertResults.map(({ groupId: _g, totalScore: _t, ...rest }) => ({
      ...rest,
      summary: summaryMap.get(rest.studentId) ?? null,
    }));

    broadcast("score.updated", { activityId, batchSize: results.length, status: "SUBMITTED" });
    return { results };
  });

  app.delete("/api/judge/activities/:activityId/students/:studentId/reset-score", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    const { activityId, studentId } = request.params as { activityId: string; studentId: string };

    await ensureActivityUnlocked(activityId);
    const { student } = await ensureJudgeAccess(activityId, studentId, request.user.userId);
    await ensureGroupUnlocked(student.groupId);

    await prisma.score.deleteMany({
      where: { activityId, studentId, judgeUserId: request.user.userId },
    });

    await logOperation({
      operatorId: request.user.userId,
      operatorName: request.user.username,
      module: "score",
      action: "reset",
      targetType: "Student",
      targetId: studentId,
      afterData: { studentId, activityId },
    });

    const summary = await getStudentSummary(activityId, studentId);
    broadcast("score.updated", { activityId, studentId, status: "RESET", summary });
    return { success: true };
  });

  // --- Batch reset-score ---
  app.delete("/api/judge/activities/:activityId/batch-reset-score", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    const { activityId } = request.params as { activityId: string };
    const body = request.body as { studentIds: string[] };

    if (!Array.isArray(body.studentIds) || body.studentIds.length === 0) {
      throw createHttpError("studentIds 不能为空", 400);
    }

    await ensureActivityUnlocked(activityId);

    const results = await mapWithConcurrency(body.studentIds, 5, async (studentId) => {
      const { student } = await ensureJudgeAccess(activityId, studentId, request.user.userId);
      await ensureGroupUnlocked(student.groupId);

      await prisma.score.deleteMany({
        where: { activityId, studentId, judgeUserId: request.user.userId },
      });

      await logOperation({
        operatorId: request.user.userId,
        operatorName: request.user.username,
        module: "score",
        action: "reset",
        targetType: "Student",
        targetId: studentId,
        afterData: { studentId, activityId },
      });

      const summary = await getStudentSummary(activityId, studentId);
      return { studentId, summary };
    });

    broadcast("score.updated", { activityId, batchSize: results.length, status: "RESET" });
    return { results };
  });

  app.get("/api/judge/activities/:activityId/progress", { preHandler: [app.authenticate] }, async (request: AuthRequest) => {
    const { activityId } = request.params as { activityId: string };
    const [total, submittedCount, draftCount] = await Promise.all([
      prisma.student.count({
        where: {
          activityId,
          assignments: { some: { judgeUserId: request.user.userId } },
        },
      }),
      prisma.score.count({
        where: { activityId, judgeUserId: request.user.userId, status: ScoreStatus.SUBMITTED },
      }),
      prisma.score.count({
        where: { activityId, judgeUserId: request.user.userId, status: ScoreStatus.DRAFT },
      }),
    ]);

    return {
      total,
      submitted: submittedCount,
      draft: draftCount,
      pending: total - submittedCount,
    };
  });

  app.get("/api/judge/activities/:activityId/export/group-evaluation-zip", { preHandler: [app.authenticate] }, async (request: AuthRequest, reply) => {
    const { activityId } = request.params as { activityId: string };
    const binding = await prisma.activityUserRole.findFirstOrThrow({
      where: {
        activityId,
        userId: request.user.userId,
        role: { in: [UserRole.JUDGE, UserRole.SECRETARY] },
        groupId: { not: null },
      },
      include: {
        group: true,
        activity: true,
      },
    });

    const { template } = await getEffectiveTemplate(activityId);
    const avgDecimalPlaces = binding.activity.avgDecimalPlaces ?? 2;
    const students = await prisma.student.findMany({
      where: { activityId, groupId: binding.groupId! },
      orderBy: { orderNo: "asc" },
      include: {
        scores: {
          where: { status: ScoreStatus.SUBMITTED },
          include: {
            judge: {
              select: { realName: true, username: true },
            },
            details: {
              include: {
                item: {
                  select: { id: true, name: true },
                },
              },
            },
          },
        },
      },
    });
    const summaryMap = await getStudentSummaryMap(activityId, students.map((student) => student.id));

    const groupJudges = await prisma.activityUserRole.findMany({
      where: {
        activityId,
        groupId: binding.groupId!,
        role: UserRole.JUDGE,
      },
      include: {
        user: {
          select: {
            realName: true,
            username: true,
          },
        },
      },
    });

    const signatureMap = await loadSignatureFileMap();
    const judgeNamesForSign = Array.from(
      new Set(
        groupJudges
          .map((item) => item.user?.realName || item.user?.username || "")
          .filter(Boolean),
      ),
    );

    const signatureImagesForAllJudges: Array<{ buffer: Buffer; ext: string; name: string }> = [];
    for (const judgeName of judgeNamesForSign) {
      const normalized = normalizeNameForMatch(judgeName);
      const signaturePath = signatureMap.get(normalized);
      if (!signaturePath) continue;
      try {
        signatureImagesForAllJudges.push({
          buffer: await fs.readFile(signaturePath),
          ext: path.extname(signaturePath).toLowerCase() || ".png",
          name: `${judgeName}-signature`,
        });
      } catch {
        // ignore read errors and try next signature
      }
    }

    const zip = new JSZip();
    const pdfFiles = await mapWithConcurrency(students, 3, async (student) => {
      const summary = summaryMap.get(student.id);
      const submittedScores = student.scores || [];
      const candidateComments = submittedScores.map((item) => String(item.comment || "").trim()).filter(Boolean);
      const randomComment = pickRandomComment(candidateComments);

      const scoreForDetails = submittedScores.length
        ? submittedScores[Math.floor(Math.random() * submittedScores.length)]
        : null;
      const detailMap = new Map((scoreForDetails?.details || []).map((d) => [d.itemId, d.scoreValue]));

      const judgeNames = Array.from(
        new Set(
          submittedScores
            .map((item) => item.judge?.realName || item.judge?.username || "")
            .filter(Boolean),
        ),
      );

      const signatures = await Promise.all(
        judgeNames.map(async (judgeName) => {
          const normalized = normalizeNameForMatch(judgeName);
          const filePath = signatureMap.get(normalized);
          if (!filePath) {
            return { judgeName, imageBuffer: undefined };
          }
          try {
            const imageBuffer = await fs.readFile(filePath);
            return { judgeName, imageBuffer };
          } catch {
            return { judgeName, imageBuffer: undefined };
          }
        }),
      );

      const itemRows = (template.items || []).map((item) => ({
        name: item.name,
        description: item.description || item.name,
        maxScore: Number(item.maxScore || 0),
        scoreText: !detailMap.has(item.id)
          ? ""
          : (() => {
              const value = detailMap.get(item.id);
              if (typeof value === "number") {
                return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
              }
              return String(value || "");
            })(),
      }));

      const dateSource = binding.group?.scheduleTime || binding.group?.startTime || new Date().toISOString();
      const scheduleDateText = `${dayjs(dateSource).format("YYYY")}` + " 年 " + `${dayjs(dateSource).format("M")}` + " 月 " + `${dayjs(dateSource).format("D")}` + " 日";

      const pdfBuffer = await buildStudentEvaluationPdf({
        activityName: binding.activity.name,
        groupName: binding.group?.name || "本组",
        studentName: student.name,
        className: student.className,
        itemRows,
        totalAvgScore: formatExportScore(summary?.avgScore, avgDecimalPlaces),
        comment: randomComment || "整体表现较好，建议持续打磨教学细节",
        scheduleDateText,
        signatures,
      });

      return {
        filename: `${String(student.orderNo).padStart(2, "0")}-${student.name}-教学技能评价表.pdf`,
        buffer: pdfBuffer,
      };
    });

    for (const file of pdfFiles) {
      zip.file(file.filename, file.buffer);
    }

    const zipBuffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    const groupName = binding.group?.name || "本组";
    const chineseName = `${groupName}教学技能评价表.zip`;
    reply.header("Content-Type", "application/zip");
    reply.header("Content-Disposition", buildContentDisposition(chineseName, "group-evaluation-forms.zip"));
    return reply.send(zipBuffer);
  });

  app.get("/api/judge/activities/:activityId/export/group-evaluation-docx-zip", { preHandler: [app.authenticate] }, async (request: AuthRequest, reply) => {
    const { activityId } = request.params as { activityId: string };
    const binding = await prisma.activityUserRole.findFirstOrThrow({
      where: {
        activityId,
        userId: request.user.userId,
        role: { in: [UserRole.JUDGE, UserRole.SECRETARY] },
        groupId: { not: null },
      },
      include: {
        group: true,
        activity: true,
      },
    });

    const { template } = await getEffectiveTemplate(activityId);
    const avgDecimalPlaces = binding.activity.avgDecimalPlaces ?? 2;
    const students = await prisma.student.findMany({
      where: { activityId, groupId: binding.groupId! },
      orderBy: { orderNo: "asc" },
      include: {
        scores: {
          where: { status: ScoreStatus.SUBMITTED },
          include: {
            judge: {
              select: { realName: true, username: true },
            },
            details: {
              include: {
                item: {
                  select: { id: true, name: true },
                },
              },
            },
          },
        },
      },
    });
    const summaryMap = await getStudentSummaryMap(activityId, students.map((student) => student.id));

    const groupJudges = await prisma.activityUserRole.findMany({
      where: {
        activityId,
        groupId: binding.groupId!,
        role: UserRole.JUDGE,
      },
      include: {
        user: {
          select: {
            realName: true,
            username: true,
          },
        },
      },
    });

    const signatureMap = await loadSignatureFileMap();
    const judgeNamesForSign = Array.from(
      new Set(
        groupJudges
          .map((item) => item.user?.realName || item.user?.username || "")
          .filter(Boolean),
      ),
    );

    const signatureImagesForAllJudges: Array<{ buffer: Buffer; ext: string; name: string }> = [];
    for (const judgeName of judgeNamesForSign) {
      const normalized = normalizeNameForMatch(judgeName);
      const signaturePath = signatureMap.get(normalized);
      if (!signaturePath) continue;
      try {
        signatureImagesForAllJudges.push({
          buffer: await fs.readFile(signaturePath),
          ext: path.extname(signaturePath).toLowerCase() || ".png",
          name: `${judgeName}-signature`,
        });
      } catch {
        // ignore read errors and try next signature
      }
    }

    const zip = new JSZip();
    const docxFiles = await mapWithConcurrency(students, 3, async (student) => {
      const summary = summaryMap.get(student.id);
      const submittedScores = student.scores || [];
      const candidateComments = submittedScores.map((item) => String(item.comment || "").trim()).filter(Boolean);
      const comment = pickRandomComment(candidateComments);

      // Compute per-item average scores across all submitted judges
      const itemAvgMap = new Map<string, number>();
      for (const templateItem of template.items || []) {
        const vals = submittedScores
          .flatMap((s) => s.details)
          .filter((d) => d.itemId === templateItem.id)
          .map((d) => Number(d.scoreValue));
        if (vals.length > 0) {
          itemAvgMap.set(templateItem.id, vals.reduce((a, b) => a + b, 0) / vals.length);
        }
      }

      const itemScores = (template.items || []).slice(0, 10).map((item) => {
        const avg = itemAvgMap.get(item.id);
        return avg !== undefined ? formatExportScore(avg, avgDecimalPlaces) : "";
      });
      while (itemScores.length < 10) itemScores.push("");

      const dateSource = binding.group?.scheduleTime || binding.group?.startTime || new Date().toISOString();
      const scheduleDateText = `${dayjs(dateSource).format("YYYY")} 年 ${dayjs(dateSource).format("M")} 月 ${dayjs(dateSource).format("D")} 日`;

      const docxBuffer = await buildStudentEvaluationDocxByTemplate({
        className: student.className,
        studentName: student.name,
        itemScores,
        totalAvgScore: formatExportScore(summary?.avgScore, avgDecimalPlaces),
        comment,
        judgeNames: judgeNamesForSign,
        signatureImages: signatureImagesForAllJudges,
        scheduleDateText,
      });

      return {
        filename: `${String(student.orderNo).padStart(2, "0")}-${student.name}-教学技能评价表.docx`,
        buffer: docxBuffer,
        summaryEntry: {
          orderNo: student.orderNo,
          studentName: student.name,
          className: student.className,
          itemScores,
          totalAvgScore: formatExportScore(summary?.avgScore, avgDecimalPlaces),
          comment,
        },
      };
    });

    const groupName = binding.group?.name || "本组";
    const formFolderName = `${groupName}教学技能评价表`;
    const formFolder = zip.folder(formFolderName);
    for (const file of docxFiles) {
      formFolder?.file(file.filename, file.buffer);
    }

    const dateSource = binding.group?.scheduleTime || binding.group?.startTime || new Date().toISOString();
    const scheduleDateText = `${dayjs(dateSource).format("YYYY")} 年 ${dayjs(dateSource).format("M")} 月 ${dayjs(dateSource).format("D")} 日`;
    const summaryPrintBuffer = await buildStudentEvaluationSummaryByTemplate({
      students: docxFiles.map((file) => file.summaryEntry),
      judgeNames: judgeNamesForSign,
      signatureImages: signatureImagesForAllJudges,
      scheduleDateText,
    });
    zip.file(`${groupName}教学技能评价表-汇总打印版.docx`, summaryPrintBuffer);

    const zipBuffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    const chineseName = `${groupName}教学技能评价表-docx.zip`;
    reply.header("Content-Type", "application/zip");
    reply.header("Content-Disposition", buildContentDisposition(chineseName, "group-evaluation-docx-forms.zip"));
    return reply.send(zipBuffer);
  });

  app.get("/api/judge/activities/:activityId/export/group-xlsx", { preHandler: [app.authenticate] }, async (request: AuthRequest, reply) => {
    const { activityId } = request.params as { activityId: string };
    const { binding, students, exportMetricsMap } = await getJudgeExportContext(activityId, request.user.userId);
    const groupName = binding.group?.name || "本组";
    const avgDecimalPlaces = binding.activity.avgDecimalPlaces ?? 2;

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(`${groupName}成绩单`.slice(0, 31));
    const columns = [
      { header: "序号", key: "orderNo", width: 8 },
      { header: "姓名", key: "name", width: 12 },
      { header: "学号", key: "studentNo", width: 16 },
      { header: "班级", key: "className", width: 16 },
      { header: "总分", key: "totalScore", width: 12 },
      { header: "评分评委数", key: "judgeCount", width: 12 },
      { header: "平均分", key: "avgScore", width: 12 },
    ];
    sheet.columns = columns;
    const lastColumn = toExcelColumnName(columns.length);

    sheet.mergeCells(`A1:${lastColumn}1`);
    sheet.getCell("A1").value = `${groupName}成绩单`;
    sheet.getCell("A1").font = { bold: true, size: 20, color: { argb: "1F2D3D" } };
    sheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
    sheet.getCell("A1").fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "F6FAFF" },
    };
    sheet.getRow(1).height = 34;

    const headerRow = sheet.getRow(2);
    columns.forEach((column, index) => {
      const cell = headerRow.getCell(index + 1);
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
      cell.alignment = { horizontal: "center", vertical: "middle" };
    });
    headerRow.height = 24;

    for (const student of students) {
      const metrics = exportMetricsMap.get(student.id) || {
        totalScore: 0,
        judgeCount: 0,
        avgScore: formatExportScore(null, avgDecimalPlaces),
      };
      const row = sheet.addRow({
        orderNo: student.orderNo,
        name: student.name,
        studentNo: student.studentNo,
        className: student.className || "",
        totalScore: metrics.totalScore,
        judgeCount: metrics.judgeCount,
        avgScore: metrics.avgScore,
      });
      row.height = 22;

      row.eachCell((cell) => {
        cell.border = {
          top: { style: "thin", color: { argb: "E4ECF8" } },
          left: { style: "thin", color: { argb: "E4ECF8" } },
          bottom: { style: "thin", color: { argb: "E4ECF8" } },
          right: { style: "thin", color: { argb: "E4ECF8" } },
        };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        if (row.number % 2 === 1) {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FAFCFF" },
          };
        }
      });
    }

    sheet.views = [{ state: "frozen", ySplit: 2 }];

    const buffer = await workbook.xlsx.writeBuffer();
    reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const chineseName = `${groupName}成绩单.xlsx`;
    reply.header("Content-Disposition", buildContentDisposition(chineseName, `group-results-${binding.group?.sortOrder || 1}.xlsx`));
    return reply.send(buffer);
  });

  app.get("/api/judge/activities/:activityId/export/group-docx", { preHandler: [app.authenticate] }, async (request: AuthRequest, reply) => {
    const { activityId } = request.params as { activityId: string };
    const { binding, students, exportMetricsMap } = await getJudgeExportContext(activityId, request.user.userId);
    const groupName = binding.group?.name || "本组";
    const avgDecimalPlaces = binding.activity.avgDecimalPlaces ?? 2;

    const headerTexts = [
      "序号",
      "姓名",
      "学号",
      "班级",
      "总分",
      "评分评委数",
      "平均分",
    ];

    const columnWidths = [
      10,
      12,
      16,
      18,
      12,
      14,
      12,
    ];

    const createCell = (text: string, widthPercent: number, options?: { header?: boolean }) =>
      new TableCell({
        width: { size: widthPercent, type: WidthType.PERCENTAGE },
        shading: options?.header
          ? { type: ShadingType.CLEAR, fill: "DDEAFB", color: "auto" }
          : undefined,
        borders: {
          top: { style: BorderStyle.SINGLE, size: 1, color: options?.header ? "C9D8EE" : "E4ECF8" },
          bottom: { style: BorderStyle.SINGLE, size: 1, color: options?.header ? "C9D8EE" : "E4ECF8" },
          left: { style: BorderStyle.SINGLE, size: 1, color: options?.header ? "C9D8EE" : "E4ECF8" },
          right: { style: BorderStyle.SINGLE, size: 1, color: options?.header ? "C9D8EE" : "E4ECF8" },
        },
        margins: {
          top: 110,
          bottom: 110,
          left: 110,
          right: 110,
        },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text,
                bold: options?.header,
                size: 20,
                color: options?.header ? "2B3A55" : "1F2D3D",
              }),
            ],
          }),
        ],
      });

    const rows = [
      new TableRow({
        tableHeader: true,
        children: headerTexts.map((text, index) => createCell(text, columnWidths[index], { header: true })),
      }),
      ...students.map((student) => {
        const metrics = exportMetricsMap.get(student.id) || {
          totalScore: 0,
          judgeCount: 0,
          avgScore: formatExportScore(null, avgDecimalPlaces),
        };
        const rowValues = [
          String(student.orderNo),
          student.name,
          student.studentNo,
          student.className || "",
          String(metrics.totalScore),
          String(metrics.judgeCount),
          metrics.avgScore,
        ];
        return new TableRow({
          children: rowValues.map((text, index) => createCell(String(text), columnWidths[index])),
        });
      }),
    ];

    const doc = new Document({
      styles: {
        default: {
          document: {
            run: {
              font: "宋体",
              size: 21,
              color: "1F2D3D",
            },
            paragraph: {
              spacing: { line: 300 },
            },
          },
        },
      },
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: convertInchesToTwip(0.5),
                bottom: convertInchesToTwip(0.5),
                left: convertInchesToTwip(0.4),
                right: convertInchesToTwip(0.4),
              },
            },
          },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: 260 },
              children: [new TextRun({ text: `${groupName}成绩单`, bold: true, size: 34, color: "1F2D3D" })],
            }),
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              layout: TableLayoutType.FIXED,
              borders: {
                top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
                bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
                left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
                right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
                insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
                insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              },
              rows,
            }),
          ],
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    const chineseName = `${groupName}成绩单.docx`;
    reply.header("Content-Disposition", buildContentDisposition(chineseName, `group-results-${binding.group?.sortOrder || 1}.docx`));
    return reply.send(buffer);
  });
}
