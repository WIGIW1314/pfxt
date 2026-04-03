<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onBeforeUnmount, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { ArrowDown, Calendar, ChatLineSquare, Check, Document, Download, EditPen, Files, Lock, Postcard, Search, UploadFilled, User, View, Warning } from "@element-plus/icons-vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from "vue-router";
import AppShell from "../components/AppShell.vue";
import DocViewer from "../components/DocViewer.vue";
import { api, downloadFile } from "../api";
import { useAuthStore } from "../stores/auth";
import { useSyncStore } from "../stores/sync";
import { formatBJ } from "../date";
import { useModalHistory } from "../composables/useModalHistory";
import { distributeScore } from "../score-distribute";
import { matchesSearchKeyword } from "../utils/search";
import type { ScoreTemplate, Student } from "../types";

const ScoreDialog = defineAsyncComponent(() => import("../components/ScoreDialog.vue"));

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const sync = useSyncStore();

const section = computed(() => String(route.params.section || "home"));
const currentActivity = ref<any>(null);
const students = ref<Student[]>([]);
const progress = ref({ total: 0, submitted: 0, draft: 0, pending: 0 });
const currentStudent = ref<Student | null>(null);
const peerStudent = ref<Student | null>(null);
const scoreOpen = ref(false);
const peerScoreOpen = ref(false);
const scoreOpening = ref(false);
const peerScoreOpening = ref(false);
const resettingStudentId = ref<string | null>(null);
const keyword = ref("");
const rowForms = reactive<Record<string, { totalScore: number; comment: string; details: Record<string, number> }>>({});
const savedRowSignatures = reactive<Record<string, string>>({});
const compactScoreTable = computed(() => window.innerWidth < 768);
const batchLoading = ref<"" | "save-draft" | "submit-score" | "reset-score">("");
const rowCommentLoading = reactive<Record<string, boolean>>({});
const exportProgress = reactive({
  visible: false,
  title: "",
  status: "",
  percent: 0,
});
let exportProgressTimer: number | undefined;

useModalHistory(
  () => peerScoreOpen.value,
  async () => {
    peerScoreOpen.value = false;
    return true;
  },
  "judge-peer-scores",
);

useModalHistory(
  () => exportProgress.visible,
  async () => {
    exportProgress.visible = false;
    return true;
  },
  "judge-export-progress",
);

const activityId = computed(() => currentActivity.value?.activity?.id || auth.currentActivityRole?.activityId || "");
const exportBaseName = computed(() => `${currentActivity.value?.group?.name || "本组"}成绩单`);
const template = computed<ScoreTemplate | null>(() => {
  const activity = currentActivity.value?.activity;
  const templates = activity?.templates || [];
  return (
    templates.find((item: ScoreTemplate) => item.id === activity?.activeTemplateId) ||
    templates.find((item: ScoreTemplate) => item.isDefault) ||
    templates[0] ||
    null
  );
});
const activityLocked = computed(() => Boolean(currentActivity.value?.activity?.isLocked));
const groupLocked = computed(() => Boolean(currentActivity.value?.group?.isLocked));
function isOutsideTimeWindow(startTime?: string | null, endTime?: string | null) {
  if (!startTime && !endTime) return false;
  const now = Date.now();
  if (startTime && now < new Date(startTime).getTime()) return true;
  if (endTime && now > new Date(endTime).getTime()) return true;
  return false;
}
const activityTimeBlocked = computed(() => {
  const a = currentActivity.value?.activity;
  return a ? isOutsideTimeWindow(a.startTime, a.endTime) : false;
});
const groupTimeBlocked = computed(() => {
  const g = currentActivity.value?.group;
  return g ? isOutsideTimeWindow(g.startTime, g.endTime) : false;
});
const isLocked = computed(() => activityLocked.value || groupLocked.value || activityTimeBlocked.value || groupTimeBlocked.value);
const lockReason = computed(() => {
  if (activityLocked.value) return "当前活动已锁定";
  if (activityTimeBlocked.value) return "当前活动不在开放时间内";
  if (groupLocked.value) return "当前分组已锁定";
  if (groupTimeBlocked.value) return "当前分组不在开放时间内";
  return "";
});
const avgDecimalPlaces = computed(() => Number(currentActivity.value?.activity?.avgDecimalPlaces ?? 2));
const showExportZip = computed(() => currentActivity.value?.activity?.showExportZip !== false);
const showExportXlsx = computed(() => currentActivity.value?.activity?.showExportXlsx !== false);
const showCommentUi = computed(() => currentActivity.value?.activity?.showCommentUi !== false);
const showQuestionUi = computed(() => currentActivity.value?.activity?.showQuestionUi !== false);
const judgeAnnouncementHtml = computed(() => currentActivity.value?.activity?.judgeAnnouncement || '');
const judgeAnnouncementDocFiles = computed(() => {
  const raw = (currentActivity.value?.activity as any)?.judgeAnnouncementFiles;
  if (!raw) return [];
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return []; }
});
const isTotalOnly = computed(() => template.value?.scoreMode === "TOTAL" || !template.value?.items?.length);
const filteredStudents = computed(() =>
  students.value.filter((student) =>
    matchesSearchKeyword([student.name, student.studentNo, student.className], keyword.value),
  ),
);
const dirtyStudentIds = reactive(new Set<string>());

// Deep watch rowForms, savedRowSignatures, and students to reliably catch changes
watch(
  [rowForms, savedRowSignatures, students],
  () => {
    for (const student of students.value) {
      if (buildRowSignature(student.id) !== savedRowSignatures[student.id]) {
        dirtyStudentIds.add(student.id);
      } else {
        dirtyStudentIds.delete(student.id);
      }
    }
  },
  { deep: true, immediate: true }
);

