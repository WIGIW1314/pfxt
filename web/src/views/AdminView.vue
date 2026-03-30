<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { Connection, Delete, EditPen, Histogram, Lock, Plus, RefreshRight, Search, Setting, Top, Upload, UserFilled } from "@element-plus/icons-vue";
import AppShell from "../components/AppShell.vue";
import { api, downloadFile } from "../api";
import { useAuthStore } from "../stores/auth";
import { formatBJ } from "../date";
import { useSyncStore } from "../stores/sync";
import { useModalHistory } from "../composables/useModalHistory";
import { matchesSearchKeyword } from "../utils/search";
import type { Activity, ActivityCustomRole, Group, ScoreTemplate, Student } from "../types";

const ImportDialog = defineAsyncComponent(() => import("../components/ImportDialog.vue"));
const RichEditor = defineAsyncComponent(() => import("../components/RichEditor.vue"));

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const sync = useSyncStore();
const ADMIN_DASHBOARD_ACTIVITY_KEY = "score-system-admin-dashboard-activity";

const activities = ref<Activity[]>([]);
const dashboard = ref<any>(null);
const groups = ref<Group[]>([]);
const students = ref<Student[]>([]);
const judges = ref<any[]>([]);
const templates = ref<ScoreTemplate[]>([]);
const logs = ref<any[]>([]);
const customRoles = ref<ActivityCustomRole[]>([]);

const section = computed(() => String(route.params.section || "dashboard"));
const selectedActivityId = ref("");
const dashboardActivityId = ref(localStorage.getItem(ADMIN_DASHBOARD_ACTIVITY_KEY) || "");
const activityId = computed(() => selectedActivityId.value || activities.value.find((item) => item.isActive)?.id || activities.value[0]?.id || auth.currentActivityRole?.activityId || "");
const currentActivity = computed(() => activities.value.find((item) => item.isActive) || activities.value.find((item) => item.id === activityId.value) || activities.value[0] || null);
const dashboardActivity = computed(() => activities.value.find((item) => item.id === dashboardActivityId.value) || currentActivity.value || null);
const currentActivityLocked = computed(() => Boolean(currentActivity.value?.isLocked));
const onlineRoleLabelMap: Record<string, string> = {
  SUPER_ADMIN: "系统管理员",
  ACTIVITY_ADMIN: "管理员",
  JUDGE: "评委",
  SECRETARY: "秘书",
};
const onlineRoleSortMap: Record<string, number> = {
  SUPER_ADMIN: 10,
  ACTIVITY_ADMIN: 20,
  JUDGE: 30,
  SECRETARY: 40,
};
type OnlineUser = {
  id: string;
  username: string;
  realName: string;
  role: string;
  activityId: string | null;
  activityName: string | null;
  activityRole: string | null;
  customRoleId: string | null;
  customRoleName: string | null;
  customRoleColor: string | null;
  customRoleSortOrder: number | null;
  groupId: string | null;
  groupName: string | null;
};
type ResultSummary = {
  requiredJudgeCount: number;
  submittedJudgeCount: number;
  avgScore: number | null;
  finalScore: number | null;
  isComplete: boolean;
};
type ResultRow = {
  id: string;
  activityId: string;
  groupId: string;
  studentNo: string;
  name: string;
  gender?: string | null;
  className?: string | null;
  orderNo: number;
  rankNo: number;
  group?: {
    id: string;
    name: string;
  } | null;
  summary: ResultSummary | null;
};
const results = ref<ResultRow[]>([]);
const activeTemplate = computed(
  () =>
    templates.value.find((item) => item.id === currentActivity.value?.activeTemplateId) ||
    templates.value.find((item) => item.isDefault) ||
    templates.value[0] ||
    null,
);
const onlineState = computed<{
  total: number;
  judges: number;
  admins: number;
  secretaries: number;
  users: OnlineUser[];
}>(() => sync.onlineSnapshot || {
  total: dashboard.value?.onlineUserCount || 0,
  judges: dashboard.value?.onlineJudgeCount || 0,
  admins: dashboard.value?.onlineAdminCount || 0,
  secretaries: dashboard.value?.onlineSecretaryCount || 0,
  users: dashboard.value?.onlineUsers || [],
});
const activeActivityOnlineUsers = computed<OnlineUser[]>(() => {
  const users = onlineState.value.users || [];
  const activeId = currentActivity.value?.id;
  if (!activeId) return users;
  return users.filter((user) => user.activityId === activeId);
});
const activeActivityOnlineRoleStats = computed(() => {
  const statMap = new Map<string, { key: string; label: string; count: number; sortOrder: number }>();
  activeActivityOnlineUsers.value.forEach((user) => {
    const key = user.customRoleId || user.activityRole || user.role || user.id;
    const label = resolveOnlineRoleLabel(user);
    const sortOrder = user.customRoleId
      ? 100 + (user.customRoleSortOrder ?? 0)
      : (onlineRoleSortMap[user.activityRole || user.role] ?? 999);
    const current = statMap.get(key);
    if (current) {
      current.count += 1;
      return;
    }
    statMap.set(key, { key, label, count: 1, sortOrder });
  });
  return Array.from(statMap.values()).sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, "zh-CN"));
});

function resolveOnlineRoleLabel(user: OnlineUser) {
  return user.customRoleName || onlineRoleLabelMap[user.activityRole || user.role] || user.activityRole || user.role || "未分配角色";
}

const onlineUserHueMap = new Map<string, number>();

function getOnlineUserCardStyle(user: OnlineUser) {
  if (!onlineUserHueMap.has(user.id)) {
    onlineUserHueMap.set(user.id, Math.floor(Math.random() * 360));
  }
  const hue = onlineUserHueMap.get(user.id) ?? 200;
  return {
    background: `linear-gradient(135deg, hsla(${hue}, 90%, 95%, 0.96), hsla(${(hue + 20) % 360}, 88%, 91%, 0.9))`,
    color: `hsl(${hue}, 44%, 26%)`,
    boxShadow: `0 6px 16px hsla(${hue}, 70%, 70%, 0.12)`,
  };
}

const loading = ref(false);
const dialogSubmitting = ref(false);

async function withDialogSubmit(fn: () => Promise<void>) {
  if (dialogSubmitting.value) return;
  dialogSubmitting.value = true;
  try {
    await fn();
  } finally {
    dialogSubmitting.value = false;
  }
}
const mobileDialog = computed(() => window.innerWidth < 768);
const isCompactResultPagination = ref(typeof window !== "undefined" ? window.innerWidth <= 560 : false);
const resultCurrentPage = ref(1);
const resultPageSize = ref(24);
const resultsScrollRef = ref<HTMLElement | null>(null);
const showResultsBackTop = ref(false);
const resultKeyword = ref("");
const resultGroupFilter = ref("");
const resultStatusFilter = ref("ALL");
const resultScoreFilter = ref("ALL");
const resultStatusOptions = [
  { label: "全部进度", value: "ALL" },
  { label: "已完成", value: "COMPLETED" },
  { label: "进行中", value: "IN_PROGRESS" },
  { label: "未开始", value: "PENDING" },
];
const resultScoreOptions = [
  { label: "全部分数", value: "ALL" },
  { label: "90 分及以上", value: "EXCELLENT" },
  { label: "80 - 89 分", value: "GOOD" },
  { label: "60 - 79 分", value: "PASS" },
  { label: "60 分以下", value: "FAILED" },
  { label: "暂无最终分", value: "NO_SCORE" },
];
const resultPaginationLayout = computed(() =>
  isCompactResultPagination.value ? "prev, pager, next" : "total, sizes, prev, pager, next, jumper",
);
const resultPaginationSizes = computed(() =>
  isCompactResultPagination.value ? [12, 24, 48] : [12, 24, 48, 96],
);
const resultGroupOptions = computed(() => {
  const groupMap = new Map<string, string>();
  results.value.forEach((row) => {
    if (row.group?.id) {
      groupMap.set(row.group.id, row.group.name);
    }
  });
  return Array.from(groupMap.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
});
const filteredResults = computed(() => {
  const keyword = resultKeyword.value.trim();
  return results.value.filter((row) => {
    const submittedJudgeCount = row.summary?.submittedJudgeCount ?? 0;
    const finalScore = row.summary?.finalScore;
    const matchesKeyword = matchesSearchKeyword(
      [row.name, row.studentNo, row.className, row.group?.name, row.orderNo, row.rankNo],
      keyword,
    );
    const matchesGroup = !resultGroupFilter.value || row.group?.id === resultGroupFilter.value;
    const matchesStatus =
      resultStatusFilter.value === "ALL" ||
      (resultStatusFilter.value === "COMPLETED" && Boolean(row.summary?.isComplete)) ||
      (resultStatusFilter.value === "IN_PROGRESS" && submittedJudgeCount > 0 && !row.summary?.isComplete) ||
      (resultStatusFilter.value === "PENDING" && submittedJudgeCount === 0);
    const matchesScore =
      resultScoreFilter.value === "ALL" ||
      (resultScoreFilter.value === "EXCELLENT" && finalScore != null && Number(finalScore) >= 90) ||
      (resultScoreFilter.value === "GOOD" && finalScore != null && Number(finalScore) >= 80 && Number(finalScore) < 90) ||
      (resultScoreFilter.value === "PASS" && finalScore != null && Number(finalScore) >= 60 && Number(finalScore) < 80) ||
      (resultScoreFilter.value === "FAILED" && finalScore != null && Number(finalScore) < 60) ||
      (resultScoreFilter.value === "NO_SCORE" && finalScore == null);
    return matchesKeyword && matchesGroup && matchesStatus && matchesScore;
  });
});
const paginatedResults = computed(() => {
  const start = (resultCurrentPage.value - 1) * resultPageSize.value;
  return filteredResults.value.slice(start, start + resultPageSize.value);
});
const resultEmptyDescription = computed(() => {
  if (!results.value.length) return "暂无评分数据";
  return "没有符合当前筛选条件的结果";
});
watch([results, resultKeyword, resultGroupFilter, resultStatusFilter, resultScoreFilter], () => {
  resultCurrentPage.value = 1;
  showResultsBackTop.value = false;
});

function syncResponsiveState() {
  if (typeof window === "undefined") return;
  isCompactResultPagination.value = window.innerWidth <= 560;
}

function syncResultsBackTopVisibility() {
  if (typeof window === "undefined") {
    showResultsBackTop.value = false;
    return;
  }
  const pageScrolled = window.scrollY > 180;
  const panelScrolled = (resultsScrollRef.value?.scrollTop ?? 0) > 140;
  showResultsBackTop.value = pageScrolled || panelScrolled;
}

function handleResultsScroll() {
  syncResultsBackTopVisibility();
}

function scrollResultsToTop() {
  resultsScrollRef.value?.scrollTo({ top: 0, behavior: "smooth" });
  if (typeof window !== "undefined") {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function clearResultFilters() {
  resultKeyword.value = "";
  resultGroupFilter.value = "";
  resultStatusFilter.value = "ALL";
  resultScoreFilter.value = "ALL";
}

function getResultProgressPercentage(row: ResultRow) {
  const requiredJudgeCount = row.summary?.requiredJudgeCount ?? 0;
  if (!requiredJudgeCount) return 0;
  return Math.round(((row.summary?.submittedJudgeCount ?? 0) / requiredJudgeCount) * 100);
}

function formatDecimalScore(val: any) {
  if (val == null || val === "" || isNaN(val)) return "-";
  const places = currentActivity.value?.avgDecimalPlaces ?? 2;
  return Number(val).toFixed(places);
}
function getScoreColorStyle(score: any) {
  if (score == null || score === "" || isNaN(score)) return {};
  const s = Number(score);
  if (s < 60) {
    return {
      background: "linear-gradient(135deg, rgba(255, 226, 231, 0.96) 0%, rgba(255, 243, 245, 0.82) 52%, rgba(255, 255, 255, 0.45) 100%)",
    };
  }
  if (s <= 60) {
    return {
      background: "linear-gradient(135deg, rgba(255, 236, 239, 0.96) 0%, rgba(255, 247, 248, 0.84) 52%, rgba(255, 255, 255, 0.45) 100%)",
    };
  }
  if (s < 70) {
    return {
      background: "linear-gradient(135deg, rgba(255, 236, 221, 0.94) 0%, rgba(255, 247, 236, 0.8) 55%, rgba(255, 255, 255, 0.42) 100%)",
    };
  }
  if (s < 80) {
    return {
      background: "linear-gradient(135deg, rgba(255, 245, 214, 0.94) 0%, rgba(255, 250, 234, 0.8) 55%, rgba(255, 255, 255, 0.42) 100%)",
    };
  }
  if (s < 90) {
    return {
      background: "linear-gradient(135deg, rgba(224, 242, 255, 0.94) 0%, rgba(239, 248, 255, 0.8) 55%, rgba(255, 255, 255, 0.42) 100%)",
    };
  }
  if (s < 100) {
    return {
      background: "linear-gradient(135deg, rgba(221, 249, 240, 0.94) 0%, rgba(238, 252, 247, 0.8) 55%, rgba(255, 255, 255, 0.42) 100%)",
    };
  }
  return {
    background: "linear-gradient(135deg, rgba(223, 247, 223, 0.96) 0%, rgba(241, 252, 241, 0.84) 55%, rgba(255, 255, 255, 0.45) 100%)",
  };
}

function getFinalScoreTextColor(score: any) {
  if (score == null || score === "" || isNaN(score)) return "var(--el-text-color-primary)";
  const s = Number(score);
  if (s <= 60) return "#d64545";
  if (s < 70) return "#df7a1c";
  if (s < 80) return "#c99617";
  if (s < 90) return "#2f80ed";
  if (s < 100) return "#18a999";
  return "#42b24a";
}

const activityDialog = ref(false);
const groupDialog = ref(false);
const groupJudgeDialog = ref(false);
const groupJudgeTargetId = ref("");
const groupJudgeSearch = ref("");
const systemUsers = ref<Array<{ id: string; username: string; realName: string; role: string; isActive: boolean }>>([]);
const studentDialog = ref(false);
const judgeDialog = ref(false);
const logDialog = ref(false);
const studentImportOpen = ref(false);
const judgeImportOpen = ref(false);
const groupImportOpen = ref(false);
const editingTemplateId = ref("");
const editingActivityId = ref("");
const editingGroupId = ref("");
const editingStudentId = ref("");
const editingJudgeId = ref("");
const editingLogId = ref("");
const selectedActivityIds = ref<string[]>([]);
const selectedActivityRows = computed(() => activities.value.filter((item) => selectedActivityIds.value.includes(item.id)));
const allActivitiesSelected = computed(() => activities.value.length > 0 && selectedActivityIds.value.length === activities.value.length);
const selectedGroupIds = ref<string[]>([]);
const selectedStudentIds = ref<string[]>([]);
const selectedJudgeIds = ref<string[]>([]);
const selectedGroups = computed(() => groups.value.filter((item) => selectedGroupIds.value.includes(item.id)));
const selectedStudents = computed(() => students.value.filter((item) => selectedStudentIds.value.includes(item.id)));
const selectedJudges = computed(() => judges.value.filter((item) => selectedJudgeIds.value.includes(item.id)));
const selectedLogIds = ref<string[]>([]);
const selectedLogs = computed(() => logs.value.filter((item) => selectedLogIds.value.includes(item.id)));
const allGroupsSelected = computed(() => groups.value.length > 0 && selectedGroupIds.value.length === groups.value.length);
const allStudentsSelected = computed(() => students.value.length > 0 && selectedStudentIds.value.length === students.value.length);
const allJudgesSelected = computed(() => judges.value.length > 0 && selectedJudgeIds.value.length === judges.value.length);
const allLogsSelected = computed(() => logs.value.length > 0 && selectedLogIds.value.length === logs.value.length);

const customRoleDialog = ref(false);
const editingCustomRoleId = ref("");
const selectedCustomRoleIds = ref<string[]>([]);
const selectedCustomRoles = computed(() => customRoles.value.filter((item) => selectedCustomRoleIds.value.includes(item.id)));
const allCustomRolesSelected = computed(() => customRoles.value.length > 0 && selectedCustomRoleIds.value.length === customRoles.value.length);

const customRoleForm = reactive({
  name: "",
  description: "",
  color: "#409eff",
  sortOrder: 0,
});

type ActivityDialogMode = "create" | "edit" | "clone";
const activityDialogMode = ref<ActivityDialogMode>("create");
const cloningSourceActivityId = ref("");
const activityDialogTitle = computed(() =>
  activityDialogMode.value === "edit" ? "编辑活动" : activityDialogMode.value === "clone" ? "复制活动" : "新建活动",
);
const activityDialogSubmitText = computed(() =>
  activityDialogMode.value === "edit" ? "更新" : activityDialogMode.value === "clone" ? "保存复制" : "保存",
);

const activityForm = reactive({
  name: "",
  code: "",
  type: "微格教学",
  scoreMode: "ITEMIZED",
  calcMode: "SIMPLE_AVG",
  description: "",
  startTime: "",
  endTime: "",
  isPublicVisible: true,
});


// 修改密码弹窗相关
const passwordDialog = ref(false);
const passwordForm = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: '',
});
const passwordLoading = ref(false);

function bindSimpleModalHistory(source: { value: boolean }, key: string) {
  useModalHistory(
    () => source.value,
    async () => {
      source.value = false;
      return true;
    },
    key,
  );
}

function openPasswordDialog() {
  passwordForm.oldPassword = '';
  passwordForm.newPassword = '';
  passwordForm.confirmPassword = '';
  passwordDialog.value = true;
}

async function submitPasswordChange() {
  if (!passwordForm.oldPassword || !passwordForm.newPassword) {
    ElMessage.error('请输入完整信息');
    return;
  }
  if (passwordForm.newPassword !== passwordForm.confirmPassword) {
    ElMessage.error('两次新密码输入不一致');
    return;
  }
  passwordLoading.value = true;
  try {
    const { data } = await api.post('/api/auth/change-password', {
      oldPassword: passwordForm.oldPassword,
      newPassword: passwordForm.newPassword,
    });
    if (data.success) {
      ElMessage.success('密码修改成功，请重新登录');
      passwordDialog.value = false;
      auth.logout();
      router.push('/login');
    } else {
      ElMessage.error(data.message || '密码修改失败');
    }
  } catch (e) {
    ElMessage.error('密码修改失败');
  } finally {
    passwordLoading.value = false;
  }
}

const announcementDialog = ref(false);
const announcementEditId = ref("");
const announcementContent = ref("");
const announcementFiles = ref<Array<{ name: string; url: string; type: string; description?: string }>>([]);
const announcementSaving = ref(false);
const announcementUploading = ref(false);

bindSimpleModalHistory(passwordDialog, "admin-password-dialog");
bindSimpleModalHistory(activityDialog, "admin-activity-dialog");
bindSimpleModalHistory(announcementDialog, "admin-announcement-dialog");
bindSimpleModalHistory(groupDialog, "admin-group-dialog");
bindSimpleModalHistory(groupJudgeDialog, "admin-group-judge-dialog");
bindSimpleModalHistory(studentDialog, "admin-student-dialog");
bindSimpleModalHistory(judgeDialog, "admin-judge-dialog");
bindSimpleModalHistory(logDialog, "admin-log-dialog");
bindSimpleModalHistory(customRoleDialog, "admin-custom-role-dialog");
bindSimpleModalHistory(studentImportOpen, "admin-student-import-dialog");
bindSimpleModalHistory(judgeImportOpen, "admin-judge-import-dialog");
bindSimpleModalHistory(groupImportOpen, "admin-group-import-dialog");

function openAnnouncementEditor(activity: Activity) {
  announcementEditId.value = activity.id;
  announcementContent.value = (activity as any).announcement || "";
  try {
    const raw = (activity as any).announcementFiles;
    announcementFiles.value = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : [];
  } catch { announcementFiles.value = []; }
  announcementDialog.value = true;
}

async function handleAnnouncementFileUpload(uploadFile: any) {
  announcementUploading.value = true;
  try {
    const fd = new FormData();
    fd.append("file", uploadFile.raw || uploadFile);
    const { data } = await api.post(
      `/api/admin/activities/${announcementEditId.value}/upload`,
      fd,
      { headers: { "Content-Type": "multipart/form-data" } },
    );
    announcementFiles.value.push(data);
    ElMessage.success(`${data.name} 上传成功`);
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || "上传失败");
  } finally {
    announcementUploading.value = false;
  }
}

