<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { ArrowDown } from "@element-plus/icons-vue";
import { api } from "../api";
import { distributeScore } from "../score-distribute";
import type { ScoreTemplate, Student } from "../types";
import { useModalHistory } from "../composables/useModalHistory";

const props = defineProps<{
  modelValue: boolean;
  activityId: string;
  student: Student | null;
  template: ScoreTemplate | null;
  readonly?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  success: [];
}>();

const form = reactive({
  comment: "",
  totalScore: 0,
  details: {} as Record<string, number>,
});

const fullscreen = computed(() => window.innerWidth < 768);
const isTotalOnly = computed(() => props.template?.scoreMode === "TOTAL" || !props.template?.items?.length);
const quickTotal = ref<number | undefined>(undefined);
const maxTotal = computed(() => props.template?.items.reduce((s, i) => s + i.maxScore, 0) ?? 0);
const generatingComment = ref(false);
const generatingQuestions = ref(false);
const commentPrompt = ref("");
const questionTopic = ref("师范生面试问题");
const scoreItemsOpen = ref(true);
const aiQuestions = ref<string[]>([]);
const closeGuardDisabled = ref(false);
const saving = ref<"" | "save-draft" | "submit-score">("");

function buildFormSignature() {
  const detailSignature = isTotalOnly.value
    ? ""
    : (props.template?.items || [])
        .map((item) => `${item.id}:${Number(form.details[item.id] || 0)}`)
        .join("|");

  return [
    Number(form.totalScore || 0),
    total.value,
    form.comment || "",
    detailSignature,
  ].join("\u001f");
}

const initialSignature = ref("");
const hasSubmittedScore = computed(() => props.student?.scores?.[0]?.status === "SUBMITTED");
const shouldWarnBeforeClose = computed(() => {
  if (!props.student || !props.template || closeGuardDisabled.value) return false;
  if (!hasSubmittedScore.value) return true;
  return buildFormSignature() !== initialSignature.value;
});

function applyQuickDistribute() {
  if (quickTotal.value === undefined || !props.template?.items.length) return;
  const result = distributeScore(quickTotal.value, props.template.items);
  Object.assign(form.details, result);
  quickTotal.value = undefined;
}
const total = computed(() =>
  isTotalOnly.value
    ? Number(form.totalScore || 0)
    : props.template?.items.reduce((sum, item) => sum + Number(form.details[item.id] || 0), 0) ?? 0,
);

watch(
  () => ({
    student: props.student,
    template: props.template,
  }),
  ({ student, template }) => {
    form.comment = student?.scores?.[0]?.comment || "";
    form.totalScore = student?.scores?.[0]?.totalScore || 0;
    questionTopic.value = "师范生面试问题";
    aiQuestions.value = [];
    closeGuardDisabled.value = false;
    form.details = {};
    template?.items.forEach((item) => {
      const existing = student?.scores?.[0]?.details?.find((detail) => detail.itemId === item.id);
      form.details[item.id] = existing?.scoreValue || 0;
    });
    initialSignature.value = buildFormSignature();
  },
  { immediate: true },
);

watch(
  () => props.modelValue,
  (visible) => {
    if (visible) {
      initialSignature.value = buildFormSignature();
      closeGuardDisabled.value = false;
      return;
    }
    closeGuardDisabled.value = false;
  },
);

async function confirmCloseIfNeeded() {
  if (!shouldWarnBeforeClose.value) return true;
  try {
    await ElMessageBox.confirm(
      "当前评分尚未提交，建议先点击“提交评分”再关闭窗口。",
      "关闭提醒",
      {
        confirmButtonText: "仍然关闭",
        cancelButtonText: "继续评分",
        distinguishCancelAndClose: true,
        type: "warning",
      },
    );
    return true;
  } catch {
    return false;
  }
}

async function requestClose() {
  if (!(await confirmCloseIfNeeded())) return false;
  emit("update:modelValue", false);
  return true;
}

async function handleBeforeClose(done: () => void) {
  if (!(await confirmCloseIfNeeded())) return;
  done();
  emit("update:modelValue", false);
}

useModalHistory(
  () => props.modelValue,
  requestClose,
  "score-dialog",
);

async function save(endpoint: "save-draft" | "submit-score") {
  if (!props.student || !props.template || props.readonly || saving.value) return;
  saving.value = endpoint;
  try {
    await api.post(`/api/judge/activities/${props.activityId}/students/${props.student.id}/${endpoint}`, {
      templateId: props.template.id,
      totalScore: total.value,
      comment: form.comment,
      details: props.template.items.map((item) => ({
        itemId: item.id,
        scoreValue: Number(form.details[item.id] || 0),
      })),
    });
    closeGuardDisabled.value = true;
    emit("success");
    emit("update:modelValue", false);
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || "评分提交失败，请稍后重试");
  } finally {
    saving.value = "";
  }
}