const hasUnsavedChanges = computed(() => dirtyStudentIds.size > 0);
const hasPendingSubmission = computed(() =>
  students.value.some((student) => student.myScoreStatus === "DRAFT") || hasUnsavedChanges.value,
);

function buildRowSignature(studentId: string) {
  const row = rowForms[studentId];
  const detailSignature = isTotalOnly.value
    ? ""
    : (template.value?.items || [])
        .map((item) => `${item.id}:${Number(row?.details?.[item.id] || 0)}`)
        .join("|");

  return [
    studentId,
    Number(row?.totalScore || 0),
    row?.comment || "",
    detailSignature,
  ].join("\u001f");
}

function rowIsDirty(student: Student) {
  return dirtyStudentIds.has(student.id);
}

function rowNeedsSubmit(student: Student) {
  // 只提交改变过的数据，或者已经是草稿的数据
  return rowIsDirty(student) || student.myScoreStatus === "DRAFT";
}

function rowVisualStatus(student: Student) {
  if (rowIsDirty(student)) {
    return "PENDING";
  }
  if (student.myScoreStatus === "SUBMITTED") {
    return "SUBMITTED";
  }
  return "PENDING";
}

function rowClassName({ row }: { row: Student }) {
  if (rowIsDirty(row)) return "row-dirty";
  if (rowVisualStatus(row) === "SUBMITTED") return "row-submitted";
  if (row.myScoreStatus === "DRAFT") return "row-draft";
  return "";
}

function rowStatusMeta(student: Student) {
  const isDirty = rowIsDirty(student);

  // 1. 改变了某行的值 -> 待保存 和 待提交
  if (isDirty) {
    return [
      { icon: EditPen, color: "#f56c6c", label: "待保存" },
      { icon: Warning, color: "#ffb74d", label: "待提交" },
    ];
  }

  // 3. 点了提交 -> 清空警告状态（显示已提交）
  if (student.myScoreStatus === "SUBMITTED") {
    return [{ icon: Check, color: "#45c27c", label: "已提交" }];
  }

  // 2. 点了保存（或者之前保存过但未提交） -> 待提交
  if (student.myScoreStatus === "DRAFT") {
    return [
      { icon: Warning, color: "#ffb74d", label: "待提交" },
    ];
  }

  // 原本就是空的，什么也没做时保持空白显示
  return [];
}

async function fetchCurrentBinding() {
  try {
    const { data } = await api.get("/api/judge/current-activity");
    currentActivity.value = data;
  } catch {
    currentActivity.value = null;
  }
}

async function fetchJudgeRows(currentActivityId: string) {
  try {
    const [studentRes, progressRes] = await Promise.all([
      api.get(`/api/judge/activities/${currentActivityId}/students`),
      api.get(`/api/judge/activities/${currentActivityId}/progress`),
    ]);
    students.value = studentRes.data;
    progress.value = progressRes.data;
    syncRowForms();
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || "加载评分数据失败，请刷新重试");
  }
}

async function fetchJudgeData(options?: { refreshBinding?: boolean }) {
  if (options?.refreshBinding !== false) {
    await fetchCurrentBinding();
  }

  const currentActivityId = currentActivity.value?.activity?.id || "";

  if (!currentActivityId) {
    currentStudent.value = null;
    peerStudent.value = null;
    students.value = [];
    progress.value = { total: 0, submitted: 0, draft: 0, pending: 0 };
    syncRowForms();
    return;
  }

  await fetchJudgeRows(currentActivityId);
}

async function openScore(student: Student) {
  if (isLocked.value) {
    ElMessage.warning(lockReason.value + "，只读");
    return;
  }
  if (scoreOpening.value) return;
  scoreOpening.value = true;
  try {
    const { data } = await api.get(`/api/judge/activities/${activityId.value}/students/${student.id}`);
    currentStudent.value = data;
    scoreOpen.value = true;
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || "加载评分数据失败，请稍后重试");
  } finally {
    scoreOpening.value = false;
  }
}

async function resetScore(student: Student) {
  if (resettingStudentId.value) return;
  try {
    await ElMessageBox.confirm(
      `确定将「${student.name}」的评分重置为未评分状态吗？此操作不可撤销。`,
      "重置评分",
      { confirmButtonText: "确定重置", cancelButtonText: "取消", type: "warning" },
    );
  } catch {
    return;
  }
  resettingStudentId.value = student.id;
  try {
    await api.delete(`/api/judge/activities/${activityId.value}/students/${student.id}/reset-score`);
    // Locally clear the row state
    students.value = students.value.map((s) =>
      s.id === student.id ? { ...s, myScoreStatus: null, scores: [] } as typeof s : s,
    );
    const tmpl = template.value;
    rowForms[student.id] = {
      totalScore: 0,
      comment: "",
      details: tmpl?.items?.reduce<Record<string, number>>((acc, item) => { acc[item.id] = 0; return acc; }, {}) || {},
    };
    savedRowSignatures[student.id] = buildRowSignature(student.id);
    ElMessage.success("已重置为未评分");
    // Refresh progress counter in background
    void api.get(`/api/judge/activities/${activityId.value}/progress`).then(({ data: prog }) => {
      progress.value = prog;
    }).catch(() => {/* silent */});
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || "重置失败，请稍后重试");
  } finally {
    resettingStudentId.value = null;
  }
}