function removeAnnouncementFile(index: number) {
  announcementFiles.value.splice(index, 1);
}

async function saveAnnouncement() {
  announcementSaving.value = true;
  try {
    await api.put(`/api/admin/activities/${announcementEditId.value}`, {
      announcement: announcementContent.value,
      announcementFiles: JSON.stringify(announcementFiles.value),
    });
    ElMessage.success("公告已保存");
    announcementDialog.value = false;
    fetchAll();
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || "保存失败");
  } finally {
    announcementSaving.value = false;
  }
}

const groupForm = reactive({
  name: "",
  sortOrder: 0,
  location: "",
  scheduleTime: "",
  note: "",
  isLocked: false,
  startTime: "",
  endTime: "",
  qrcodeUrl: "",
});

const studentForm = reactive({
  groupId: "",
  studentNo: "",
  name: "",
  gender: "",
  className: "",
  orderNo: 0,
  customRoleId: "",
});

const judgeForm = reactive({
  username: "",
  realName: "",
  password: "123456",
  role: "JUDGE",
  groupId: "",
  customRoleId: "",
});

const logForm = reactive({
  operatorName: "",
  module: "",
  action: "",
  targetType: "",
  targetId: "",
  beforeData: "",
  afterData: "",
});

const activitySettingsForm = reactive({
  activeTemplateId: "",
  avgDecimalPlaces: 2,
});

function createDefaultTemplateItems() {
  return [
    { name: "内容设计", maxScore: 30, sortOrder: 1, isRequired: true, description: "" },
    { name: "表达呈现", maxScore: 25, sortOrder: 2, isRequired: true, description: "" },
    { name: "互动效果", maxScore: 25, sortOrder: 3, isRequired: true, description: "" },
    { name: "教态仪表", maxScore: 20, sortOrder: 4, isRequired: true, description: "" },
  ];
}

const templateForm = reactive({
  name: "标准评分模板",
  scoreMode: "ITEMIZED",
  totalScore: 100,
  items: createDefaultTemplateItems(),
});
const isTotalTemplate = computed(() => templateForm.scoreMode === "TOTAL");
const templateItemScoreTotal = computed(() =>
  templateForm.items.reduce((sum, item) => sum + Number(item.maxScore || 0), 0),
);
const templateItemScoreDiff = computed(() => templateItemScoreTotal.value - Number(templateForm.totalScore || 0));
const templateItemScoreBalanced = computed(() => isTotalTemplate.value || templateItemScoreDiff.value === 0);

function getTemplateItemShare(maxScore: number) {
  const total = Number(templateForm.totalScore || 0);
  if (!total) return "0%";
  return `${Math.round((Number(maxScore || 0) / total) * 100)}%`;
}

function normalizeTemplateItems() {
  templateForm.items = templateForm.items.map((item, index) => ({
    ...item,
    sortOrder: index + 1,
  }));
}

function resetTemplateForm() {
  editingTemplateId.value = "";
  Object.assign(templateForm, {
    name: "标准评分模板",
    scoreMode: "ITEMIZED",
    totalScore: 100,
    items: createDefaultTemplateItems(),
  });
}

function fillTemplateForm(template: ScoreTemplate) {
  editingTemplateId.value = template.id;
  Object.assign(templateForm, {
    name: template.name,
    scoreMode: template.scoreMode,
    totalScore: template.totalScore,
    items: template.items.map((item, index) => ({
      name: item.name,
      maxScore: item.maxScore,
      sortOrder: index + 1,
      isRequired: item.isRequired,
      description: item.description || "",
    })),
  });
}

function syncActivitySettings() {
  activitySettingsForm.activeTemplateId = activeTemplate.value?.id || "";
  activitySettingsForm.avgDecimalPlaces = currentActivity.value?.avgDecimalPlaces ?? 2;
}

function resetActivityForm() {
  activityDialogMode.value = "create";
  cloningSourceActivityId.value = "";
  editingActivityId.value = "";
  Object.assign(activityForm, {
    name: "",
    code: "",
    type: "微格教学",
    scoreMode: "ITEMIZED",
    calcMode: "SIMPLE_AVG",
    description: "",
    startTime: "",
    endTime: "",
    isPublicVisible: true,
  });
}

function resetGroupForm() {
  editingGroupId.value = "";
  Object.assign(groupForm, {
    name: "",
    sortOrder: groups.value.length + 1,
    location: "",
    scheduleTime: "",
    note: "",
    isLocked: false,
    startTime: "",
    endTime: "",
    qrcodeUrl: "",
  });
}

function resetStudentForm() {
  editingStudentId.value = "";
  Object.assign(studentForm, {
    groupId: groups.value[0]?.id || "",
    studentNo: "",
    name: "",
    gender: "",
    className: "",
    orderNo: students.value.length + 1,
    customRoleId: "",
  });
}

function resetJudgeForm() {
  editingJudgeId.value = "";
  Object.assign(judgeForm, {
    username: "",
    realName: "",
    password: "123456",
    role: "JUDGE",
    groupId: groups.value[0]?.id || "",
    customRoleId: "",
  });
}

function resetLogForm() {
  editingLogId.value = "";
  Object.assign(logForm, {
    operatorName: auth.user?.realName || auth.user?.username || "",
    module: "",
    action: "",
    targetType: "",
    targetId: "",
    beforeData: "",
    afterData: "",
  });
}

function resetCustomRoleForm() {
  editingCustomRoleId.value = "";
  Object.assign(customRoleForm, { name: "", description: "", color: "#409eff", sortOrder: 0 });
}

function openCreateCustomRole() {
  resetCustomRoleForm();
  customRoleDialog.value = true;
}

function openEditCustomRole(role: ActivityCustomRole) {
  editingCustomRoleId.value = role.id;
  Object.assign(customRoleForm, {
    name: role.name,
    description: role.description || "",
    color: role.color || "#409eff",
    sortOrder: role.sortOrder,
  });
  customRoleDialog.value = true;
}

function openCreateActivity() {
  resetActivityForm();
  activityDialogMode.value = "create";
  activityDialog.value = true;
}

function openEditActivity(activity: Activity) {
  activityDialogMode.value = "edit";
  cloningSourceActivityId.value = "";
  editingActivityId.value = activity.id;
  Object.assign(activityForm, {
    name: activity.name,
    code: activity.code,
    type: activity.type,
    scoreMode: activity.scoreMode,
    calcMode: activity.calcMode,
    description: activity.description || "",
    startTime: activity.startTime ? formatBJ(activity.startTime, "YYYY-MM-DDTHH:mm:ss") : "",
    endTime: activity.endTime ? formatBJ(activity.endTime, "YYYY-MM-DDTHH:mm:ss") : "",
    isPublicVisible: activity.isPublicVisible,
  });
  activityDialog.value = true;
}