async function generateComment() {
  if (!props.student || !props.template || props.readonly) return;
  generatingComment.value = true;
  try {
    const { data } = await api.post(
      `/api/judge/activities/${props.activityId}/students/${props.student.id}/generate-comment`,
      { totalScore: total.value, prompt: commentPrompt.value.trim() || undefined },
    );
    form.comment = data.comment || "";
    ElMessage.success("评语已生成");
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || "生成评语失败，请稍后重试");
  } finally {
    generatingComment.value = false;
  }
}

async function generateQuestions() {
  if (!props.student || props.readonly) return;
  generatingQuestions.value = true;
  try {
    const { data } = await api.post(
      `/api/judge/activities/${props.activityId}/students/${props.student.id}/generate-questions`,
      { topic: questionTopic.value },
    );
    aiQuestions.value = Array.isArray(data.questions) ? data.questions : [];
    ElMessage.success("提问已生成");
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || "生成提问失败，请稍后重试");
  } finally {
    generatingQuestions.value = false;
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    class="mobile-dialog score-dialog"
    :fullscreen="fullscreen"
    :title="student ? `为 ${student.name} 评分` : '评分'"
    :before-close="handleBeforeClose"
    :close-on-click-modal="false"
  >
    <div v-if="student && template" class="compact-grid">
      <div v-if="readonly" class="readonly-banner">
        <span class="readonly-banner-dot"></span>
        <span>当前活动已锁定，只读</span>
      </div>
      <div class="glass-panel entity-card">
        <div class="tag-row" style="margin-bottom: 10px">
          <el-tag round>{{ student.group?.name }}</el-tag>
          <el-tag round type="info">{{ student.studentNo }}</el-tag>
          <el-tag round type="success">{{ isTotalOnly ? "当前总分" : "当前合计" }} {{ total }}</el-tag>
        </div>
        <div v-if="isTotalOnly">
          <div class="muted" style="margin-bottom: 8px">当前模板为总分模式，导师可直接填写总分。</div>
          <el-input-number
            v-model="form.totalScore"
            :min="0"
            :max="template.totalScore"
            :disabled="readonly"
            style="width: 100%"
          />
          <div class="muted" style="margin: 8px 0 12px">
            总分上限 {{ template.totalScore }} 分
          </div>
        </div>
        <div v-else>
          <div class="quick-distribute-row">
            <el-input-number v-model="quickTotal" :min="0" :max="maxTotal" :disabled="readonly" placeholder="输入总分" controls-position="right" style="flex: 1" />
            <el-button type="primary" plain :disabled="readonly || quickTotal === undefined" @click="applyQuickDistribute">智能分配</el-button>
          </div>
          <div class="score-items-collapse" @click="scoreItemsOpen = !scoreItemsOpen">
            <span class="score-items-collapse-title">评分项明细</span>
            <span class="muted" style="font-size: 12px">合计 {{ total }} / {{ maxTotal }}</span>
            <el-icon class="score-items-collapse-arrow" :class="{ 'is-open': scoreItemsOpen }"><ArrowDown /></el-icon>
          </div>
          <div v-show="scoreItemsOpen" class="card-list score-items-list">
            <div v-for="item in template.items" :key="item.id" class="score-item-block">
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px">
                <strong>{{ item.name }}</strong>
                <span class="muted">（满分 {{ item.maxScore }}）</span>
              </div>
              <div v-if="item.description" class="muted" style="margin-bottom: 4px; font-size: 12px">{{ item.description }}</div>
              <el-input-number
                v-model="form.details[item.id]"
                :min="0"
                :max="item.maxScore"
                :disabled="readonly"
                style="width: 100%"
              />
            </div>
          </div>
        </div>
        <el-input v-model="form.comment" class="comment-font-field" :disabled="readonly" type="textarea" :rows="3" placeholder="请输入评语" style="margin-top: 14px" />
        <div class="score-comment-toolbar">
          <el-input v-model="commentPrompt" :disabled="readonly" placeholder="自定义提示词（留空则自动生成）" />
          <el-button type="primary" plain :disabled="readonly" :loading="generatingComment" @click="generateComment">AI生成评语</el-button>
        </div>
        <div class="muted" style="margin-top: 4px; font-size: 12px">填写自定义提示词后，AI将按照提示词生成评语；留空则根据分值自动生成。</div>
      </div>

      <div class="glass-panel entity-card">
        <div class="panel-header" style="margin-bottom: 8px">
          <strong>AI 提问</strong>
          <span class="muted">生成 1-2 个简单追问</span>
        </div>
        <div class="score-question-toolbar">
          <el-input v-model="questionTopic" placeholder="输入提问主题" />
          <el-button type="primary" plain :disabled="readonly" :loading="generatingQuestions" @click="generateQuestions">AI生成提问</el-button>
        </div>
        <div class="muted" style="margin-top: 6px">默认主题：师范生面试问题，可自行修改。</div>
        <div v-if="aiQuestions.length" class="score-question-list">
          <div v-for="(question, index) in aiQuestions" :key="`${index}-${question}`" class="score-question-item">
            <span class="score-question-index">问题{{ index + 1 }}</span>
            <div class="score-question-text">{{ question }}</div>
          </div>
        </div>
      </div>

      <div v-if="student.peerScores?.length" class="glass-panel entity-card">
        <div class="panel-header" style="margin-bottom: 6px">
          <strong>同组评分动态</strong>
          <span class="muted">评委匿名代号展示</span>
        </div>
        <div class="card-list">
          <div v-for="peer in student.peerScores" :key="peer.id" class="peer-score-row">
            <div class="tag-row">
              <el-tag round>{{ peer.anonymousCode || "评委" }}</el-tag>
              <el-tag :type="peer.status === 'SUBMITTED' ? 'success' : 'warning'" round>
                {{ peer.status === "SUBMITTED" ? "已提交" : "草稿" }}
              </el-tag>
              <el-tag round type="info">总分 {{ peer.totalScore }}</el-tag>
            </div>
            <div v-if="peer.comment" class="muted comment-font-text">备注：{{ peer.comment }}</div>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="score-dialog-actions">
        <el-button @click="requestClose" :disabled="!!saving">取消</el-button>
        <el-button type="primary" plain :disabled="readonly" :loading="saving === 'save-draft'" @click="save('save-draft')">保存草稿</el-button>
        <el-button type="primary" :disabled="readonly" :loading="saving === 'submit-score'" @click="save('submit-score')">提交评分</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.score-dialog :deep(.el-dialog) {
  display: flex;
  flex-direction: column;
  max-height: min(92vh, 960px);
}

.score-dialog :deep(.el-dialog__body) {
  flex: 1 1 auto;
  overflow-y: auto;
  padding-bottom: 10px;
}

.score-dialog :deep(.el-dialog__footer) {
  position: sticky;
  bottom: 0;
  z-index: 2;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.78);
  background: rgba(252, 254, 255, 0.94);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}