async function batchReset() {
  if (isLocked.value) {
    ElMessage.warning(lockReason.value + "，只读");
    return;
  }
  const targetStudents = filteredStudents.value.filter((student) => student.myScoreStatus !== null);
  if (targetStudents.length === 0) {
    ElMessage.info("当前没有可重置的评分");
    return;
  }
  try {
    await ElMessageBox.confirm(
      `确定将过滤后 ${targetStudents.length} 个学生的评分全部重置为未评分状态？此操作不可撤销。`,
      "批量重置评分",
      { confirmButtonText: "确定重置", cancelButtonText: "取消", type: "warning" },
    );
  } catch {
    return;
  }
  batchLoading.value = "reset-score";
  try {
    const { data } = await api.delete(`/api/judge/activities/${activityId.value}/batch-reset-score`, {
      data: { studentIds: targetStudents.map((s) => s.id) },
    });

    // Locally update affected rows
    const resultMap = new Map<string, any>();
    for (const r of data.results ?? []) {
      resultMap.set(r.studentId, r);
    }
    students.value = students.value.map((student) => {
      if (!resultMap.has(student.id)) return student;
      const r = resultMap.get(student.id);
      const updated = { ...student, myScoreStatus: null, scores: [] } as typeof student;
      if (r?.summary) updated.summary = r.summary;
      return updated;
    });
    // Reset rowForms and signatures for affected students
    for (const student of targetStudents) {
      const tmpl = template.value;
      rowForms[student.id] = {
        totalScore: 0,
        comment: "",
        details: tmpl?.items?.reduce<Record<string, number>>((acc, item) => { acc[item.id] = 0; return acc; }, {}) || {},
      };
      savedRowSignatures[student.id] = buildRowSignature(student.id);
    }

    ElMessage.success(`已批量重置 ${targetStudents.length} 个学生的评分`);

    // Refresh progress counter in background
    void api.get(`/api/judge/activities/${activityId.value}/progress`).then(({ data: prog }) => {
      progress.value = prog;
    }).catch(() => {/* silent */});
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || "批量重置失败，请稍后重试");
  } finally {
    batchLoading.value = "";
  }
}

async function openPeerScores(student: Student) {
  if (peerScoreOpening.value) return;
  peerScoreOpening.value = true;
  try {
    const { data } = await api.get(`/api/judge/activities/${activityId.value}/students/${student.id}`);
    peerStudent.value = data;
    peerScoreOpen.value = true;
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || "加载失败，请稍后重试");
  } finally {
    peerScoreOpening.value = false;
  }
}

async function refreshCurrentStudent() {
  if (!scoreOpen.value || !currentStudent.value) return;
  try {
    const { data } = await api.get(`/api/judge/activities/${activityId.value}/students/${currentStudent.value.id}`);
    currentStudent.value = data;
  } catch {
    // silent — background refresh, don't interrupt user
  }
}

async function refreshPeerStudent() {
  if (!peerScoreOpen.value || !peerStudent.value) return;
  try {
    const { data } = await api.get(`/api/judge/activities/${activityId.value}/students/${peerStudent.value.id}`);
    peerStudent.value = data;
  } catch {
    // silent
  }
}

function syncRowForms() {
  const currentTemplate = template.value;
  const activeStudentIds = new Set(students.value.map((student) => student.id));

  Object.keys(rowForms).forEach((studentId) => {
    if (!activeStudentIds.has(studentId)) {
      delete rowForms[studentId];
      delete rowQuickTotals[studentId];
      delete rowCommentLoading[studentId];
      delete savedRowSignatures[studentId];
    }
  });

  students.value.forEach((student) => {
    const existing = student.scores?.[0];
    rowForms[student.id] = {
      totalScore: existing?.totalScore || 0,
      comment: existing?.comment || "",
      details: currentTemplate?.items?.reduce<Record<string, number>>((acc, item) => {
        const detail = existing?.details?.find((entry) => entry.itemId === item.id);
        acc[item.id] = detail?.scoreValue || 0;
        return acc;
      }, {}) || {},
    };
    savedRowSignatures[student.id] = buildRowSignature(student.id);
  });
}

const rowQuickTotals = reactive<Record<string, number | undefined>>({});
const batchMaxTotal = computed(() => (template.value?.items || []).reduce((s, i) => s + i.maxScore, 0));

function distributeForRow(studentId: string) {
  const total = rowQuickTotals[studentId];
  if (total === undefined || !template.value?.items.length) return;
  const result = distributeScore(total, template.value.items);
  Object.assign(rowForms[studentId].details, result);
  rowQuickTotals[studentId] = undefined;
}

function rowTotal(studentId: string) {
  if (isTotalOnly.value) {
    return Number(rowForms[studentId]?.totalScore || 0);
  }

  return Number(
    (template.value?.items || []).reduce((sum, item) => sum + Number(rowForms[studentId]?.details?.[item.id] || 0), 0),
  );
}

function formatAvgScore(value: number | null | undefined) {
  if (value === null || value === undefined) return "-";
  return Number(value).toFixed(avgDecimalPlaces.value);
}