function openCloneActivity(activity: Activity) {
  resetActivityForm();
  activityDialogMode.value = "clone";
  cloningSourceActivityId.value = activity.id;
  Object.assign(activityForm, {
    name: `${activity.name}（复制）`,
    code: `${activity.code}-copy`,
    type: activity.type,
    scoreMode: activity.scoreMode,
    calcMode: activity.calcMode,
    description: activity.description || "",
    startTime: activity.startTime ? formatBJ(activity.startTime, "YYYY-MM-DDTHH:mm:ss") : "",
    endTime: activity.endTime ? formatBJ(activity.endTime, "YYYY-MM-DDTHH:mm:ss") : "",
    isPublicVisible: false,
  });
  activityDialog.value = true;
}

function openCreateGroup() {
  resetGroupForm();
  groupDialog.value = true;
}

function openEditGroup(group: Group) {
  editingGroupId.value = group.id;
  Object.assign(groupForm, {
    name: group.name,
    sortOrder: group.sortOrder,
    location: group.location || "",
    scheduleTime: group.scheduleTime ? formatBJ(group.scheduleTime, "YYYY-MM-DDTHH:mm:ss") : "",
    note: group.note || "",
    isLocked: group.isLocked || false,
    startTime: group.startTime ? formatBJ(group.startTime, "YYYY-MM-DDTHH:mm:ss") : "",
    endTime: group.endTime ? formatBJ(group.endTime, "YYYY-MM-DDTHH:mm:ss") : "",
    qrcodeUrl: group.qrcodeUrl || "",
  });
  groupDialog.value = true;
}

function openCreateStudent() {
  resetStudentForm();
  studentDialog.value = true;
}

function openEditStudent(student: Student) {
  editingStudentId.value = student.id;
  Object.assign(studentForm, {
    groupId: student.groupId,
    studentNo: student.studentNo,
    name: student.name,
    gender: student.gender || "",
    className: student.className || "",
    orderNo: student.orderNo,
    customRoleId: student.customRoleId || "",
  });
  studentDialog.value = true;
}

function openCreateJudge() {
  resetJudgeForm();
  judgeDialog.value = true;
}

function openCreateLog() {
  resetLogForm();
  logDialog.value = true;
}

function openEditJudge(judge: any) {
  editingJudgeId.value = judge.id;
  Object.assign(judgeForm, {
    username: judge.user.username,
    realName: judge.user.realName,
    password: "123456",
    role: judge.role,
    groupId: judge.groupId || "",
    customRoleId: judge.customRoleId || "",
  });
  judgeDialog.value = true;
}

function openEditLog(log: any) {
  editingLogId.value = log.id;
  Object.assign(logForm, {
    operatorName: log.operatorName || "",
    module: log.module || "",
    action: log.action || "",
    targetType: log.targetType || "",
    targetId: log.targetId || "",
    beforeData: log.beforeData || "",
    afterData: log.afterData || "",
  });
  logDialog.value = true;
}

async function changeCurrentActivity(nextActivityId: string) {
  if (!nextActivityId || nextActivityId === activityId.value) {
    return;
  }
  try {
    await api.post(`/api/admin/activities/${nextActivityId}/activate`);
    selectedActivityId.value = nextActivityId;
    await auth.fetchMe();
    await fetchAll();
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || "切换活动失败，请稍后重试");
  }
}

async function changeDashboardActivity(nextActivityId: string) {
  if (!nextActivityId || nextActivityId === dashboardActivityId.value) {
    return;
  }
  dashboardActivityId.value = nextActivityId;
  localStorage.setItem(ADMIN_DASHBOARD_ACTIVITY_KEY, nextActivityId);
  try {
    await fetchDashboardOnly();
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || "切换仪表盘活动失败，请稍后重试");
  }
}

function syncActivitySelections(list: Activity[]) {
  selectedActivityIds.value = selectedActivityIds.value.filter((id) => list.some((item) => item.id === id));
  selectedActivityId.value = list.find((item) => item.isActive)?.id || auth.currentActivityRole?.activityId || list[0]?.id || "";

  if (!dashboardActivityId.value || !list.some((item) => item.id === dashboardActivityId.value)) {
    dashboardActivityId.value = selectedActivityId.value || list[0]?.id || "";
    if (dashboardActivityId.value) {
      localStorage.setItem(ADMIN_DASHBOARD_ACTIVITY_KEY, dashboardActivityId.value);
    } else {
      localStorage.removeItem(ADMIN_DASHBOARD_ACTIVITY_KEY);
    }
  }
}

async function fetchActivitiesList() {
  const activityRes = await api.get("/api/admin/activities");
  activities.value = activityRes.data;
  syncActivitySelections(activities.value);
}

async function fetchDashboardOnly() {
  const targetId = dashboardActivityId.value || currentActivity.value?.id;
  if (!targetId) {
    dashboard.value = null;
    return;
  }
  const dashboardRes = await api.get(`/api/admin/activities/${targetId}/dashboard`);
  dashboard.value = dashboardRes.data;
}

async function fetchGroupsOnly() {
  const currentId = activityId.value || activities.value[0]?.id;
  if (!currentId) {
    groups.value = [];
    return;
  }

  const response = await api.get(`/api/admin/activities/${currentId}/groups`);
  groups.value = response.data;
  selectedGroupIds.value = selectedGroupIds.value.filter((id) => groups.value.some((item) => item.id === id));
}

async function fetchStudentsOnly() {
  const currentId = activityId.value || activities.value[0]?.id;
  if (!currentId) {
    students.value = [];
    return;
  }

  const response = await api.get(`/api/admin/activities/${currentId}/students`);
  students.value = response.data;
  selectedStudentIds.value = selectedStudentIds.value.filter((id) => students.value.some((item) => item.id === id));
}

async function fetchJudgesOnly() {
  const currentId = activityId.value || activities.value[0]?.id;
  if (!currentId) {
    judges.value = [];
    return;
  }

  const response = await api.get(`/api/admin/activities/${currentId}/users`);
  judges.value = response.data;
  selectedJudgeIds.value = selectedJudgeIds.value.filter((id) => judges.value.some((item) => item.id === id));
}

async function fetchTemplatesOnly() {
  const currentId = activityId.value || activities.value[0]?.id;
  if (!currentId) {
    templates.value = [];
    return;
  }

  const response = await api.get(`/api/admin/activities/${currentId}/templates`);
  templates.value = response.data;
  syncActivitySettings();
}

async function fetchResultsOnly() {
  const currentId = activityId.value || activities.value[0]?.id;
  if (!currentId) {
    results.value = [];
    return;
  }

  const response = await api.get(`/api/admin/activities/${currentId}/results`);
  results.value = response.data;
}

async function fetchLogsOnly() {
  const response = await api.get("/api/admin/logs");
  logs.value = response.data;
  selectedLogIds.value = selectedLogIds.value.filter((id) => logs.value.some((item) => item.id === id));
}

async function fetchCustomRolesOnly() {
  const currentId = activityId.value || activities.value[0]?.id;
  if (!currentId) {
    customRoles.value = [];
    return;
  }

  const response = await api.get(`/api/admin/activities/${currentId}/custom-roles`);
  customRoles.value = response.data;
  selectedCustomRoleIds.value = selectedCustomRoleIds.value.filter((id) => customRoles.value.some((item) => item.id === id));
}

async function fetchAll() {
  loading.value = true;
  try {
    await fetchActivitiesList();
    const currentId = selectedActivityId.value || activities.value[0]?.id;
    if (!currentId) {
      return;
    }

    await Promise.all([
      fetchDashboardOnly(),
      fetchGroupsOnly(),
      fetchStudentsOnly(),
      fetchJudgesOnly(),
      fetchTemplatesOnly(),
      fetchResultsOnly(),
      fetchLogsOnly(),
      fetchCustomRolesOnly(),
    ]);
  } finally {
    loading.value = false;
  }
}

async function createActivity() {
  if (!activityForm.name.trim()) {
    ElMessage.warning("请填写活动名称");
    return;
  }
  if (!activityForm.code.trim()) {
    ElMessage.warning("请填写活动编码");
    return;
  }
  const isEditing = activityDialogMode.value === "edit";
  const isCloning = activityDialogMode.value === "clone";
  const payload = {
    ...activityForm,
    startTime: activityForm.startTime || null,
    endTime: activityForm.endTime || null,
  };
  try {
    const request = isEditing
      ? api.put(`/api/admin/activities/${editingActivityId.value}`, payload)
      : isCloning
        ? api.post(`/api/admin/activities/${cloningSourceActivityId.value}/clone`, payload)
        : api.post("/api/admin/activities", payload);
    const response = await request;
    if (!isEditing && response?.data?.id) {
      selectedActivityId.value = response.data.id;
    }
    activityDialog.value = false;
    resetActivityForm();
    ElMessage.success(isEditing ? "活动已更新" : isCloning ? "活动已复制" : "活动已创建");
    await fetchAll();
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || "操作失败，请检查活动编码是否重复");
  }
}

function handleQrcodeUpload(uploadFile: any) {
  const file = uploadFile.raw || uploadFile;
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    ElMessage.warning("图片大小不能超过 2MB");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    groupForm.qrcodeUrl = reader.result as string;
  };
  reader.readAsDataURL(file);
}

function downloadQrcode(url: string, name: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}-二维码.png`;
  link.click();
}

function handleSaveGroup() {
  void withDialogSubmit(saveGroup);
}

async function saveGroup() {
  if (!activityId.value) return;
  if (currentActivityLocked.value) {
    ElMessage.warning("当前活动已锁定，只读");
    return;
  }
  if (editingGroupId.value) {
    await api.put(`/api/admin/groups/${editingGroupId.value}`, groupForm);
    ElMessage.success("分组已更新");
  } else {
    await api.post(`/api/admin/activities/${activityId.value}/groups`, groupForm);
    ElMessage.success("分组已创建");
  }
  groupDialog.value = false;
  resetGroupForm();
  await fetchAll();
}

function handleSaveStudent() {
  void withDialogSubmit(saveStudent);
}

async function saveStudent() {
  if (!activityId.value) return;
  if (currentActivityLocked.value) {
    ElMessage.warning("当前活动已锁定，只读");
    return;
  }
  if (editingStudentId.value) {
    await api.put(`/api/admin/students/${editingStudentId.value}`, studentForm);
    ElMessage.success("学生已更新");
  } else {
    await api.post(`/api/admin/activities/${activityId.value}/students`, studentForm);
    ElMessage.success("学生已创建");
  }
  studentDialog.value = false;
  resetStudentForm();
  await fetchAll();
}

function handleSaveJudge() {
  void withDialogSubmit(saveJudge);
}

async function saveJudge() {
  if (!activityId.value) return;
  if (currentActivityLocked.value) {
    ElMessage.warning("当前活动已锁定，只读");
    return;
  }
  if (editingJudgeId.value) {
    await api.put(`/api/admin/activity-user-roles/${editingJudgeId.value}`, {
      username: judgeForm.username,
      realName: judgeForm.realName,
      role: judgeForm.role,
      groupId: judgeForm.groupId || null,
      customRoleId: judgeForm.customRoleId || null,
    });
    ElMessage.success("评委已更新");
  } else {
    await api.post("/api/admin/activity-user-roles", {
      activityId: activityId.value,
      username: judgeForm.username,
      realName: judgeForm.realName,
      password: judgeForm.password,
      role: judgeForm.role,
      groupId: judgeForm.groupId || null,
      customRoleId: judgeForm.customRoleId || null,
    });
    ElMessage.success("评委已创建");
  }
  judgeDialog.value = false;
  resetJudgeForm();
  await fetchAll();
}

async function saveLog() {
  const payload = {
    operatorName: logForm.operatorName,
    module: logForm.module,
    action: logForm.action,
    targetType: logForm.targetType,
    targetId: logForm.targetId || null,
    beforeData: logForm.beforeData || null,
    afterData: logForm.afterData || null,
  };
  if (editingLogId.value) {
    await api.put(`/api/admin/logs/${editingLogId.value}`, payload);
    ElMessage.success("日志已更新");
  } else {
    await api.post("/api/admin/logs", payload);
    ElMessage.success("日志已创建");
  }
  logDialog.value = false;
  resetLogForm();
  await fetchAll();
}

function handleSaveCustomRole() {
  void withDialogSubmit(saveCustomRole);
}

async function saveCustomRole() {
  if (!activityId.value) return;
  if (currentActivityLocked.value) {
    ElMessage.warning("当前活动已锁定，只读");
    return;
  }
  if (editingCustomRoleId.value) {
    await api.put(`/api/admin/custom-roles/${editingCustomRoleId.value}`, customRoleForm);
    ElMessage.success("角色已更新");
  } else {
    await api.post(`/api/admin/activities/${activityId.value}/custom-roles`, customRoleForm);
    ElMessage.success("角色已创建");
  }
  customRoleDialog.value = false;
  resetCustomRoleForm();
  await fetchAll();
}

async function deleteCustomRole(role: ActivityCustomRole) {
  try {
    await ElMessageBox.confirm(`确定删除角色"${role.name}"吗？关联的评委和学生将取消该角色。`, "删除角色", {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  await api.delete(`/api/admin/custom-roles/${role.id}`);
  ElMessage.success("角色已删除");
  await fetchAll();
}

async function batchDeleteCustomRoles() {
  if (!selectedCustomRoles.value.length) return;
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${selectedCustomRoles.value.length} 个角色吗？`, "批量删除", {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  await api.post(`/api/admin/activities/${activityId.value}/custom-roles/batch-delete`, {
    ids: selectedCustomRoleIds.value,
  });
  selectedCustomRoleIds.value = [];
  ElMessage.success("批量删除成功");
  await fetchAll();
}

async function saveActivitySettings() {
  if (!activityId.value) return;
  if (currentActivityLocked.value) {
    ElMessage.warning("当前活动已锁定，只读");
    return;
  }
  await api.put(`/api/admin/activities/${activityId.value}`, {
    activeTemplateId: activitySettingsForm.activeTemplateId || null,
    avgDecimalPlaces: activitySettingsForm.avgDecimalPlaces,
  });
  ElMessage.success("活动评分配置已更新");
  await fetchAll();
}