.score-comment-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  margin-top: 8px;
}

.score-items-collapse {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
  padding: 8px 12px;
  margin-top: 10px;
  border-radius: 8px;
  background: rgba(64, 158, 255, 0.07);
  border: 1px solid rgba(64, 158, 255, 0.18);
  transition: background 0.15s;
}

.score-items-collapse:hover {
  background: rgba(64, 158, 255, 0.13);
}

.score-items-collapse-title {
  font-weight: 600;
  font-size: 13px;
  flex: 1;
  color: #2f80ed;
}

.score-items-collapse-arrow {
  transition: transform 0.2s;
  color: #2f80ed;
}

.score-items-collapse-arrow.is-open {
  transform: rotate(180deg);
}

.score-items-list {
  margin-top: 6px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(64, 158, 255, 0.12);
  background: rgba(64, 158, 255, 0.03);
}

.score-question-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
}

.score-question-list {
  display: grid;
  gap: 8px;
  margin-top: 10px;
}

.score-question-item {
  border-radius: 8px;
  padding: 10px 12px;
  background: rgba(64, 158, 255, 0.08);
  border: 1px solid rgba(64, 158, 255, 0.18);
}

.score-question-index {
  display: inline-block;
  margin-bottom: 4px;
  font-size: 12px;
  font-weight: 700;
  color: #2f80ed;
}

.score-question-text {
  font-size: 14px;
  line-height: 1.7;
  color: var(--text);
}

@media (max-width: 600px) {
  .score-question-toolbar {
    grid-template-columns: 1fr;
  }

  .score-dialog :deep(.el-dialog__footer) {
    padding-bottom: calc(12px + env(safe-area-inset-bottom));
  }
}

.comment-font-text {
  line-height: 1.7;
}
</style>