async function saveBatch(endpoint: "save-draft" | "submit-score") {
  if (isLocked.value) {
    ElMessage.warning(lockReason.value + "，只读");
    return;
  }
  if (!template.value || filteredStudents.value.length === 0) return;
  const targetStudents = filteredStudents.value.filter((student) =>
    endpoint === "save-draft" ? rowIsDirty(student) : rowNeedsSubmit(student),
  );

  if (targetStudents.length === 0) {
    ElMessage.info(endpoint === "save-draft" ? "当前没有需要保存的改动" : "当前没有需要提交的数据");
    return;
  }

  const batchEndpoint = endpoint === "save-draft" ? "batch-save-draft" : "batch-submit-score";
  const newStatus = endpoint === "save-draft" ? "DRAFT" : "SUBMITTED";

  batchLoading.value = endpoint;
  try {
    const { data } = await api.post(`/api/judge/activities/${activityId.value}/${batchEndpoint}`, {
      templateId: template.value.id,
      rows: targetStudents.map((student) => ({
        studentId: student.id,
        totalScore: rowTotal(student.id),
        comment: rowForms[student.id]?.comment || "",
        details: isTotalOnly.value
          ? []
          : template.value!.items.map((item) => ({
              itemId: item.id,
              scoreValue: Number(rowForms[student.id]?.details?.[item.id] || 0),
            })),
      })),
    });

    // Locally update affected rows without a full refetch
    const resultMap = new Map<string, any>();
    for (const r of data.results ?? []) {
      resultMap.set(r.studentId, r);
    }
    students.value = students.value.map((student) => {
      const r = resultMap.get(student.id);
      if (!r) return student;
      const updatedScore = r.score ? [r.score] : student.scores;
      const updated = { ...student, myScoreStatus: newStatus, scores: updatedScore } as typeof student;
      if (r.summary) updated.summary = r.summary;
      return updated;
    });
    // Refresh signatures so dirty flags clear
    for (const student of targetStudents) {
      savedRowSignatures[student.id] = buildRowSignature(student.id);
    }

    ElMessage.success(
      endpoint === "submit-score"
        ? `已批量提交 ${targetStudents.length} 行`
        : `已保存 ${targetStudents.length} 行草稿`,
    );

    // Refresh progress counter in background (non-blocking)
    void api.get(`/api/judge/activities/${activityId.value}/progress`).then(({ data: prog }) => {
      progress.value = prog;
    }).catch(() => {/* silent */});
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || "批量操作失败，请稍后重试");
  } finally {
    batchLoading.value = "";
  }
}

async function handleSingleScoreSuccess() {
  const student = currentStudent.value;
  if (!student) return;
  const sid = student.id;

  try {
    // Quick async progress refresh
    void api.get(`/api/judge/activities/${activityId.value}/progress`).then(({ data: prog }) => {
      progress.value = prog;
    }).catch(() => {/* silent */});

    // Fetch ONLY the modified student to update local state without losing focus
    const { data } = await api.get(`/api/judge/activities/${activityId.value}/students/${sid}`);
    const index = students.value.findIndex((s) => s.id === sid);
    if (index !== -1) {
      // 补齐后端单条接口没有直接挂载的字段，和列表接口保持一致
      data.myScoreStatus = data.scores?.[0]?.status || null;

      // Reassign element and replace array reference to force el-table row re-render
      const newStudents = [...students.value];
      newStudents[index] = data;
      students.value = newStudents;

      // Sync the forms
      const existing = data.scores?.[0];
      rowForms[sid] = {
        totalScore: existing?.totalScore || 0,
        comment: existing?.comment || "",
        details: template.value?.items?.reduce((acc, item) => {
          const detail = existing?.details?.find((entry: any) => entry.itemId === item.id);
          acc[item.id] = detail?.scoreValue || 0;
          return acc;
        }, {} as Record<string, number>) || {},
      };
      savedRowSignatures[sid] = buildRowSignature(sid);
    }
  } catch (e) {
    // silent
  }
}

async function handleExport(command: string) {
  const exportOptions: Record<string, { url: string; filename: string; title: string }> = {
    "evaluation-docx-zip": {
      url: `/api/judge/activities/${activityId.value}/export/group-evaluation-docx-zip`,
      filename: `${currentActivity.value?.group?.name || "本组"}教学技能评价表-docx.zip`,
      title: "导出教学评价表 ZIP",
    },
    xlsx: {
      url: `/api/judge/activities/${activityId.value}/export/group-xlsx`,
      filename: `${exportBaseName.value}.xlsx`,
      title: "导出 XLSX",
    },
    docx: {
      url: `/api/judge/activities/${activityId.value}/export/group-docx`,
      filename: `${exportBaseName.value}.docx`,
      title: "导出 DOCX",
    },
  };
  const currentExport = exportOptions[command];
  if (!currentExport) return;

  beginExportProgress(currentExport.title);
  try {
    await downloadFile(currentExport.url, currentExport.filename, {
      onProgress: ({ percent }) => {
        if (percent === null) {
          setExportProgress(92, "正在接收导出文件...");
          return;
        }
        setExportProgress(85 + Math.round(percent * 0.15), `正在下载文件 ${percent}%`);
      },
    });
    await finishExportProgress();
  } catch (error: any) {
    stopExportProgress();
    ElMessage.error(error?.response?.data?.message || "导出失败，请稍后重试");
  }
}

function clearExportProgressTimer() {
  if (exportProgressTimer !== undefined) {
    window.clearInterval(exportProgressTimer);
    exportProgressTimer = undefined;
  }
}

function beginExportProgress(title: string) {
  clearExportProgressTimer();
  exportProgress.visible = true;
  exportProgress.title = title;
  exportProgress.status = "正在准备导出数据...";
  exportProgress.percent = 6;
  exportProgressTimer = window.setInterval(() => {
    if (exportProgress.percent >= 84) return;
    exportProgress.percent = Math.min(
      84,
      exportProgress.percent + (exportProgress.percent < 36 ? 4 : exportProgress.percent < 68 ? 2 : 1),
    );
    if (exportProgress.percent < 36) {
      exportProgress.status = "正在收集评分数据...";
    } else if (exportProgress.percent < 68) {
      exportProgress.status = "正在生成导出文档...";
    } else {
      exportProgress.status = "正在压缩导出文件...";
    }
  }, 320);
}

function setExportProgress(percent: number, status: string) {
  exportProgress.percent = Math.min(100, Math.max(exportProgress.percent, percent));
  exportProgress.status = status;
}

async function finishExportProgress() {
  clearExportProgressTimer();
  exportProgress.percent = 100;
  exportProgress.status = "导出完成，正在保存文件...";
  await new Promise((resolve) => {
    window.setTimeout(resolve, 360);
  });
  exportProgress.visible = false;
}

function stopExportProgress() {
  clearExportProgressTimer();
  exportProgress.visible = false;
}