async function setActiveTemplate(templateId: string) {
  activitySettingsForm.activeTemplateId = templateId;
  await saveActivitySettings();
}

function handleSaveTemplate() {
  void withDialogSubmit(saveTemplate);
}

async function saveTemplate() {
  if (currentActivityLocked.value) {
    ElMessage.warning("当前活动已锁定，只读");
    return;
  }
  const payload = {
    ...templateForm,
    items: templateForm.scoreMode === "TOTAL" ? [] : templateForm.items,
  };
  if (editingTemplateId.value) {
    await api.put(`/api/admin/templates/${editingTemplateId.value}`, payload);
    ElMessage.success("评分模板已更新");
  } else {
    await api.post(`/api/admin/activities/${activityId.value}/templates`, payload);
    ElMessage.success("评分模板已保存");
  }
  resetTemplateForm();
  await fetchAll();
}

function addTemplateItem() {
  templateForm.items.push({
    name: `评分项 ${templateForm.items.length + 1}`,
    maxScore: 10,
    sortOrder: templateForm.items.length + 1,
    isRequired: true,
    description: "",
  });
  normalizeTemplateItems();
}

function removeTemplateItem(index: number) {
  templateForm.items.splice(index, 1);
  normalizeTemplateItems();
}

async function deleteTemplate(template: ScoreTemplate) {
  try {
    await ElMessageBox.confirm(`确定删除模板“${template.name}”吗？`, "删除模板", {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }

  await api.delete(`/api/admin/templates/${template.id}`);
  if (editingTemplateId.value === template.id) {
    resetTemplateForm();
  }
  ElMessage.success("模板已删除");
  await fetchAll();
}

async function toggleActivityLock(activity: Activity) {
  try {
    await api.put(`/api/admin/activities/${activity.id}`, { isLocked: !activity.isLocked });
    await fetchAll();
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || "活动状态更新失败");
  }
}

async function toggleGroupLock(group: Group) {
  try {
    await api.put(`/api/admin/groups/${group.id}`, { isLocked: !group.isLocked });
    await fetchAll();
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || "分组状态更新失败");
  }
}

function toggleActivitySelection(activityIdValue: string, checked: boolean) {
  if (checked) {
    selectedActivityIds.value = Array.from(new Set([...selectedActivityIds.value, activityIdValue]));
    return;
  }
  selectedActivityIds.value = selectedActivityIds.value.filter((id) => id !== activityIdValue);
}

function toggleAllActivities(checked: boolean) {
  selectedActivityIds.value = checked ? activities.value.map((item) => item.id) : [];
}