async function generateRowComment(student: Student) {
  if (isLocked.value || !template.value) return;
  rowCommentLoading[student.id] = true;
  try {
    const { data } = await api.post(`/api/judge/activities/${activityId.value}/students/${student.id}/generate-comment`, {
      totalScore: rowTotal(student.id),
      templateId: template.value.id,
      details: isTotalOnly.value
        ? []
        : template.value.items.map((item) => ({
            itemId: item.id,
            scoreValue: Number(rowForms[student.id]?.details?.[item.id] || 0),
          })),
    });
    rowForms[student.id].comment = data.comment || "";
    ElMessage.success(`已为 ${student.name} 生成评语`);
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || "生成评语失败");
  } finally {
    rowCommentLoading[student.id] = false;
  }
}

function handleBeforeUnload(event: BeforeUnloadEvent) {
  if (section.value !== "score" || !hasPendingSubmission.value) return;
  event.preventDefault();
  event.returnValue = "";
}

async function confirmLeaveIfNeeded() {
  if (section.value !== "score" || !hasPendingSubmission.value) return true;
  try {
    await ElMessageBox.confirm("当前仍有待提交分数，离开前请先提交；仅保存草稿不会视为完成。", "离开提醒", {
      confirmButtonText: "留在本页",
      cancelButtonText: "仍然离开",
      distinguishCancelAndClose: true,
      type: "warning",
    });
    return false;
  } catch {
    return true;
  }
}

function isCurrentActivityEvent(activityIdFromEvent?: string) {
  return !activityIdFromEvent || activityIdFromEvent === activityId.value;
}

async function refreshOpenStudentDialogs(changedStudentId?: string) {
  const tasks: Array<Promise<void>> = [];

  if (!changedStudentId || currentStudent.value?.id === changedStudentId) {
    tasks.push(refreshCurrentStudent());
  }
  if (!changedStudentId || peerStudent.value?.id === changedStudentId) {
    tasks.push(refreshPeerStudent());
  }

  await Promise.all(tasks);
}

watch(
  () => sync.version,
  async () => {
    const evt = sync.latestEvent;
    if (!evt || evt.type === "online.snapshot") {
      return;
    }

    // Skip score.updated broadcast that we ourselves emitted during a batch operation
    if (evt.type === "score.updated" && batchLoading.value) {
      return;
    }

    if (evt.type === "activity.updated") {
      try {
        await auth.fetchMe();
        sync.reconnect();
        await fetchJudgeData();
        await refreshOpenStudentDialogs(evt.payload?.studentId as string | undefined);
      } catch {
        // silent — background sync refresh
      }
      return;
    }

    const payloadActivityId = evt.payload?.activityId as string | undefined;
    if (!isCurrentActivityEvent(payloadActivityId)) {
      return;
    }

    try {
      if (evt.type === "score.updated") {
        // Batch broadcast has no studentId — do a full row refresh
        await fetchJudgeData({ refreshBinding: false });
        await refreshOpenStudentDialogs(evt.payload?.studentId as string | undefined);
        return;
      }

      if (
        evt.type === "group.updated"
        || evt.type === "judge.updated"
        || evt.type === "template.updated"
        || evt.type === "student.updated"
      ) {
        await fetchJudgeData({ refreshBinding: evt.type !== "student.updated" });
        await refreshOpenStudentDialogs(evt.payload?.studentId as string | undefined);
      }
    } catch {
      // silent — background sync refresh
    }
  },
);

onMounted(() => {
  void fetchJudgeData();
});
onMounted(() => {
  window.addEventListener("beforeunload", handleBeforeUnload);
});

function downloadQrcode(url: string, name: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}-二维码.png`;
  link.click();
}

onBeforeUnmount(() => {
  clearExportProgressTimer();
  window.removeEventListener("beforeunload", handleBeforeUnload);
});

onBeforeRouteLeave(async () => {
  return confirmLeaveIfNeeded();
});

onBeforeRouteUpdate(async () => {
  return confirmLeaveIfNeeded();
});
</script>

<template>
  <AppShell
    mode="judge"
    title="移动评分现场端"
    :subtitle="`${currentActivity?.activity?.name || '未绑定活动'} · ${currentActivity?.group?.name || '未分组'}`"
  >
    <section v-if="isLocked" class="readonly-banner judge-lock-banner">
      <el-icon><Lock /></el-icon>
      <span>{{ lockReason }}，只读，评委不可再保存或提交评分</span>
    </section>

    <template v-if="section === 'home'">
      <section class="stats-row home-block">
        <div class="glass-panel stat-card">
          <div class="muted">总人数</div>
          <div class="stat-value">{{ progress.total }}</div>
        </div>
        <div class="glass-panel stat-card">
          <div class="muted">已提交</div>
          <div class="stat-value">{{ progress.submitted }}</div>
        </div>
        <div class="glass-panel stat-card">
          <div class="muted">草稿</div>
          <div class="stat-value">{{ progress.draft }}</div>
        </div>
        <div class="glass-panel stat-card">
          <div class="muted">待评分</div>
          <div class="stat-value">{{ progress.pending }}</div>
        </div>
      </section>

      <section class="glass-panel entity-card home-block">
        <div class="judge-activity-card">
          <div class="judge-activity-main">
            <div class="judge-activity-title-row">
              <div class="judge-activity-badge-icon">
                <el-icon><Calendar /></el-icon>
              </div>
              <div>
                <h4 style="margin: 0">活动列表</h4>
                <div class="muted">当前正在进行的评分活动</div>
              </div>
            </div>
            <div class="judge-activity-name">{{ currentActivity?.activity?.name || "未绑定活动" }}</div>
            <div class="judge-activity-meta">
              <span>当前分组：{{ currentActivity?.group?.name || "未分组" }}</span>
              <span>待评分：{{ progress.pending }}</span>
              <span v-if="currentActivity?.customRole">
                角色：<el-tag :color="currentActivity.customRole.color || '#409eff'" style="color: #fff; border: none">{{ currentActivity.customRole.name }}</el-tag>
              </span>
            </div>
          </div>
          <div class="judge-activity-actions">
            <el-button type="primary" plain :icon="User" @click="router.push('/judge/students')">现场评分</el-button>
            <el-button type="primary" :icon="EditPen" @click="router.push('/judge/score')">表格评分</el-button>
          </div>
        </div>
      </section>

      <section v-if="currentActivity?.customRole?.description" class="glass-panel entity-card home-block">
        <div class="judge-role-responsibility">
          <h4 style="margin: 0 0 8px">
            <el-tag :color="currentActivity.customRole.color || '#409eff'" style="color: #fff; border: none; margin-right: 6px">{{ currentActivity.customRole.name }}</el-tag>
            职责说明
          </h4>
          <div class="muted" style="white-space: pre-wrap; line-height: 1.6">{{ currentActivity.customRole.description }}</div>
        </div>
      </section>

      <section v-if="currentActivity?.group?.qrcodeUrl" class="glass-panel entity-card home-block">
        <div style="text-align: center">
          <h4 style="margin: 0 0 8px">分组群二维码</h4>
          <div class="muted" style="margin-bottom: 8px">扫码加入「{{ currentActivity?.group?.name }}」评委群</div>
          <el-image
            :src="currentActivity.group.qrcodeUrl"
            :preview-src-list="[currentActivity.group.qrcodeUrl]"
            fit="contain"
            style="width: 200px; height: 200px; border-radius: 8px; border: 1px solid var(--el-border-color-lighter); cursor: pointer"
          />
          <el-button size="small" text type="primary" style="margin-top: 6px" @click="downloadQrcode(currentActivity.group!.qrcodeUrl!, currentActivity.group?.name || '分组')">下载二维码</el-button>
        </div>
      </section>
    </template>

    <template v-else-if="section === 'students'">
      <section class="glass-panel" style="padding: 12px">
        <div class="panel-header">
          <h3 style="margin: 0">学生列表</h3>
            <el-input v-model="keyword" style="width: min(220px, 100%)" placeholder="搜索姓名/学号/班级/拼音" />
        </div>
          <div class="card-list">
            <div v-for="student in filteredStudents" :key="student.id" class="glass-panel entity-card judge-student-card">
            <div class="panel-header">
              <div class="student-card-name-row">
                <span class="student-order-badge">#{{ student.orderNo }}</span>
                <div>
                  <h4 style="margin: 0">{{ student.name }}</h4>
                  <div class="muted">{{ student.studentNo }} · {{ student.className }}</div>
                </div>
              </div>
              <div class="tag-row">
                <el-tag
                  v-if="student.customRole"
                  round
                  :style="student.customRole.color ? `background:${student.customRole.color};border-color:${student.customRole.color};color:#fff` : ''"
                >
                  {{ student.customRole.name }}
                </el-tag>
                <template v-if="rowIsDirty(student)">
                  <el-tag type="danger" style="margin-right: 4px;">待保存</el-tag>
                  <el-tag type="warning">待提交</el-tag>
                </template>
                <el-tag v-else-if="student.myScoreStatus === 'SUBMITTED'" type="success">已提交</el-tag>
                <el-tag v-else-if="student.myScoreStatus === 'DRAFT'" type="warning">待提交</el-tag>
                <el-tag round>均分 {{ formatAvgScore(student.summary?.avgScore) }}</el-tag>
              </div>
            </div>
            <div style="margin-bottom: 12px">
              <el-button
                size="small"
                plain
                :loading="peerScoreOpening"
                class="peer-count-btn"
                @click="openPeerScores(student)"
              >
                {{ student.summary?.submittedJudgeCount }}/{{ student.summary?.requiredJudgeCount }} 已完成
              </el-button>
            </div>
            <el-button
              v-if="!student.myScoreStatus"
              :disabled="isLocked"
              :loading="scoreOpening"
              class="go-score-btn"
              style="width: 100%"
              @click="openScore(student)"
            >
              去评分
            </el-button>
            <div v-else style="display: flex; gap: 8px">
              <el-button
                :type="student.myScoreStatus === 'SUBMITTED' ? 'success' : 'primary'"
                :disabled="isLocked"
                :loading="scoreOpening"
                style="flex: 1"
                @click="openScore(student)"
              >
                修改评分
              </el-button>
              <el-button
                type="danger"
                plain
                :disabled="isLocked"
                :loading="resettingStudentId === student.id"
                @click="resetScore(student)"
              >
                重置
              </el-button>
            </div>
          </div>
        </div>
      </section>
    </template>

    <template v-else-if="section === 'score'">
      <section class="glass-panel judge-toolbar-panel">
        <div class="judge-toolbar-shell">
          <div class="judge-toolbar-search-block">
            <div class="judge-toolbar-label">快速检索</div>
              <el-input v-model="keyword" class="judge-toolbar-search" placeholder="搜索姓名、学号、班级或拼音">
              <template #prefix>
                <el-icon><Search /></el-icon>
              </template>
            </el-input>
          </div>
          <div class="judge-toolbar-action-block">
            <div class="judge-toolbar-label">批量操作</div>
            <div class="judge-toolbar-actions">
              <el-button class="judge-toolbar-button judge-toolbar-button-save" :type="hasUnsavedChanges ? 'primary' : ''" :plain="!hasUnsavedChanges" :icon="EditPen" :disabled="isLocked" :loading="batchLoading === 'save-draft'" @click="saveBatch('save-draft')">
                保存
              </el-button>
              <el-button class="judge-toolbar-button judge-toolbar-button-submit" type="primary" :icon="UploadFilled" :disabled="isLocked" :loading="batchLoading === 'submit-score'" @click="saveBatch('submit-score')">
                提交
              </el-button>
              <el-button class="judge-toolbar-button judge-toolbar-button-reset" type="danger" plain :icon="Warning" :disabled="isLocked" :loading="batchLoading === 'reset-score'" @click="batchReset()">
                重置
              </el-button>
              <el-dropdown @command="handleExport">
                <el-button class="judge-toolbar-button judge-toolbar-button-export" plain :icon="Download" :disabled="exportProgress.visible">
                  导出
                  <el-icon style="margin-left: 4px"><ArrowDown /></el-icon>
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item v-if="showExportZip" class="judge-export-item" command="evaluation-docx-zip">
                      <el-icon color="#d35400"><Document /></el-icon>
                      <span>导出教学评价表zip</span>
                    </el-dropdown-item>
                    <el-dropdown-item v-if="showExportXlsx" class="judge-export-item" command="xlsx">
                      <el-icon color="#2f80ed"><Files /></el-icon>
                      <span>导出为 xlsx</span>
                    </el-dropdown-item>
                    <el-dropdown-item class="judge-export-item" command="docx">
                      <el-icon color="#f2994a"><Document /></el-icon>
                      <span>导出为 docx</span>
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </div>
        </div>
      </section>

      <section class="glass-panel judge-score-table-panel" style="padding: 8px; overflow-x: auto">
        <el-table class="dense-table" :data="filteredStudents" border :row-class-name="rowClassName" min-width="720">
          <el-table-column label="#" width="36" fixed="left">
            <template #default="{ row }">
              <span>{{ row.orderNo }}</span>
            </template>
          </el-table-column>
          <el-table-column label="姓名" width="88" fixed="left">
            <template #default="{ row }">
              <div class="student-name-cell">
                <span>{{ row.name }}</span>
                <el-popover popper-class="student-no-popover" placement="top" trigger="click" :width="96">
                  <template #reference>
                    <el-button class="student-no-button" text>
                      <el-icon color="#7b8db1" size="13"><Postcard /></el-icon>
                    </el-button>
                  </template>
                  <div class="student-no-text">学号：{{ row.studentNo }}</div>
                </el-popover>
              </div>
            </template>
          </el-table-column>
          <el-table-column v-if="!compactScoreTable" prop="className" label="班级" width="72" />
          <el-table-column v-if="!compactScoreTable" prop="group.name" label="组" width="46" />

          <el-table-column v-if="!isTotalOnly" label="智能分配" width="130">
            <template #default="{ row }">
              <div class="quick-fill-cell">
                <el-input-number
                  v-model="rowQuickTotals[row.id]"
                  :min="0"
                  :max="batchMaxTotal"
                  :disabled="isLocked"
                  controls-position="right"
                  placeholder="输入总分"
                  style="width: 100%"
                  @keyup.enter="distributeForRow(row.id)"
                />
                <el-button v-if="rowQuickTotals[row.id] !== undefined" class="quick-fill-btn" text type="primary" @click="distributeForRow(row.id)">分配</el-button>
              </div>
            </template>
          </el-table-column>

          <el-table-column v-if="isTotalOnly" label="总分" width="76">
            <template #default="{ row }">
              <el-input-number
                v-model="rowForms[row.id].totalScore"
                :min="0"
                :max="template?.totalScore || 100"
                :disabled="isLocked"
                controls-position="right"
                style="width: 100%"
              />
            </template>
          </el-table-column>

          <el-table-column
            v-for="item in template?.items || []"
            v-else
            :key="item.id"
            :label="item.name"
            width="72"
          >
            <template #default="{ row }">
              <el-input-number
                v-model="rowForms[row.id].details[item.id]"
                :min="0"
                :max="item.maxScore"
                :disabled="isLocked"
                controls-position="right"
                style="width: 100%"
              />
            </template>
          </el-table-column>

          <el-table-column label="合计" width="52">
            <template #default="{ row }">
              <strong>{{ rowTotal(row.id) }}</strong>
            </template>
          </el-table-column>

          <el-table-column label="平均分" width="68">
            <template #default="{ row }">
              <div class="avg-score-cell">
                <strong>{{ formatAvgScore(row.summary?.avgScore) }}</strong>
                <el-button class="avg-score-detail-button" text @click="openPeerScores(row)">
                  <el-icon><View /></el-icon>
                </el-button>
              </div>
            </template>
          </el-table-column>

          <el-table-column v-if="showCommentUi" label="评语" :min-width="compactScoreTable ? 184 : 132">
            <template #default="{ row }">
              <div class="row-comment-box">
                <el-input
                  v-model="rowForms[row.id].comment"
                  class="comment-font-field"
                  :disabled="isLocked"
                  type="text"
                  placeholder="评语"
                />
                <el-button
                  size="small"
                  text
                  type="primary"
                  :disabled="isLocked"
                  class="row-comment-ai-button"
                  :loading="rowCommentLoading[row.id]"
                  @click="generateRowComment(row)"
                >
                  AI
                </el-button>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="状态" width="56">
            <template #default="{ row }">
              <div class="status-icons">
                <el-tooltip
                  v-for="item in rowStatusMeta(row)"
                  :key="item.label"
                  :content="item.label"
                  placement="top"
                >
                  <el-icon :color="item.color" size="16">
                    <component :is="item.icon" />
                  </el-icon>
                </el-tooltip>
              </div>
            </template>
          </el-table-column>
        </el-table>

        <div v-if="filteredStudents.length === 0" class="entity-card">
          <h4>没有匹配的学生</h4>
          <div class="muted">可以调整搜索条件，或去学生页查看完整状态。</div>
        </div>
      </section>
    </template>

    <template v-else-if="section === 'profile'">
      <section class="glass-panel entity-card">
        <div class="panel-header">
          <div>
            <h3 style="margin: 0">{{ auth.user?.realName }}</h3>
            <div class="muted">{{ auth.user?.username }} · {{ auth.user?.role }}</div>
          </div>
          <el-tag round>{{ currentActivity?.group?.name || "未分组" }}</el-tag>
        </div>
        <div class="muted">所属活动：{{ currentActivity?.activity?.name || "暂无" }}</div>
        <div class="muted" style="margin-top: 8px">最近同步：{{ formatBJ(new Date()) }}</div>
      </section>
    </template>

    <template v-else-if="section === 'announcement'">
      <div
        v-if="!judgeAnnouncementHtml && !judgeAnnouncementDocFiles.length"
        class="glass-panel"
        style="padding: 48px 20px; text-align: center"
      >
        <div style="font-size: 36px; opacity: 0.25; margin-bottom: 12px">📬</div>
        <div class="muted" style="font-size: 14px">暂无评委公告</div>
      </div>
      <div v-else class="glass-panel judge-announcement-panel">
        <div class="judge-announcement-header">
          <el-icon :size="16" style="color: var(--el-color-primary)"><ChatLineSquare /></el-icon>
          <span>评委公告</span>
        </div>
        <DocViewer :html="judgeAnnouncementHtml" :files="judgeAnnouncementDocFiles" />
      </div>
    </template>

    <ScoreDialog
      v-model="scoreOpen"
      :activity-id="activityId"
      :student="currentStudent"
      :template="template"
      :readonly="isLocked"
      :show-comment-ui="showCommentUi"
      :show-question-ui="showQuestionUi"
      @success="handleSingleScoreSuccess"
    />

    <el-dialog
      v-model="exportProgress.visible"
      width="min(420px, calc(100vw - 24px))"
      :show-close="false"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      title="导出进度"
    >
      <div class="export-progress-box">
        <div class="export-progress-title">{{ exportProgress.title }}</div>
        <div class="muted export-progress-status">{{ exportProgress.status }}</div>
        <el-progress :percentage="exportProgress.percent" :stroke-width="16" status="success" striped striped-flow />
      </div>
    </el-dialog>

    <el-dialog
      v-model="peerScoreOpen"
      class="peer-score-dialog"
      width="min(560px, calc(100vw - 16px))"
      :fullscreen="false"
      :title="peerStudent ? `${peerStudent.name} · 同组评分明细` : '同组评分明细'"
    >
      <div v-if="peerStudent" class="compact-grid">
        <div class="glass-panel entity-card">
          <div class="tag-row">
            <el-tag round>{{ peerStudent.group?.name || "未分组" }}</el-tag>
            <el-tag round type="info">{{ peerStudent.studentNo }}</el-tag>
            <el-tag round type="success">平均分 {{ formatAvgScore(peerStudent.summary?.avgScore) }}</el-tag>
          </div>
        </div>

        <div v-if="peerStudent.peerScores?.length" class="glass-panel entity-card">
          <div class="panel-header" style="margin-bottom: 6px">
            <strong>同组评委评分明细</strong>
            <span class="muted">实时同步，匿名代号展示</span>
          </div>
          <div class="card-list">
            <div v-for="peer in peerStudent.peerScores" :key="peer.id" class="peer-score-row">
              <div class="tag-row">
                <el-tag round>{{ peer.anonymousCode || "评委" }}</el-tag>
                <el-tag :type="peer.status === 'SUBMITTED' ? 'success' : 'warning'" round>
                  {{ peer.status === "SUBMITTED" ? "已提交" : "草稿" }}
                </el-tag>
                <el-tag round type="info">总分 {{ peer.totalScore }}</el-tag>
              </div>
              <div v-if="peer.details?.length" class="peer-score-detail-grid">
                <div v-for="detail in peer.details" :key="`${peer.id}-${detail.itemId}`" class="peer-score-detail-item">
                  <span>{{ template?.items.find((item) => item.id === detail.itemId)?.name || "评分项" }}</span>
                  <strong>{{ detail.scoreValue }}</strong>
                </div>
              </div>
              <div v-if="peer.comment" class="muted comment-font-text">备注：{{ peer.comment }}</div>
            </div>
          </div>
        </div>

        <div v-else class="glass-panel entity-card">
          <div class="muted">当前还没有其他同组评委的评分明细。</div>
        </div>
      </div>
    </el-dialog>
  </AppShell>