async function deleteActivity(activity: Activity) {
  try {
    await ElMessageBox.confirm(`确定删除活动“${activity.name}”吗？这会清空该活动的分组、学生、评委绑定、评分、模板、公告附件等全部相关数据。`, "删除活动", {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }

  try {
    await api.delete(`/api/admin/activities/${activity.id}`);
    ElMessage.success("活动已删除");
    await fetchAll();
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || "活动删除失败");
  }
}

async function batchToggleActivities(locked: boolean) {
  if (!selectedActivityRows.value.length) {
    ElMessage.warning("请先选择活动");
    return;
  }

  const targets = selectedActivityRows.value.filter((item) => item.isLocked !== locked);
  if (!targets.length) {
    ElMessage.info(locked ? "所选活动已全部锁定" : "所选活动已全部解锁");
    return;
  }

  await Promise.all(targets.map((item) => api.put(`/api/admin/activities/${item.id}`, { isLocked: locked })));
  ElMessage.success(locked ? "批量锁定完成" : "批量解锁完成");
  await fetchAll();
}

async function batchDeleteActivities() {
  if (!selectedActivityRows.value.length) {
    ElMessage.warning("请先选择活动");
    return;
  }

  try {
    await ElMessageBox.confirm(`确定删除已选择的 ${selectedActivityRows.value.length} 个活动吗？这会清空这些活动的分组、学生、评委绑定、评分、模板、公告附件等全部相关数据。`, "批量删除活动", {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }

  try {
    await Promise.all(selectedActivityRows.value.map((item) => api.delete(`/api/admin/activities/${item.id}`)));
    ElMessage.success("批量删除完成");
    selectedActivityIds.value = [];
    await fetchAll();
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || "批量删除失败，请确认所选活动均为未锁定状态");
  }
}

function toggleSelection(listRef: typeof selectedGroupIds | typeof selectedStudentIds | typeof selectedJudgeIds, id: string, checked: boolean) {
  if (checked) {
    listRef.value = Array.from(new Set([...listRef.value, id]));
    return;
  }
  listRef.value = listRef.value.filter((item) => item !== id);
}

function toggleAllSelection(
  listRef: typeof selectedGroupIds | typeof selectedStudentIds | typeof selectedJudgeIds,
  sourceIds: string[],
  checked: boolean,
) {
  listRef.value = checked ? [...sourceIds] : [];
}

function toggleAllGroups(checked: boolean) {
  toggleAllSelection(selectedGroupIds, groups.value.map((item) => item.id), checked);
}

function toggleAllStudents(checked: boolean) {
  toggleAllSelection(selectedStudentIds, students.value.map((item) => item.id), checked);
}

function toggleAllJudges(checked: boolean) {
  toggleAllSelection(selectedJudgeIds, judges.value.map((item: any) => item.id), checked);
}

function toggleAllLogs(checked: boolean) {
  toggleAllSelection(selectedLogIds, logs.value.map((item: any) => item.id), checked);
}

function toggleGroup(groupId: string, checked: boolean) {
  toggleSelection(selectedGroupIds, groupId, checked);
}

function toggleStudent(studentId: string, checked: boolean) {
  toggleSelection(selectedStudentIds, studentId, checked);
}

function toggleJudge(judgeId: string, checked: boolean) {
  toggleSelection(selectedJudgeIds, judgeId, checked);
}

function toggleLog(logId: string, checked: boolean) {
  toggleSelection(selectedLogIds, logId, checked);
}

async function deleteGroup(group: Group) {
  try {
    await ElMessageBox.confirm(`确定删除分组“${group.name}”吗？该分组下学生和评分也会一起删除。`, "删除分组", {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  await api.delete(`/api/admin/groups/${group.id}`);
  ElMessage.success("分组已删除");
  await fetchAll();
}

async function batchDeleteGroups() {
  if (!selectedGroups.value.length) {
    ElMessage.warning("请先选择分组");
    return;
  }
  try {
    await ElMessageBox.confirm(`确定删除已选择的 ${selectedGroups.value.length} 个分组吗？`, "批量删除分组", {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  await Promise.all(selectedGroups.value.map((item) => api.delete(`/api/admin/groups/${item.id}`)));
  selectedGroupIds.value = [];
  ElMessage.success("批量删除完成");
  await fetchAll();
}

async function batchToggleGroups(lock: boolean) {
  if (!selectedGroups.value.length) return;
  await Promise.all(selectedGroups.value.map((item) => api.put(`/api/admin/groups/${item.id}`, { isLocked: lock })));
  ElMessage.success(lock ? "已批量锁定" : "已批量解锁");
  await fetchAll();
}

const groupJudgeTarget = computed(() => groups.value.find((g) => g.id === groupJudgeTargetId.value) || null);
const groupJudgeExistingUserIds = computed(() => new Set((groupJudgeTarget.value?.activityRoles || []).map((r) => r.userId)));
const filteredSystemUsers = computed(() => {
  return systemUsers.value.filter(
    (u) =>
      !groupJudgeExistingUserIds.value.has(u.id) &&
      matchesSearchKeyword([u.username, u.realName], groupJudgeSearch.value),
  );
});

async function openGroupJudgeDialog(group: Group) {
  groupJudgeTargetId.value = group.id;
  groupJudgeSearch.value = "";
  try {
    const { data } = await api.get("/api/admin/users");
    systemUsers.value = data;
  } catch {
    ElMessage.error("获取用户列表失败");
    return;
  }
  groupJudgeDialog.value = true;
}

async function assignUserToGroup(userId: string) {
  if (!activityId.value || !groupJudgeTargetId.value) return;
  try {
    await api.post("/api/admin/activity-user-roles", {
      activityId: activityId.value,
      userId,
      role: "JUDGE",
      groupId: groupJudgeTargetId.value,
    });
    ElMessage.success("评委已分配到分组");
    await fetchAll();
    // refresh systemUsers to reflect new binding
    const target = groups.value.find((g) => g.id === groupJudgeTargetId.value);
    if (target) groupJudgeTargetId.value = target.id;
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || "分配评委失败");
  }
}

async function removeJudgeFromGroup(roleId: string) {
  try {
    await ElMessageBox.confirm("确定将该评委从此分组移除吗？其相关评分数据也将被删除。", "移除评委", {
      type: "warning",
      confirmButtonText: "移除",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  try {
    await api.delete(`/api/admin/activity-user-roles/${roleId}`);
    ElMessage.success("评委已移除");
    await fetchAll();
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || "移除评委失败");
  }
}

async function deleteStudent(student: Student) {
  try {
    await ElMessageBox.confirm(`确定删除学生“${student.name}”吗？`, "删除学生", {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  await api.delete(`/api/admin/students/${student.id}`);
  ElMessage.success("学生已删除");
  await fetchAll();
}

async function batchDeleteStudents() {
  if (!selectedStudents.value.length) {
    ElMessage.warning("请先选择学生");
    return;
  }
  try {
    await ElMessageBox.confirm(`确定删除已选择的 ${selectedStudents.value.length} 名学生吗？`, "批量删除学生", {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  await Promise.all(selectedStudents.value.map((item) => api.delete(`/api/admin/students/${item.id}`)));
  selectedStudentIds.value = [];
  ElMessage.success("批量删除完成");
  await fetchAll();
}

async function deleteJudge(judge: any) {
  try {
    await ElMessageBox.confirm(`确定移除评委“${judge.user.realName}”吗？`, "删除评委", {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  await api.delete(`/api/admin/activity-user-roles/${judge.id}`);
  ElMessage.success("评委已移除");
  await fetchAll();
}

async function batchDeleteJudges() {
  if (!selectedJudges.value.length) {
    ElMessage.warning("请先选择评委");
    return;
  }
  try {
    await ElMessageBox.confirm(`确定移除已选择的 ${selectedJudges.value.length} 名评委吗？`, "批量删除评委", {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  await Promise.all(selectedJudges.value.map((item: any) => api.delete(`/api/admin/activity-user-roles/${item.id}`)));
  selectedJudgeIds.value = [];
  ElMessage.success("批量删除完成");
  await fetchAll();
}

async function batchResetJudgePassword() {
  if (!selectedJudges.value.length) {
    ElMessage.warning("请先选择评委");
    return;
  }
  await Promise.all(selectedJudges.value.map((item: any) => api.post(`/api/admin/users/${item.user.id}/reset-password`)));
  ElMessage.success("已批量重置为 123456");
}

async function deleteLog(log: any) {
  try {
    await ElMessageBox.confirm(`确定删除日志“${log.module} / ${log.action}”吗？`, "删除日志", {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  await api.delete(`/api/admin/logs/${log.id}`);
  ElMessage.success("日志已删除");
  await fetchAll();
}

async function batchDeleteLogs() {
  if (!selectedLogs.value.length) {
    ElMessage.warning("请先选择日志");
    return;
  }
  try {
    await ElMessageBox.confirm(`确定删除已选择的 ${selectedLogs.value.length} 条日志吗？`, "批量删除日志", {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  await Promise.all(selectedLogs.value.map((item: any) => api.delete(`/api/admin/logs/${item.id}`)));
  selectedLogIds.value = [];
  ElMessage.success("批量删除完成");
  await fetchAll();
}

function eventTouchesManagedActivity(activityIdFromEvent?: string) {
  const currentId = activityId.value || activities.value[0]?.id || "";
  const dashboardId = dashboardActivityId.value || currentId;
  return !activityIdFromEvent || activityIdFromEvent === currentId || activityIdFromEvent === dashboardId;
}

watch(
  () => sync.version,
  async () => {
    const event = sync.latestEvent;
    if (!auth.user || !event || event.type === "online.snapshot") {
      return;
    }

    const eventActivityId = event.payload?.activityId as string | undefined;
    if (!eventTouchesManagedActivity(eventActivityId)) {
      return;
    }

    try {
      if (event.type === "activity.updated") {
        await Promise.all([
          fetchActivitiesList(),
          fetchDashboardOnly(),
        ]);
        await Promise.all([
          fetchTemplatesOnly(),
          fetchResultsOnly(),
        ]);
        return;
      }

      if (event.type === "group.updated") {
        await Promise.all([
          fetchGroupsOnly(),
          fetchDashboardOnly(),
        ]);
        return;
      }

      if (event.type === "student.updated") {
        await Promise.all([
          fetchStudentsOnly(),
          fetchResultsOnly(),
          fetchDashboardOnly(),
        ]);
        return;
      }

      if (event.type === "judge.updated") {
        await Promise.all([
          fetchJudgesOnly(),
          fetchStudentsOnly(),
          fetchResultsOnly(),
          fetchDashboardOnly(),
        ]);
        return;
      }

      if (event.type === "template.updated") {
        await Promise.all([
          fetchActivitiesList(),
          fetchTemplatesOnly(),
          fetchResultsOnly(),
        ]);
        return;
      }

      if (event.type === "score.updated") {
        await Promise.all([
          fetchStudentsOnly(),
          fetchResultsOnly(),
          fetchDashboardOnly(),
        ]);
        return;
      }

      if (event.type === "customRole.updated") {
        await Promise.all([
          fetchCustomRolesOnly(),
          fetchStudentsOnly(),
          fetchJudgesOnly(),
        ]);
      }
    } catch {
      // silent — background sync refresh, don't interrupt user
    }
  },
);

watch(
  activities,
  (list) => {
    if (!route.params.section) {
      router.replace("/admin/dashboard");
    }
    if (!activityId.value && list[0]) {
      auth.fetchMe();
    }
  },
  { deep: true },
);

watch(
  () => section.value,
  () => {
    if (!selectedActivityId.value && activities.value[0]?.id) {
      selectedActivityId.value = activities.value[0].id;
    }
  },
);

onMounted(() => {
  syncResponsiveState();
  syncResultsBackTopVisibility();
  window.addEventListener("resize", syncResponsiveState);
  window.addEventListener("scroll", syncResultsBackTopVisibility);
  fetchAll();
});

onUnmounted(() => {
  if (typeof window !== "undefined") {
    window.removeEventListener("resize", syncResponsiveState);
    window.removeEventListener("scroll", syncResultsBackTopVisibility);
  }
});
</script>

<template>
  <AppShell
    mode="admin"
    title="统一评分管理台"
    subtitle="紧凑布局、底部 Dock 导航、实时同步数据、统一毛玻璃风格"
  >
    <template #extra>
      <el-button class="topbar-action-button topbar-password-button" plain @click="openPasswordDialog">
        <el-icon><Lock /></el-icon> 
      </el-button>
    </template>
      <el-dialog v-model="passwordDialog" title="修改密码" width="350px" :close-on-click-modal="false">
        <el-form @submit.prevent="submitPasswordChange">
          <el-form-item label="旧密码">
            <el-input v-model="passwordForm.oldPassword" type="password" autocomplete="current-password" />
          </el-form-item>
          <el-form-item label="新密码">
            <el-input v-model="passwordForm.newPassword" type="password" autocomplete="new-password" />
          </el-form-item>
          <el-form-item label="确认新密码">
            <el-input v-model="passwordForm.confirmPassword" type="password" autocomplete="new-password" />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="passwordDialog = false">取消</el-button>
          <el-button type="primary" :loading="passwordLoading" @click="submitPasswordChange">保存</el-button>
        </template>
      </el-dialog>
    <section v-if="currentActivityLocked" class="readonly-banner admin-lock-banner">
      <el-icon><Lock /></el-icon>
      <span>当前激活活动已锁定，只读，导入、编辑和模板保存已禁用</span>
    </section>

    <template v-if="section === 'dashboard'">
      <div class="admin-dashboard-shell">
      <section class="admin-top-grid">
        <section class="glass-panel entity-card admin-activity-hero">
          <div class="admin-hero-main">
            <div class="admin-hero-title-row">
              <div class="admin-hero-icon">
                <el-icon><Histogram /></el-icon>
              </div>
              <div>
                <div class="admin-hero-eyebrow">首页展示活动</div>
                <div class="admin-hero-name">{{ dashboardActivity?.name || "暂无活动" }}</div>
              </div>
            </div>
            <div class="admin-hero-desc">{{ dashboardActivity?.description || "选择一个活动后查看首页概览数据" }}</div>
            <el-select
              v-if="activities.length"
              :model-value="dashboardActivityId"
              class="admin-activity-switcher"
              placeholder="选择首页展示活动"
              @change="changeDashboardActivity"
            >
              <el-option
                v-for="activity in activities"
                :key="activity.id"
                :label="activity.name"
                :value="activity.id"
              />
            </el-select>
          </div>
        </section>

        <div class="admin-top-side">
          <section class="stats-row admin-dashboard-stats">
            <div class="glass-panel stat-card">
              <div class="muted">活动数</div>
              <div class="stat-value">{{ activities.length }}</div>
            </div>
            <div class="glass-panel stat-card">
              <div class="muted">学生数</div>
              <div class="stat-value">{{ dashboard?.studentCount || 0 }}</div>
            </div>
            <div class="glass-panel stat-card">
              <div class="muted">评委数</div>
              <div class="stat-value">{{ dashboard?.judgeCount || 0 }}</div>
            </div>
            <div class="glass-panel stat-card">
              <div class="muted">已完成</div>
              <div class="stat-value">{{ dashboard?.completedStudentCount || 0 }}</div>
            </div>
          </section>

          <section class="glass-panel entity-card admin-online-card">
            <div class="admin-online-title">
              <div class="admin-online-icon">
                <el-icon><Connection /></el-icon>
              </div>
              <div>
                <div style="font-weight: 700">实时在线用户</div>
                <div class="muted" style="font-size: 12px">
                  {{ currentActivity?.name ? `${currentActivity.name} 在线连接` : "当前系统在线连接" }}
                </div>
              </div>
            </div>
            <div class="admin-online-total">
              <el-icon><UserFilled /></el-icon>
              <span>{{ activeActivityOnlineUsers.length }}</span>
            </div>
            <div v-if="activeActivityOnlineRoleStats.length" class="admin-online-meta">
              <span v-for="item in activeActivityOnlineRoleStats" :key="item.key" class="admin-online-role-stat">
                {{ item.label }} {{ item.count }}
              </span>
            </div>
            <template v-if="activeActivityOnlineUsers.length">
              <div class="admin-online-name-flow">
                <div v-for="user in activeActivityOnlineUsers" :key="user.id" class="admin-online-name-item">
                  <el-popover
                    placement="bottom-start"
                    trigger="click"
                    :width="220"
                    popper-class="admin-online-popover"
                    :show-arrow="true"
                  >
                    <template #reference>
                      <button type="button" class="admin-online-name-card" :style="getOnlineUserCardStyle(user)">
                        {{ user.realName || user.username }}
                      </button>
                    </template>
                    <div class="admin-online-popover-body">
                      <div class="admin-online-popover-name">{{ user.realName || user.username }}</div>
                      <div class="admin-online-popover-role">{{ resolveOnlineRoleLabel(user) }}</div>
                      <div class="admin-online-popover-list">
                        <div class="admin-online-popover-item">
                          <span>账号</span>
                          <strong>{{ user.username }}</strong>
                        </div>
                        <div class="admin-online-popover-item">
                          <span>活动</span>
                          <strong>{{ user.activityName || currentActivity?.name || "未绑定活动" }}</strong>
                        </div>
                        <div class="admin-online-popover-item">
                          <span>分组</span>
                          <strong>{{ user.groupName || "未分组" }}</strong>
                        </div>
                      </div>
                    </div>
                  </el-popover>
                </div>
              </div>
            </template>
            <el-empty v-else description="当前激活活动暂无在线用户" :image-size="60" />
          </section>
        </div>
      </section>

      <div class="admin-dashboard-stack">

      <section class="glass-panel admin-dashboard-block" style="padding: 12px">
        <div class="panel-header">
          <h3 style="margin: 0">分组完成率</h3>
          <el-tag round type="success">WebSocket 实时刷新</el-tag>
        </div>
        <div class="card-list">
          <div v-for="item in dashboard?.groupStats || []" :key="item.groupId" class="entity-card glass-panel">
            <div class="panel-header">
              <strong>{{ item.groupName }}</strong>
              <span class="muted">{{ item.completedCount }}/{{ item.studentCount }} 完成</span>
            </div>
            <el-progress :percentage="Math.round(item.progress * 100)" :stroke-width="10" :show-text="true" />
          </div>
        </div>
      </section>
      </div>
      </div>
    </template>

    <template v-else-if="section === 'activities'">
      <section class="glass-panel admin-activity-page">
        <div class="admin-activity-header">
          <div>
            <h3 style="margin: 0">活动管理</h3>
            <div class="muted">切换当前活动、编辑配置、批量锁定或删除活动。</div>
          </div>
          <div class="toolbar admin-page-primary-actions">
            <el-button type="primary" :icon="Plus" @click="openCreateActivity">新建活动</el-button>
          </div>
        </div>

        <div class="admin-activity-toolbar">
          <label class="admin-activity-select-all">
            <el-checkbox :model-value="allActivitiesSelected" @change="toggleAllActivities" />
            <span>已选 {{ selectedActivityRows.length }} 项</span>
          </label>
          <div class="admin-activity-toolbar-actions">
            <el-button :icon="RefreshRight" @click="fetchAll">刷新</el-button>
            <el-button plain :icon="EditPen" :disabled="selectedActivityRows.length !== 1 || selectedActivityRows[0]?.isLocked" @click="selectedActivityRows[0] && openEditActivity(selectedActivityRows[0])">编辑</el-button>
            <el-button plain :icon="Lock" :disabled="!selectedActivityRows.length" @click="batchToggleActivities(true)">批量锁定</el-button>
            <el-button plain :disabled="!selectedActivityRows.length" @click="batchToggleActivities(false)">批量解锁</el-button>
            <el-button plain type="danger" :icon="Delete" :disabled="!selectedActivityRows.length" @click="batchDeleteActivities">批量删除</el-button>
          </div>
        </div>

        <div class="admin-activity-list">
          <div v-for="activity in activities" :key="activity.id" class="glass-panel entity-card admin-activity-row">
            <div class="admin-activity-row-main">
              <label class="admin-activity-row-check">
                <el-checkbox
                  :model-value="selectedActivityIds.includes(activity.id)"
                  @change="(checked:boolean) => toggleActivitySelection(activity.id, checked)"
                />
              </label>
              <div class="admin-activity-row-content">
                <div class="admin-activity-row-top">
                  <div class="admin-activity-row-title">
                    <strong>{{ activity.name }}</strong>
                    <div class="tag-row">
                      <el-tag v-if="activity.isActive" type="primary">当前活动</el-tag>
                      <el-tag :type="activity.isLocked ? 'danger' : 'success'">{{ activity.isLocked ? "已锁定" : "开放中" }}</el-tag>
                      <el-tag :type="activity.isPublicVisible ? 'success' : 'info'">{{ activity.isPublicVisible ? "公共页可见" : "公共页隐藏" }}</el-tag>
                      <el-tag>{{ activity.type }}</el-tag>
                    </div>
                  </div>
                  <div class="admin-activity-row-actions">
                    <el-button size="small" plain :disabled="activity.isActive" @click="changeCurrentActivity(activity.id)">切换当前</el-button>
                    <el-button size="small" plain :icon="EditPen" :disabled="activity.isLocked" @click="openEditActivity(activity)">编辑</el-button>
                    <el-button size="small" plain @click="openCloneActivity(activity)">复制</el-button>
                    <el-button size="small" plain @click="openAnnouncementEditor(activity)">公告</el-button>
                    <el-button size="small" @click="toggleActivityLock(activity)">{{ activity.isLocked ? "解锁" : "锁定" }}</el-button>
                    <el-button size="small" plain type="danger" :icon="Delete" :disabled="activity.isLocked" @click="deleteActivity(activity)">删除</el-button>
                  </div>
                </div>
                <div class="admin-activity-row-meta">
                  <span>编码：{{ activity.code }}</span>
                  <span>模板：{{ activity.templates?.find((item:any) => item.id === activity.activeTemplateId)?.name || "未设置" }}</span>
                  <span>分组 {{ (activity as any).groupCount ?? activity.groups?.length ?? 0 }}</span>
                  <span>学生 {{ (activity as any).studentCount ?? activity.students?.length ?? 0 }}</span>
                  <span>评委 {{ (activity as any).judgeCount ?? activity.activityRoles?.length ?? 0 }}</span>
                  <span v-if="activity.startTime || activity.endTime">开放时间 {{ activity.startTime ? formatBJ(activity.startTime) : "不限" }} ~ {{ activity.endTime ? formatBJ(activity.endTime) : "不限" }}</span>
                  <span>创建于 {{ formatBJ(activity.createdAt) }}</span>
                </div>
                <div class="muted admin-activity-row-desc">{{ activity.description || "暂无说明" }}</div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </template>

    <template v-else-if="section === 'groups'">
      <section class="glass-panel admin-manage-page">
        <div class="admin-manage-header">
          <div>
            <h3 style="margin: 0">分组管理</h3>
            <div class="muted">支持分组增删改查、导入和批量删除。</div>
          </div>
          <div class="toolbar admin-page-primary-actions">
            <el-button :icon="Upload" :disabled="currentActivityLocked" @click="groupImportOpen = true">导入分组</el-button>
            <el-button type="primary" :icon="Plus" :disabled="currentActivityLocked" @click="openCreateGroup">新建分组</el-button>
          </div>
        </div>
        <div class="admin-manage-toolbar">
          <label class="admin-activity-select-all">
            <el-checkbox :model-value="allGroupsSelected" @change="toggleAllGroups" />
            <span>已选 {{ selectedGroups.length }} 项</span>
          </label>
          <div class="admin-activity-toolbar-actions">
            <el-button plain :icon="EditPen" :disabled="currentActivityLocked || selectedGroups.length !== 1" @click="selectedGroups[0] && openEditGroup(selectedGroups[0])">编辑</el-button>
            <el-button plain :icon="Lock" :disabled="!selectedGroups.length" @click="batchToggleGroups(true)">批量锁定</el-button>
            <el-button plain :disabled="!selectedGroups.length" @click="batchToggleGroups(false)">批量解锁</el-button>
            <el-button plain type="danger" :icon="Delete" :disabled="currentActivityLocked || !selectedGroups.length" @click="batchDeleteGroups">批量删除</el-button>
          </div>
        </div>
        <div class="admin-activity-list">
          <div v-for="group in groups" :key="group.id" class="glass-panel entity-card admin-activity-row">
            <div class="admin-activity-row-main">
              <label class="admin-activity-row-check">
                <el-checkbox :model-value="selectedGroupIds.includes(group.id)" @change="(checked:boolean) => toggleGroup(group.id, checked)" />
              </label>
              <div class="admin-activity-row-content">
                <div class="admin-activity-row-top">
                  <div class="admin-activity-row-title">
                    <strong>{{ group.name }}</strong>
                    <div class="tag-row">
                      <el-tag :type="group.isLocked ? 'danger' : 'success'">{{ group.isLocked ? "已锁定" : "开放中" }}</el-tag>
                      <el-tag>{{ group.location || "未设地点" }}</el-tag>
                      <el-tag type="success">{{ (group as any).studentCount ?? group.students?.length ?? 0 }} 名学生</el-tag>
                    </div>
                  </div>
                  <div class="admin-activity-row-actions">
                    <el-button size="small" @click="toggleGroupLock(group)">{{ group.isLocked ? "解锁" : "锁定" }}</el-button>
                    <el-button size="small" plain :icon="EditPen" :disabled="currentActivityLocked" @click="openEditGroup(group)">编辑</el-button>
                    <el-button size="small" plain type="danger" :icon="Delete" :disabled="currentActivityLocked" @click="deleteGroup(group)">删除</el-button>
                  </div>
                </div>
                <div class="admin-activity-row-meta">
                  <span>排序 {{ group.sortOrder }}</span>
                  <span>地点 {{ group.location || "未设置" }}</span>
                  <span>答辩时间 {{ group.scheduleTime ? formatBJ(group.scheduleTime) : "未设置" }}</span>
                  <span v-if="group.startTime || group.endTime">开放时间 {{ group.startTime ? formatBJ(group.startTime) : "不限" }} ~ {{ group.endTime ? formatBJ(group.endTime) : "不限" }}</span>
                </div>
                <div class="tag-row" style="margin-top: 4px; flex-wrap: wrap; gap: 4px">
                  <el-tag v-for="role in (group.activityRoles || [])" :key="role.id" closable @close="removeJudgeFromGroup(role.id)">
                    <el-icon style="margin-right: 2px"><UserFilled /></el-icon>{{ role.user.realName }}
                  </el-tag>
                  <el-button size="small" text type="primary" :icon="Plus" :disabled="currentActivityLocked" @click="openGroupJudgeDialog(group)">添加评委</el-button>
                </div>
                <div v-if="group.qrcodeUrl" style="margin-top: 6px">
                  <el-image
                    :src="group.qrcodeUrl"
                    :preview-src-list="[group.qrcodeUrl]"
                    fit="contain"
                    style="width: 80px; height: 80px; border-radius: 4px; border: 1px solid var(--el-border-color-lighter); cursor: pointer"
                  />
                  <div style="display: flex; align-items: center; gap: 6px">
                    <span class="muted" style="font-size: 11px">群二维码</span>
                    <el-button size="small" text type="primary" style="font-size: 11px; padding: 0" @click="downloadQrcode(group.qrcodeUrl!, group.name)">下载</el-button>
                  </div>
                </div>
                <div class="muted admin-activity-row-desc">{{ group.note || "暂无备注" }}</div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </template>

    <template v-else-if="section === 'students'">
      <section class="glass-panel admin-manage-page">
        <div class="admin-manage-header">
          <div>
            <h3 style="margin: 0">学生管理</h3>
            <div class="muted">支持学生增删改查、导入和批量删除。</div>
          </div>
          <div class="toolbar admin-page-primary-actions">
            <el-button :icon="Upload" :disabled="currentActivityLocked" @click="studentImportOpen = true">导入学生</el-button>
            <el-button type="primary" :icon="Plus" :disabled="currentActivityLocked" @click="openCreateStudent">新建学生</el-button>
          </div>
        </div>
        <div class="admin-manage-toolbar">
          <label class="admin-activity-select-all">
            <el-checkbox :model-value="allStudentsSelected" @change="toggleAllStudents" />
            <span>已选 {{ selectedStudents.length }} 项</span>
          </label>
          <div class="admin-activity-toolbar-actions">
            <el-button plain :icon="EditPen" :disabled="currentActivityLocked || selectedStudents.length !== 1" @click="selectedStudents[0] && openEditStudent(selectedStudents[0])">编辑</el-button>
            <el-button plain type="danger" :icon="Delete" :disabled="currentActivityLocked || !selectedStudents.length" @click="batchDeleteStudents">批量删除</el-button>
          </div>
        </div>
        <div class="admin-activity-list">
          <div v-for="student in students" :key="student.id" class="glass-panel entity-card admin-activity-row">
            <div class="admin-activity-row-main">
              <label class="admin-activity-row-check">
                <el-checkbox :model-value="selectedStudentIds.includes(student.id)" @change="(checked:boolean) => toggleStudent(student.id, checked)" />
              </label>
              <div class="admin-activity-row-content">
                <div class="admin-activity-row-top">
                  <div class="admin-activity-row-title">
                    <strong>{{ student.name }}</strong>
                    <div class="tag-row">
                      <el-tag>{{ student.group?.name || "未分组" }}</el-tag>
                      <el-tag>{{ student.studentNo }}</el-tag>
                      <el-tag type="success">均分 {{ student.summary?.finalScore ?? "-" }}</el-tag>
                      <el-tag v-if="student.customRole" :color="student.customRole.color" style="color: #fff; border: none">{{ student.customRole.name }}</el-tag>
                    </div>
                  </div>
                  <div class="admin-activity-row-actions">
                    <el-button size="small" plain :icon="EditPen" :disabled="currentActivityLocked" @click="openEditStudent(student)">编辑</el-button>
                    <el-button size="small" plain type="danger" :icon="Delete" :disabled="currentActivityLocked" @click="deleteStudent(student)">删除</el-button>
                  </div>
                </div>
                <div class="admin-activity-row-meta">
                  <span>班级 {{ student.className || "未设置" }}</span>
                  <span>序号 {{ student.orderNo }}</span>
                  <span>完成度 {{ student.summary?.submittedJudgeCount || 0 }}/{{ student.summary?.requiredJudgeCount || 0 }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </template>

    <template v-else-if="section === 'judges'">
      <section class="glass-panel admin-manage-page">
        <div class="admin-manage-header">
          <div>
            <h3 style="margin: 0">评委管理</h3>
            <div class="muted">支持评委增删改查、导入、批量删除和批量重置密码。</div>
          </div>
          <div class="toolbar admin-page-primary-actions">
            <el-button :icon="Upload" :disabled="currentActivityLocked" @click="judgeImportOpen = true">导入评委</el-button>
            <el-button type="primary" :icon="Plus" :disabled="currentActivityLocked" @click="openCreateJudge">新建评委</el-button>
          </div>
        </div>
        <div class="admin-manage-toolbar">
          <label class="admin-activity-select-all">
            <el-checkbox :model-value="allJudgesSelected" @change="toggleAllJudges" />
            <span>已选 {{ selectedJudges.length }} 项</span>
          </label>
          <div class="admin-activity-toolbar-actions">
            <el-button plain :icon="EditPen" :disabled="currentActivityLocked || selectedJudges.length !== 1" @click="selectedJudges[0] && openEditJudge(selectedJudges[0])">编辑</el-button>
            <el-button plain :disabled="!selectedJudges.length" @click="batchResetJudgePassword">批量重置密码</el-button>
            <el-button plain type="danger" :icon="Delete" :disabled="currentActivityLocked || !selectedJudges.length" @click="batchDeleteJudges">批量删除</el-button>
          </div>
        </div>
        <div class="admin-activity-list">
          <div v-for="judge in judges" :key="judge.id" class="glass-panel entity-card admin-activity-row">
            <div class="admin-activity-row-main">
              <label class="admin-activity-row-check">
                <el-checkbox :model-value="selectedJudgeIds.includes(judge.id)" @change="(checked:boolean) => toggleJudge(judge.id, checked)" />
              </label>
              <div class="admin-activity-row-content">
                <div class="admin-activity-row-top">
                  <div class="admin-activity-row-title">
                    <strong>{{ judge.user.realName }}</strong>
                    <div class="tag-row">
                      <el-tag>{{ judge.user.username }}</el-tag>
                      <el-tag type="success">{{ judge.group?.name || "未分组" }}</el-tag>
                      <el-tag v-if="judge.customRole" :color="judge.customRole.color" style="color: #fff; border: none">{{ judge.customRole.name }}</el-tag>
                    </div>
                  </div>
                  <div class="admin-activity-row-actions">
                    <el-button size="small" plain :icon="EditPen" :disabled="currentActivityLocked" @click="openEditJudge(judge)">编辑</el-button>
                    <el-button size="small" plain @click="api.post(`/api/admin/users/${judge.user.id}/reset-password`).then(() => ElMessage.success('密码已重置为 123456'))">重置密码</el-button>
                    <el-button size="small" plain type="danger" :icon="Delete" :disabled="currentActivityLocked" @click="deleteJudge(judge)">删除</el-button>
                  </div>
                </div>
                <div class="admin-activity-row-meta">
                  <span>账号状态 {{ judge.user.isActive ? "启用" : "停用" }}</span>
                  <span>最近登录 {{ judge.user.lastLoginAt ? formatBJ(judge.user.lastLoginAt) : "暂无" }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </template>

    <template v-else-if="section === 'roles'">
      <section class="glass-panel admin-manage-page">
        <div class="admin-manage-header">
          <div>
            <h3 style="margin: 0">角色管理</h3>
            <div class="muted">管理当前活动的专属角色，定义后可分配给评委和学生。</div>
          </div>
          <div class="toolbar">
            <el-button type="primary" :icon="Plus" :disabled="currentActivityLocked" @click="openCreateCustomRole">新建角色</el-button>
          </div>
        </div>
        <div class="admin-manage-toolbar">
          <label class="admin-activity-select-all">
            <el-checkbox :model-value="allCustomRolesSelected" @change="(val: boolean) => { selectedCustomRoleIds = val ? customRoles.map(r => r.id) : [] }" />
            <span>已选 {{ selectedCustomRoles.length }} 项</span>
          </label>
          <div class="admin-activity-toolbar-actions">
            <el-button plain :icon="EditPen" :disabled="currentActivityLocked || selectedCustomRoles.length !== 1" @click="selectedCustomRoles[0] && openEditCustomRole(selectedCustomRoles[0])">编辑</el-button>
            <el-button plain type="danger" :icon="Delete" :disabled="currentActivityLocked || !selectedCustomRoles.length" @click="batchDeleteCustomRoles">批量删除</el-button>
          </div>
        </div>
        <div class="admin-activity-list">
          <div v-for="role in customRoles" :key="role.id" class="glass-panel entity-card admin-activity-row">
            <div class="admin-activity-row-main">
              <label class="admin-activity-row-check">
                <el-checkbox :model-value="selectedCustomRoleIds.includes(role.id)" @change="(checked: boolean) => { if (checked) selectedCustomRoleIds.push(role.id); else selectedCustomRoleIds = selectedCustomRoleIds.filter(id => id !== role.id) }" />
              </label>
              <div class="admin-activity-row-content">
                <div class="admin-activity-row-top">
                  <div class="admin-activity-row-title">
                    <strong>
                      <el-tag :color="role.color || '#409eff'" style="color: #fff; border: none; margin-right: 8px">{{ role.name }}</el-tag>
                    </strong>
                    <div class="tag-row">
                      <el-tag>排序 {{ role.sortOrder }}</el-tag>
                      <el-tag type="info">评委 {{ (role as any).userRoleCount ?? role.userRoles?.length ?? 0 }}人</el-tag>
                      <el-tag type="info">学生 {{ (role as any).studentCount ?? role.students?.length ?? 0 }}人</el-tag>
                    </div>
                  </div>
                  <div class="admin-activity-row-actions">
                    <el-button size="small" plain :icon="EditPen" :disabled="currentActivityLocked" @click="openEditCustomRole(role)">编辑</el-button>
                    <el-button size="small" plain type="danger" :icon="Delete" :disabled="currentActivityLocked" @click="deleteCustomRole(role)">删除</el-button>
                  </div>
                </div>
                <div class="admin-activity-row-meta">
                  <span>{{ role.description || "暂无职责描述" }}</span>
                </div>
              </div>
            </div>
          </div>
          <div v-if="!customRoles.length" class="empty-tip muted" style="text-align: center; padding: 24px 0">
            暂无自定义角色，点击"新建角色"创建
          </div>
        </div>
      </section>
    </template>

    <template v-else-if="section === 'templates'">
      <section class="glass-panel" style="padding: 12px; margin-bottom: 10px">
        <div class="panel-header">
          <div>
            <h3 style="margin: 0">活动评分配置</h3>
            <div class="muted">选择当前生效模板，并设置平均分保留的小数位数。</div>
          </div>
          <el-button type="primary" :icon="Setting" :disabled="currentActivityLocked || !templates.length" @click="saveActivitySettings">保存配置</el-button>
        </div>
        <el-form label-position="top">
          <div class="compact-grid cols-2">
            <el-form-item label="当前评分模板">
              <el-select v-model="activitySettingsForm.activeTemplateId" :disabled="currentActivityLocked || !templates.length">
                <el-option v-for="template in templates" :key="template.id" :label="template.name" :value="template.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="平均分小数位数">
              <el-input-number v-model="activitySettingsForm.avgDecimalPlaces" :min="0" :max="4" :disabled="currentActivityLocked" style="width: 100%" />
            </el-form-item>
          </div>
        </el-form>
        <div class="tag-row">
          <el-tag round type="primary">当前生效：{{ activeTemplate?.name || "未选择模板" }}</el-tag>
          <el-tag round type="success">保留 {{ activitySettingsForm.avgDecimalPlaces }} 位小数</el-tag>
        </div>
      </section>

      <section class="glass-panel" style="padding: 12px; margin-bottom: 10px">
        <div class="panel-header">
          <div>
            <h3 style="margin: 0">{{ editingTemplateId ? "编辑模板" : "新建模板" }}</h3>
            <div class="muted">支持分项评分与总分评分两种模板模式。</div>
          </div>
          <div class="toolbar">
            <el-button v-if="editingTemplateId" plain @click="resetTemplateForm">取消编辑</el-button>
            <el-button type="primary" :disabled="currentActivityLocked" :loading="dialogSubmitting" @click="handleSaveTemplate">{{ editingTemplateId ? "更新模板" : "保存模板" }}</el-button>
          </div>
        </div>
        <div class="template-editor">
          <el-form label-position="top" class="template-editor-form">
            <div class="template-config-grid">
              <el-form-item label="模板名称" class="template-config-name">
                <el-input v-model="templateForm.name" :disabled="currentActivityLocked" />
              </el-form-item>
              <el-form-item label="评分模式">
                <el-select v-model="templateForm.scoreMode" :disabled="currentActivityLocked">
                  <el-option label="分项评分" value="ITEMIZED" />
                  <el-option label="总分评分" value="TOTAL" />
                </el-select>
              </el-form-item>
              <el-form-item label="总分">
                <el-input-number
                  v-model="templateForm.totalScore"
                  :min="1"
                  :disabled="currentActivityLocked"
                  controls-position="right"
                  style="width: 100%"
                />
              </el-form-item>
            </div>
          </el-form>

          <div v-if="isTotalTemplate" class="glass-panel entity-card template-mode-hint">
            <div class="template-mode-hint-title">总分模式</div>
            <div class="muted">当前模板为总分模式，评委端会即时切换为单个总分输入框。</div>
          </div>

          <div v-else class="template-item-editor-section">
            <div class="glass-panel entity-card template-item-editor-header">
              <div>
                <div class="template-item-editor-title">评分项设置</div>
                <div class="muted">每个评分项包含名称、说明和对应分值，建议名称简洁，说明写评价重点。</div>
              </div>
              <div :class="['template-score-summary', templateItemScoreBalanced ? 'is-balanced' : 'is-warning']">
                <span>分项合计 {{ templateItemScoreTotal }}</span>
                <span>/</span>
                <span>总分 {{ templateForm.totalScore }}</span>
              </div>
            </div>

            <div class="template-item-editor-list">
              <div
                v-for="(item, index) in templateForm.items"
                :key="`${item.sortOrder}-${index}`"
                class="glass-panel entity-card template-item-editor-card"
              >
                <div class="template-item-editor-top">
                  <div class="template-item-index">{{ index + 1 }}</div>
                  <div class="template-item-title-field">
                    <div class="template-item-label">评分项名称</div>
                    <el-input
                      v-model="item.name"
                      :disabled="currentActivityLocked"
                      :placeholder="`评分项 ${index + 1}`"
                    />
                  </div>
                  <el-button
                    class="template-item-delete"
                    text
                    :disabled="currentActivityLocked || templateForm.items.length === 1"
                    @click="removeTemplateItem(index)"
                  >
                    删除
                  </el-button>
                </div>

                <div class="template-item-editor-body">
                  <div class="template-item-description-field">
                    <div class="template-item-label">评分项说明</div>
                    <el-input
                      v-model="item.description"
                      :disabled="currentActivityLocked"
                      type="textarea"
                      :autosize="{ minRows: 2, maxRows: 4 }"
                      placeholder="选填，写清评分重点、观察维度或扣分提醒"
                    />
                  </div>

                  <div class="template-item-score-card">
                    <div class="template-item-score-top">
                      <div class="template-item-label">该项分值</div>
                      <div class="template-item-score-share">占总分 {{ getTemplateItemShare(item.maxScore) }}</div>
                    </div>
                    <el-input-number
                      v-model="item.maxScore"
                      :min="1"
                      :disabled="currentActivityLocked"
                      controls-position="right"
                      style="width: 100%"
                    />
                  </div>
                </div>
              </div>
            </div>

            <el-button class="template-item-add-btn" plain :icon="Plus" :disabled="currentActivityLocked" @click="addTemplateItem">
              新增评分项
            </el-button>
          </div>
        </div>
      </section>

      <section class="card-list">
        <div v-for="template in templates" :key="template.id" class="glass-panel entity-card">
          <div class="panel-header">
            <h4>{{ template.name }}</h4>
            <div class="toolbar">
              <el-button size="small" plain :disabled="currentActivityLocked || currentActivity?.activeTemplateId === template.id" @click="setActiveTemplate(template.id)">设为当前</el-button>
              <el-button size="small" plain :icon="EditPen" :disabled="currentActivityLocked" @click="fillTemplateForm(template)">编辑</el-button>
              <el-button size="small" plain :icon="Delete" :disabled="currentActivityLocked" @click="deleteTemplate(template)">删除</el-button>
            </div>
          </div>
          <div class="tag-row" style="margin-bottom: 8px">
            <el-tag v-if="currentActivity?.activeTemplateId === template.id" round type="danger">当前生效</el-tag>
            <el-tag v-if="template.isDefault" round>默认模板</el-tag>
            <el-tag round>{{ template.scoreMode === "TOTAL" ? "总分模式" : "分项模式" }}</el-tag>
            <el-tag round type="success">{{ template.totalScore }} 分</el-tag>
          </div>
          <div v-if="template.scoreMode === 'TOTAL'" class="muted">
            此模板仅填写总分和备注，适合导师评分、快速评分等场景。
          </div>
          <div v-else class="tag-row">
            <el-tag v-for="item in template.items" :key="item.id" round :title="item.description">{{ item.name }} {{ item.maxScore }}</el-tag>
          </div>
        </div>
      </section>
    </template>

    <template v-else-if="section === 'results'">
      <section class="glass-panel admin-results-panel">
        <div class="results-toolbar-head">
          <div class="results-toolbar-title">
            <h3 style="margin: 0">结果汇总</h3>
            <div class="results-toolbar-count">
              <span>共 {{ results.length }} 条</span>
              <span>当前 {{ filteredResults.length }} 条</span>
              <span class="results-toolbar-hint">支持姓名、分组的首字母和全拼搜索</span>
            </div>
          </div>
          <el-button type="primary" @click="downloadFile(`/api/admin/activities/${activityId}/export/results`, 'results.xlsx')">导出 Excel</el-button>
        </div>
        <div class="results-toolbar">
          <el-input
            v-model="resultKeyword"
            class="results-filter-search-input"
            clearable
            :prefix-icon="Search"
            placeholder="搜索姓名、学号、班级、分组或拼音"
          />
          <div class="results-filter-field">
            <el-select v-model="resultGroupFilter" placeholder="分组">
              <el-option label="全部分组" value="" />
              <el-option
                v-for="group in resultGroupOptions"
                :key="group.value"
                :label="group.label"
                :value="group.value"
              />
            </el-select>
          </div>
          <div class="results-filter-field">
            <el-select v-model="resultStatusFilter" placeholder="进度">
              <el-option
                v-for="item in resultStatusOptions"
                :key="item.value"
                :label="item.label"
                :value="item.value"
              />
            </el-select>
          </div>
          <div class="results-filter-field">
            <el-select v-model="resultScoreFilter" placeholder="分数">
              <el-option
                v-for="item in resultScoreOptions"
                :key="item.value"
                :label="item.label"
                :value="item.value"
              />
            </el-select>
          </div>
          <el-button class="results-filter-reset" plain @click="clearResultFilters">重置</el-button>
        </div>
        <div ref="resultsScrollRef" class="admin-results-scroll" @scroll="handleResultsScroll">
          <template v-if="paginatedResults.length">
            <div class="results-card-grid">
              <div v-for="row in paginatedResults" :key="row.id" class="glass-panel" :style="[{ padding: '16px', borderRadius: '8px', position: 'relative', overflow: 'hidden' }, getScoreColorStyle(row.summary?.finalScore)]">
                <div style="position: relative; z-index: 1;">
                  <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                    <div>
                      <div style="font-size: 18px; font-weight: bold; margin-bottom: 4px; display: flex; align-items: baseline;">
                        <span style="color: var(--el-color-primary); font-style: italic; margin-right: 8px; font-size: 24px; font-weight: 900;">#{{ row.rankNo }}</span>
                        {{ row.name }} <span style="font-size: 14px; font-weight: normal; color: var(--el-text-color-regular); margin-left: 6px;">({{ row.studentNo }})</span>
                      </div>
                      <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                        <el-tag size="small">{{ row.group?.name }}</el-tag>
                        <el-tag size="small" type="info">{{ row.className || "班级未知" }}</el-tag>
                      </div>
                    </div>
                    <el-tag :type="row.summary?.isComplete ? 'success' : 'warning'" effect="dark">{{ row.summary?.isComplete ? "完成" : "进行中" }}</el-tag>
                  </div>
                  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; background: rgba(255,255,255,0.4); backdrop-filter: blur(4px); padding: 12px; border-radius: 6px;">
                    <div>
                      <div style="font-size: 12px; color: var(--el-text-color-secondary); margin-bottom: 4px;">平均分</div>
                      <div style="font-size: 22px; font-weight: 600; color: var(--el-color-primary);">{{ formatDecimalScore(row.summary?.avgScore) }}</div>
                    </div>
                    <div>
                      <div style="font-size: 12px; color: var(--el-text-color-secondary); margin-bottom: 4px;">最终分</div>
                      <div :style="{ fontSize: '22px', fontWeight: '600', color: getFinalScoreTextColor(row.summary?.finalScore) }">{{ formatDecimalScore(row.summary?.finalScore) }}</div>
                    </div>
                  </div>
                  <div style="margin-top: 12px; font-size: 13px; color: var(--el-text-color-regular); display: flex; justify-content: space-between; align-items: center;">
                    <span>评分进度</span>
                    <span>{{ row.summary?.submittedJudgeCount ?? 0 }} / {{ row.summary?.requiredJudgeCount ?? 0 }} 评委</span>
                  </div>
                  <el-progress 
                    :percentage="getResultProgressPercentage(row)" 
                    :show-text="false" 
                    :status="row.summary?.isComplete ? 'success' : (row.summary?.finalScore != null && row.summary?.finalScore < 60 ? 'exception' : '')"
                    style="margin-top: 6px;"
                  />
                </div>
              </div>
            </div>
          </template>
          <el-empty v-else :description="resultEmptyDescription" />
        </div>
        <div class="results-pagination-wrap">
          <el-pagination
            class="results-pagination"
            v-model:current-page="resultCurrentPage"
            v-model:page-size="resultPageSize"
            :page-sizes="resultPaginationSizes"
            :layout="resultPaginationLayout"
            :total="filteredResults.length"
            :small="isCompactResultPagination"
          />
        </div>
      </section>
      <transition name="el-fade-in-linear">
        <el-button
          v-if="isCompactResultPagination && showResultsBackTop"
          class="results-backtop-button"
          circle
          type="primary"
          :icon="Top"
          @click="scrollResultsToTop"
        />
      </transition>
    </template>

    <template v-else-if="section === 'logs'">
      <section class="glass-panel admin-manage-page">
        <div class="admin-manage-header">
          <div>
            <h3 style="margin: 0">日志管理</h3>
            <div class="muted">支持日志增删改查和批量删除。</div>
          </div>
          <div class="toolbar">
            <el-button :icon="RefreshRight" @click="fetchAll">刷新</el-button>
            <el-button type="primary" :icon="Plus" @click="openCreateLog">新建日志</el-button>
          </div>
        </div>
        <div class="admin-manage-toolbar">
          <label class="admin-activity-select-all">
            <el-checkbox :model-value="allLogsSelected" @change="toggleAllLogs" />
            <span>已选 {{ selectedLogs.length }} 项</span>
          </label>
          <div class="admin-activity-toolbar-actions">
            <el-button plain :icon="EditPen" :disabled="selectedLogs.length !== 1" @click="selectedLogs[0] && openEditLog(selectedLogs[0])">编辑</el-button>
            <el-button plain type="danger" :icon="Delete" :disabled="!selectedLogs.length" @click="batchDeleteLogs">批量删除</el-button>
          </div>
        </div>
        <div class="admin-activity-list">
          <div v-for="log in logs" :key="log.id" class="glass-panel entity-card admin-activity-row">
            <div class="admin-activity-row-main">
              <label class="admin-activity-row-check">
                <el-checkbox :model-value="selectedLogIds.includes(log.id)" @change="(checked:boolean) => toggleLog(log.id, checked)" />
              </label>
              <div class="admin-activity-row-content">
                <div class="admin-activity-row-top">
                  <div class="admin-activity-row-title">
                    <strong>{{ log.module }} / {{ log.action }}</strong>
                    <div class="tag-row">
                      <el-tag>{{ log.operatorName }}</el-tag>
                      <el-tag>{{ log.targetType }}</el-tag>
                      <el-tag type="success">{{ formatBJ(log.createdAt) }}</el-tag>
                    </div>
                  </div>
                  <div class="admin-activity-row-actions">
                    <el-button size="small" plain :icon="EditPen" @click="openEditLog(log)">编辑</el-button>
                    <el-button size="small" plain type="danger" :icon="Delete" @click="deleteLog(log)">删除</el-button>
                  </div>
                </div>
                <div class="admin-activity-row-meta">
                  <span>目标 {{ log.targetType }} {{ log.targetId || "-" }}</span>
                </div>
                <div class="muted admin-activity-row-desc">{{ log.afterData || log.beforeData || "暂无详情" }}</div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </template>

    <el-dialog v-model="activityDialog" class="mobile-dialog" :fullscreen="mobileDialog" :title="activityDialogTitle">
      <el-form label-position="top">
        <el-form-item label="活动名称"><el-input v-model="activityForm.name" /></el-form-item>
        <el-form-item label="活动编码"><el-input v-model="activityForm.code" /></el-form-item>
        <el-form-item label="活动类型"><el-input v-model="activityForm.type" /></el-form-item>
        <div class="compact-grid cols-2">
          <el-form-item label="开放开始时间">
            <el-date-picker
              v-model="activityForm.startTime"
              type="datetime"
              value-format="YYYY-MM-DDTHH:mm:ss"
              format="YYYY-MM-DD HH:mm:ss"
              placeholder="不限"
              clearable
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item label="开放结束时间">
            <el-date-picker
              v-model="activityForm.endTime"
              type="datetime"
              value-format="YYYY-MM-DDTHH:mm:ss"
              format="YYYY-MM-DD HH:mm:ss"
              placeholder="不限"
              clearable
              style="width: 100%"
            />
          </el-form-item>
        </div>
        <el-form-item label="公共页可见">
          <el-switch v-model="activityForm.isPublicVisible" active-text="可见" inactive-text="隐藏" />
        </el-form-item>
        <el-form-item label="说明"><el-input v-model="activityForm.description" type="textarea" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="activityDialog = false">取消</el-button>
        <el-button type="primary" :loading="dialogSubmitting" @click="withDialogSubmit(createActivity)">{{ activityDialogSubmitText }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="announcementDialog" class="mobile-dialog" :fullscreen="mobileDialog" title="编辑活动公告" width="800px">
      <el-form label-position="top">
        <el-form-item label="公告内容（富文本编辑器）">
          <RichEditor v-model="announcementContent" />
        </el-form-item>
        <el-form-item label="附件文档（PDF / DOCX）">
          <div class="announcement-files">
            <div v-for="(f, idx) in announcementFiles" :key="f.url" class="announcement-file-item">
              <span class="announcement-file-icon">{{ f.type === 'pdf' ? '📄' : '📝' }}</span>
              <div class="announcement-file-info">
                <span class="announcement-file-name">{{ f.name }}</span>
                <el-input
                  v-model="f.description"
                  size="small"
                  placeholder="文件说明（选填）"
                  class="announcement-file-desc-input"
                />
              </div>
              <el-button size="small" type="danger" text @click="removeAnnouncementFile(idx)">删除</el-button>
            </div>
            <el-upload
              :auto-upload="false"
              :show-file-list="false"
              accept=".pdf,.docx"
              @change="handleAnnouncementFileUpload"
            >
              <el-button size="small" type="primary" plain :loading="announcementUploading">
                <el-icon><Upload /></el-icon> 上传文档
              </el-button>
            </el-upload>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="announcementDialog = false">取消</el-button>
        <el-button type="primary" :loading="announcementSaving" @click="saveAnnouncement">保存公告</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="groupDialog" class="mobile-dialog" :fullscreen="mobileDialog" :title="editingGroupId ? '编辑分组' : '新建分组'">
      <el-form label-position="top">
        <el-form-item label="分组名称"><el-input v-model="groupForm.name" /></el-form-item>
        <el-form-item label="排序号"><el-input-number v-model="groupForm.sortOrder" :min="0" style="width: 100%" /></el-form-item>
        <el-form-item label="地点"><el-input v-model="groupForm.location" /></el-form-item>
        <el-form-item label="答辩时间">
          <el-date-picker
            v-model="groupForm.scheduleTime"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ss"
            format="YYYY-MM-DD HH:mm:ss"
            placeholder="选择答辩时间"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="锁定状态">
          <el-switch v-model="groupForm.isLocked" active-text="已锁定" inactive-text="开放" />
        </el-form-item>
        <div class="compact-grid cols-2">
          <el-form-item label="开放开始时间">
            <el-date-picker
              v-model="groupForm.startTime"
              type="datetime"
              value-format="YYYY-MM-DDTHH:mm:ss"
              format="YYYY-MM-DD HH:mm:ss"
              placeholder="不限"
              clearable
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item label="开放结束时间">
            <el-date-picker
              v-model="groupForm.endTime"
              type="datetime"
              value-format="YYYY-MM-DDTHH:mm:ss"
              format="YYYY-MM-DD HH:mm:ss"
              placeholder="不限"
              clearable
              style="width: 100%"
            />
          </el-form-item>
        </div>
        <el-form-item label="备注"><el-input v-model="groupForm.note" type="textarea" /></el-form-item>
        <el-form-item label="群二维码">
          <div style="display: flex; align-items: flex-start; gap: 12px">
            <el-upload
              :show-file-list="false"
              :auto-upload="false"
              accept="image/*"
              @change="handleQrcodeUpload"
            >
              <el-button size="small" type="primary" plain>选择图片</el-button>
            </el-upload>
            <el-button v-if="groupForm.qrcodeUrl" size="small" text type="danger" @click="groupForm.qrcodeUrl = ''">清除</el-button>
          </div>
          <el-image
            v-if="groupForm.qrcodeUrl"
            :src="groupForm.qrcodeUrl"
            :preview-src-list="[groupForm.qrcodeUrl]"
            fit="contain"
            style="width: 120px; height: 120px; margin-top: 8px; border-radius: 6px; border: 1px solid var(--el-border-color-lighter)"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="groupDialog = false">取消</el-button>
        <el-button type="primary" :loading="dialogSubmitting" @click="handleSaveGroup">{{ editingGroupId ? "更新" : "保存" }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="groupJudgeDialog" class="mobile-dialog" :fullscreen="mobileDialog" :title="`分配评委 · ${groupJudgeTarget?.name || ''}`">
      <div style="margin-bottom: 12px">
        <div class="muted" style="margin-bottom: 8px">当前分组已分配的评委：</div>
        <div class="tag-row" style="flex-wrap: wrap; gap: 4px">
          <el-tag v-for="role in (groupJudgeTarget?.activityRoles || [])" :key="role.id" closable @close="removeJudgeFromGroup(role.id)">
            {{ role.user.realName }} ({{ role.user.username }})
          </el-tag>
          <span v-if="!groupJudgeTarget?.activityRoles?.length" class="muted">暂无评委</span>
        </div>
      </div>
      <el-input v-model="groupJudgeSearch" placeholder="搜索用户名、姓名或拼音" style="margin-bottom: 8px" />
      <div style="max-height: 320px; overflow-y: auto">
        <div v-for="user in filteredSystemUsers" :key="user.id" class="glass-panel entity-card" style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; margin-bottom: 4px">
          <div>
            <strong>{{ user.realName }}</strong>
            <span class="muted" style="margin-left: 8px">{{ user.username }}</span>
          </div>
          <el-button size="small" type="primary" plain @click="assignUserToGroup(user.id)">分配</el-button>
        </div>
        <div v-if="filteredSystemUsers.length === 0" class="muted" style="text-align: center; padding: 20px 0">
          {{ groupJudgeSearch ? '没有匹配的用户' : '没有可分配的用户' }}
        </div>
      </div>
      <template #footer>
        <el-button @click="groupJudgeDialog = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="studentDialog" class="mobile-dialog" :fullscreen="mobileDialog" :title="editingStudentId ? '编辑学生' : '新建学生'">
      <el-form label-position="top">
        <el-form-item label="所属分组">
          <el-select v-model="studentForm.groupId">
            <el-option v-for="group in groups" :key="group.id" :label="group.name" :value="group.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="学号"><el-input v-model="studentForm.studentNo" /></el-form-item>
        <el-form-item label="姓名"><el-input v-model="studentForm.name" /></el-form-item>
        <div class="compact-grid cols-2">
          <el-form-item label="性别"><el-input v-model="studentForm.gender" /></el-form-item>
          <el-form-item label="班级"><el-input v-model="studentForm.className" /></el-form-item>
        </div>
        <el-form-item label="顺序号"><el-input-number v-model="studentForm.orderNo" :min="0" style="width: 100%" /></el-form-item>
        <el-form-item label="活动角色">
          <el-select v-model="studentForm.customRoleId" clearable placeholder="选择活动角色（可选）">
            <el-option v-for="role in customRoles" :key="role.id" :label="role.name" :value="role.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="studentDialog = false">取消</el-button>
        <el-button type="primary" :loading="dialogSubmitting" @click="handleSaveStudent">{{ editingStudentId ? "更新" : "保存" }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="judgeDialog" class="mobile-dialog" :fullscreen="mobileDialog" :title="editingJudgeId ? '编辑评委' : '新建评委'">
      <el-form label-position="top">
        <el-form-item label="姓名"><el-input v-model="judgeForm.realName" /></el-form-item>
        <el-form-item label="用户名"><el-input v-model="judgeForm.username" /></el-form-item>
        <el-form-item v-if="!editingJudgeId" label="初始密码"><el-input v-model="judgeForm.password" /></el-form-item>
        <el-form-item label="所属分组">
          <el-select v-model="judgeForm.groupId" clearable>
            <el-option v-for="group in groups" :key="group.id" :label="group.name" :value="group.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="活动角色">
          <el-select v-model="judgeForm.customRoleId" clearable placeholder="选择活动角色（可选）">
            <el-option v-for="role in customRoles" :key="role.id" :label="role.name" :value="role.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="judgeDialog = false">取消</el-button>
        <el-button type="primary" :loading="dialogSubmitting" @click="handleSaveJudge">{{ editingJudgeId ? "更新" : "保存" }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="logDialog" class="mobile-dialog" :fullscreen="mobileDialog" :title="editingLogId ? '编辑日志' : '新建日志'">
      <el-form label-position="top">
        <div class="compact-grid cols-2">
          <el-form-item label="操作人"><el-input v-model="logForm.operatorName" /></el-form-item>
          <el-form-item label="模块"><el-input v-model="logForm.module" /></el-form-item>
          <el-form-item label="动作"><el-input v-model="logForm.action" /></el-form-item>
          <el-form-item label="目标类型"><el-input v-model="logForm.targetType" /></el-form-item>
        </div>
        <el-form-item label="目标 ID"><el-input v-model="logForm.targetId" /></el-form-item>
        <el-form-item label="变更前"><el-input v-model="logForm.beforeData" type="textarea" :rows="4" /></el-form-item>
        <el-form-item label="变更后"><el-input v-model="logForm.afterData" type="textarea" :rows="4" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="logDialog = false">取消</el-button>
        <el-button type="primary" @click="saveLog">{{ editingLogId ? "更新" : "保存" }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="customRoleDialog" class="mobile-dialog" :fullscreen="mobileDialog" :title="editingCustomRoleId ? '编辑角色' : '新建角色'">
      <el-form label-position="top">
        <el-form-item label="角色名称"><el-input v-model="customRoleForm.name" placeholder="如：组长、主评委、答辩秘书" /></el-form-item>
        <el-form-item label="职责描述"><el-input v-model="customRoleForm.description" type="textarea" :rows="3" placeholder="描述该角色的职责" /></el-form-item>
        <div class="compact-grid cols-2">
          <el-form-item label="标签颜色"><el-color-picker v-model="customRoleForm.color" /></el-form-item>
          <el-form-item label="排序号"><el-input-number v-model="customRoleForm.sortOrder" :min="0" style="width: 100%" /></el-form-item>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="customRoleDialog = false">取消</el-button>
        <el-button type="primary" :loading="dialogSubmitting" @click="handleSaveCustomRole">{{ editingCustomRoleId ? "更新" : "保存" }}</el-button>
      </template>
    </el-dialog>

    <ImportDialog
      v-model="studentImportOpen"
      title="学生导入"
      :upload-url="`/api/admin/activities/${activityId}/students/import`"
      template-url="/api/meta/templates/students"
      sample-name="students-template.xlsx"
      :disabled="currentActivityLocked"
      @success="fetchAll"
    />
    <ImportDialog
      v-model="judgeImportOpen"
      title="评委导入"
      :upload-url="`/api/admin/activities/${activityId}/judges/import`"
      template-url="/api/meta/templates/judges"
      sample-name="judges-template.xlsx"
      :disabled="currentActivityLocked"
      @success="fetchAll"
    />
    <ImportDialog
      v-model="groupImportOpen"
      title="分组导入"
      :upload-url="`/api/admin/activities/${activityId}/groups/import`"
      template-url="/api/meta/templates/groups"
      sample-name="groups-template.xlsx"
      :disabled="currentActivityLocked"
      @success="fetchAll"
    />
  </AppShell>
</template>

<style scoped>
.admin-results-panel {
  padding: 10px 12px 12px;
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 10px;
}

.results-toolbar-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
}

.results-toolbar-title {
  min-width: 0;
}

.results-toolbar-count {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  color: var(--el-text-color-regular);
  font-size: 12px;
  margin-top: 6px;
}

.results-toolbar-count span {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.68);
  border: 1px solid rgba(64, 158, 255, 0.12);
}

.results-toolbar-hint {
  color: var(--el-text-color-secondary);
  max-width: 100%;
}

.results-toolbar {
  display: grid;
  grid-template-columns: minmax(240px, 2.2fr) repeat(3, minmax(120px, 1fr)) auto;
  gap: 10px;
  align-items: center;
}

.results-filter-field {
  min-width: 0;
}

.results-filter-search-input {
  min-width: 0;
}

.results-filter-search-input :deep(.el-input__wrapper),
.results-filter-field :deep(.el-input),
.results-filter-field :deep(.el-select) {
  width: 100%;
}

.results-filter-reset {
  min-width: 84px;
}

.admin-results-scroll {
  flex: 1;
  overflow-y: auto;
  padding-right: 4px;
}

.results-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.announcement-files {
  width: 100%;
}
.announcement-file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  margin-bottom: 6px;
  background: #f5f7fa;
  border-radius: 6px;
}
.announcement-file-icon {
  font-size: 18px;
  flex-shrink: 0;
}
.announcement-file-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.announcement-file-desc-input {
  font-size: 12px;
}
.announcement-file-name {
  font-size: 13px;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 1080px) {
  .results-toolbar {
    grid-template-columns: minmax(0, 1.8fr) repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .results-toolbar-head {
    flex-direction: column;
    align-items: flex-start;
  }

  .results-toolbar {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .results-filter-search-input {
    grid-column: span 2;
  }

  .results-toolbar-count span {
    padding: 0 8px;
  }

  .results-filter-reset {
    width: 100%;
  }
}
</style>