</template>

<style scoped>
.student-card-name-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.student-order-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  height: 32px;
  padding: 0 6px;
  border-radius: 8px;
  background: #409eff;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
  letter-spacing: 0;
}

.peer-count-btn {
  font-size: 12px;
  padding: 3px 10px;
  height: 26px;
  border-radius: 13px;
  color: #606266;
  border-color: var(--el-border-color);
}

.peer-count-btn:hover {
  color: #409eff;
  border-color: #409eff;
}

.go-score-btn {
  background: #409eff;
  border-color: #409eff;
  color: #fff;
  font-weight: 600;
}

.go-score-btn:hover,
.go-score-btn:focus {
  background: #66b1ff;
  border-color: #66b1ff;
  color: #fff;
}

.go-score-btn:disabled {
  background: var(--el-disabled-bg-color);
  color: var(--el-disabled-text-color);
}

.row-comment-box {
  display: flex;
  align-items: center;
  gap: 2px;
}

.row-comment-box :deep(.el-input) {
  flex: 1;
  min-width: 0;
}

.row-comment-box :deep(.el-input__wrapper) {
  min-height: 28px;
  padding: 0 6px;
}

.row-comment-ai-button {
  flex-shrink: 0;
  padding: 0 4px;
}

.comment-font-text {
  line-height: 1.7;
}

.export-progress-box {
  display: grid;
  gap: 12px;
}

.export-progress-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
}

.export-progress-status {
  min-height: 20px;
}

.judge-announcement-panel {
  padding: 20px 24px;
}

.judge-announcement-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5);
}
</style>
