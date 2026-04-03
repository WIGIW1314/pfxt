<script setup lang="ts">
import { defineAsyncComponent, ref, computed, onMounted, onUnmounted } from "vue";
import { useRoute } from "vue-router";
import {
  ArrowDown,
  ArrowRight,
  Calendar,
  Clock,
  Location,
  UserFilled,
  InfoFilled,
  Search,
} from "@element-plus/icons-vue";
import { api, API_BASE } from "../api";
import { formatBJ } from "../date";
import AppShell from "../components/AppShell.vue";
import { useModalHistory } from "../composables/useModalHistory";
import { matchesSearchKeyword } from "../utils/search";

const DocViewer = defineAsyncComponent(() => import("../components/DocViewer.vue"));
const PUBLIC_REFRESH_EVENTS = new Set([
  "activity.updated",
  "group.updated",
  "student.updated",
  "judge.updated",
  "template.updated",
  "customRole.updated",
]);

const route = useRoute();
const section = computed(() => (route.params.section as string) || "groups");

const loading = ref(true);
const previewQrcode = ref<{ url: string; name: string } | null>(null);
const error = ref("");
const notOpen = ref(false);
const activity = ref<any>(null);
const collapsedGroups = ref<Record<string, boolean>>({});
const collapsedStudentLists = ref<Record<string, boolean>>({});
let eventSource: EventSource | null = null;

const activeTemplate = computed(() => {
  if (!activity.value?.templates?.length) return null;
  if (activity.value.activeTemplateId) {
    return activity.value.templates.find((t: any) => t.id === activity.value.activeTemplateId) || activity.value.templates[0];
  }
  return activity.value.templates[0];
});

const studentSearch = ref("");
const filteredGroups = computed(() => {
  const groups = activity.value?.groups || [];
  const keyword = studentSearch.value.trim();
  if (!keyword) return groups;
  return groups
    .map((group: any) => ({
      ...group,
      students: (group.students || []).filter((s: any) =>
        matchesSearchKeyword([s.name, s.studentNo, s.className, s.customRole?.name], keyword),
      ),
    }))
    .filter((group: any) => group.students.length > 0);
});
const matchCount = computed(() => {
  const keyword = studentSearch.value.trim();
  if (!keyword) return 0;
  return filteredGroups.value.reduce((sum: number, g: any) => sum + g.students.length, 0);
});

useModalHistory(
  () => Boolean(previewQrcode.value),
  async () => {
    previewQrcode.value = null;
    return true;
  },
  "public-qrcode-preview",
);

async function fetchData() {
  loading.value = true;
  error.value = "";
  notOpen.value = false;
  try {
    const { data } = await api.get("/api/public/active-activity");
    if (data.available === false) {
      notOpen.value = true;
    } else {
      activity.value = data;
    }
  } catch (e: any) {
    error.value = e.response?.data?.message || "获取活动信息失败";
  } finally {
    loading.value = false;
  }
}

// 静默刷新（不显示 loading）
async function silentRefresh() {
  try {
    const { data } = await api.get("/api/public/active-activity");
    if (data.available === false) {
      notOpen.value = true;
      activity.value = null;
    } else {
      notOpen.value = false;
      activity.value = data;
    }
  } catch {
    // keep current data on transient errors
  }
}

function connectSSE() {
  if (eventSource) return;
  eventSource = new EventSource(`${API_BASE}/api/public/events`);
  eventSource.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (PUBLIC_REFRESH_EVENTS.has(msg.type)) {
        silentRefresh();
      }
    } catch { /* ignore */ }
  };
  eventSource.onerror = () => {
    eventSource?.close();
    eventSource = null;
    // auto-reconnect after 3s
    setTimeout(connectSSE, 3000);
  };
}

onMounted(() => {
  fetchData();
  connectSSE();
});

onUnmounted(() => {
  eventSource?.close();
  eventSource = null;
});

function downloadQrcode(url: string, name: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}-二维码.png`;
  link.click();
}

// 格式化时间
function formatTime(time?: string | null) {
  return formatBJ(time, "YYYY/MM/DD HH:mm:ss");
}

function roleTheme(role?: { name?: string; color?: string } | null) {
  if (role?.color) {
    return {
      chipBg: role.color,
      chipText: "#ffffff",
      cardBg: "rgba(64, 158, 255, 0.08)",
      border: role.color,
    };
  }

  const name = role?.name || "未分配角色";
  const themes = [
    { chipBg: "#2f80ed", chipText: "#ffffff", cardBg: "rgba(47,128,237,0.10)", border: "#2f80ed" },
    { chipBg: "#16a085", chipText: "#ffffff", cardBg: "rgba(22,160,133,0.10)", border: "#16a085" },
    { chipBg: "#f2994a", chipText: "#ffffff", cardBg: "rgba(242,153,74,0.12)", border: "#f2994a" },
    { chipBg: "#eb5757", chipText: "#ffffff", cardBg: "rgba(235,87,87,0.10)", border: "#eb5757" },
    { chipBg: "#6c5ce7", chipText: "#ffffff", cardBg: "rgba(108,92,231,0.10)", border: "#6c5ce7" },
    { chipBg: "#00a8a8", chipText: "#ffffff", cardBg: "rgba(0,168,168,0.10)", border: "#00a8a8" },
  ];

  const hash = Array.from(name).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return themes[hash % themes.length];
}

function isGroupCollapsed(groupId: string) {
  return Boolean(collapsedGroups.value[groupId]);
}

function isStudentListCollapsed(groupId: string) {
  return Boolean(collapsedStudentLists.value[groupId]);
}

function toggleGroupCollapse(groupId: string) {
  collapsedGroups.value = {
    ...collapsedGroups.value,
    [groupId]: !collapsedGroups.value[groupId],
  };
}

function toggleStudentListCollapse(groupId: string) {
  collapsedStudentLists.value = {
    ...collapsedStudentLists.value,
    [groupId]: !collapsedStudentLists.value[groupId],
  };
}

function hasRoleDuty(student: any) {
  const desc = String(student?.customRole?.description || "").trim();
  return Boolean(desc) && !["无", "无职责", "暂无", "暂无职责"].includes(desc);
}
</script>

<template>
  <AppShell :title="activity?.name || '线上评分系统'" mode="public">
    <!-- 加载中 -->
    <div v-if="loading" style="text-align: center; padding: 60px 0">
      <el-icon class="is-loading" :size="28" color="var(--primary)"><Calendar /></el-icon>
      <p style="color: var(--muted); margin-top: 12px; font-size: 13px">加载中…</p>
    </div>

    <!-- 活动未开放 -->
    <div v-else-if="notOpen" class="glass-panel public-not-open">
      <el-icon :size="44" class="public-not-open-icon"><InfoFilled /></el-icon>
      <div class="public-not-open-title">活动暂未开放</div>
      <div class="public-not-open-desc">管理员尚未开放公共页，请稍后再试或联系管理员。</div>
    </div>

    <!-- 错误 -->
    <div v-else-if="error" class="glass-panel" style="padding: 40px 20px; text-align: center">
      <el-icon :size="36" color="var(--warning)"><InfoFilled /></el-icon>
      <p style="margin-top: 12px; color: var(--muted); font-size: 14px">{{ error }}</p>
      <el-button type="primary" size="small" style="margin-top: 12px" @click="fetchData">重试</el-button>
    </div>

    <!-- 加载完成 -->
    <template v-else-if="activity">
      <!-- ========= 分组信息 ========= -->
      <template v-if="section === 'groups'">
        <div class="public-search-bar">
          <el-input
            v-model="studentSearch"
              placeholder="搜索学生姓名、学号、班级、角色、拼音…"
            clearable
            :prefix-icon="Search"
            size="default"
          />
          <div v-if="studentSearch.trim()" class="public-search-hint muted">
            匹配到 <strong>{{ matchCount }}</strong> 名学生（{{ filteredGroups.length }} 个分组）
          </div>
        </div>
        <div class="public-search-bar-spacer"></div>

        <div v-if="!filteredGroups.length" class="glass-panel" style="padding: 30px; text-align: center; color: var(--muted)">
          {{ studentSearch.trim() ? '没有匹配的学生' : '暂无分组信息' }}
        </div>

        <div v-for="group in filteredGroups" :key="group.id" class="public-group-card glass-panel">
          <div class="public-group-header">
            <button type="button" class="public-group-toggle" @click="toggleGroupCollapse(group.id)">
              <el-icon :size="15">
                <component :is="isGroupCollapsed(group.id) ? ArrowRight : ArrowDown" />
              </el-icon>
              <div class="public-group-title-block">
                <h3 class="public-group-name">{{ group.name }}</h3>
                <div class="public-group-meta">
                  <span v-if="group.location" class="public-meta-item">
                    <el-icon :size="13"><Location /></el-icon>{{ group.location }}
                  </span>
                  <span v-if="group.scheduleTime" class="public-meta-item">
                    <el-icon :size="13"><Clock /></el-icon>{{ formatTime(group.scheduleTime) }}
                  </span>
                  <span v-if="group.startTime" class="public-meta-item">
                    <el-icon :size="13"><Clock /></el-icon>{{ formatTime(group.startTime) }} ~ {{ formatTime(group.endTime) }}
                  </span>
                </div>
              </div>
            </button>

            <div v-if="group.qrcodeUrl" class="public-qrcode public-qrcode-corner">
              <img
                :src="group.qrcodeUrl"
                class="public-qrcode-img"
                style="cursor: pointer"
                @click="previewQrcode = { url: group.qrcodeUrl, name: group.name }"
              />
            </div>
          </div>

          <div v-if="!isGroupCollapsed(group.id)" class="public-group-body">
            <!-- 评委列表 -->
            <div v-if="group.judges?.length" class="public-judges">
              <div class="public-section-label"><el-icon :size="13"><UserFilled /></el-icon>评委</div>
              <div class="public-judge-tags">
                <el-tag
                  v-for="(judge, i) in group.judges"
                  :key="i"
                  :color="judge.customRole?.color || '#409eff'"
                  effect="dark"
                  size="small"
                  style="border: 0"
                >
                  {{ judge.realName }}
                  <template v-if="judge.customRole">（{{ judge.customRole.name }}）</template>
                </el-tag>
              </div>
            </div>

            <!-- 学生列表 -->
            <div v-if="group.students?.length" class="public-students">
              <button type="button" class="public-students-toggle" @click="toggleStudentListCollapse(group.id)">
                <span class="public-section-label public-section-label-inline">学生名单（{{ group.students.length }}）</span>
                <el-icon :size="14">
                  <component :is="isStudentListCollapsed(group.id) ? ArrowRight : ArrowDown" />
                </el-icon>
              </button>
              <div v-if="!isStudentListCollapsed(group.id)" class="public-students-grid">
                <article
                  v-for="student in group.students"
                  :key="student.id"
                  class="public-student-card"
                  :class="{ 'public-student-card-wide': hasRoleDuty(student) }"
                  :style="{
                    background: roleTheme(student.customRole).cardBg,
                    borderColor: roleTheme(student.customRole).border,
                  }"
                >
                  <div class="public-student-card-top">
                    <div class="public-student-main">
                      <span class="public-student-no">#{{ student.orderNo }}</span>
                      <span class="public-student-name">{{ student.name }}</span>
                    </div>
                    <span
                      class="public-student-role"
                      :style="{
                        background: roleTheme(student.customRole).chipBg,
                        color: roleTheme(student.customRole).chipText,
                      }"
                    >
                      {{ student.customRole?.name || "普通成员" }}
                    </span>
                  </div>

                  <div class="public-student-meta">
                    <span>学号：{{ student.studentNo || "—" }}</span>
                    <span>班级：{{ student.className || "—" }}</span>
                  </div>

                  <div class="public-student-desc" v-if="hasRoleDuty(student)">
                    {{ student.customRole.description }}
                  </div>
                </article>
              </div>
            </div>
          </div>

          <div v-else-if="group.judges?.length" class="public-group-collapsed-judges">
            <div class="public-section-label"><el-icon :size="13"><UserFilled /></el-icon>评委</div>
            <div class="public-judge-tags">
              <el-tag
                v-for="(judge, i) in group.judges"
                :key="`collapsed-${i}`"
                :color="judge.customRole?.color || '#409eff'"
                effect="dark"
                size="small"
                style="border: 0"
              >
                {{ judge.realName }}
                <template v-if="judge.customRole">（{{ judge.customRole.name }}）</template>
              </el-tag>
            </div>
          </div>
        </div>
      </template>

      <!-- ========= 评分标准 ========= -->
      <template v-if="section === 'scoring'">
        <div v-if="!activeTemplate" class="glass-panel" style="padding: 30px; text-align: center; color: var(--muted)">
          暂未设置评分模板
        </div>

        <div v-if="activeTemplate" class="public-template-card glass-panel">
          <el-table :data="activeTemplate.items" class="public-table public-table-desktop" stripe size="default" :show-overflow-tooltip="true">
            <el-table-column label="序号" type="index" width="56" align="center" />
            <el-table-column label="评分项" prop="name" min-width="110" />
            <el-table-column label="满分" prop="maxScore" width="76" align="center" />
            <el-table-column label="说明" prop="description" min-width="180">
              <template #default="{ row }">
                <span v-if="row.description">{{ row.description }}</span>
                <span v-else class="muted">—</span>
              </template>
            </el-table-column>
          </el-table>

          <div class="public-template-mobile-list">
            <article
              v-for="(item, index) in activeTemplate.items"
              :key="item.id"
              class="public-template-item-card"
            >
              <div class="public-template-item-top">
                  <div class="public-template-item-index">#{{ Number(index) + 1 }}</div>
                <div class="public-template-item-main">
                  <div class="public-template-item-name">{{ item.name }}</div>
                  <div class="public-template-item-score">满分 {{ item.maxScore }}</div>
                </div>
              </div>
              <div class="public-template-item-desc">
                {{ item.description || "暂无说明" }}
              </div>
            </article>
          </div>
        </div>
      </template>

      <!-- ========= 角色职责 ========= -->
      <template v-if="section === 'roles'">
        <div v-if="!activity.customRoles?.length" class="glass-panel" style="padding: 30px; text-align: center; color: var(--muted)">
          暂未设置活动角色
        </div>

        <div class="public-roles-grid">
          <div v-for="role in activity.customRoles" :key="role.id" class="public-role-card glass-panel">
            <div class="public-role-header">
              <span class="public-role-dot" :style="{ background: role.color || '#409eff' }"></span>
              <span class="public-role-name">{{ role.name }}</span>
            </div>
            <div class="public-role-desc" v-if="role.description">{{ role.description }}</div>
            <div class="public-role-desc muted" v-else>暂无职责描述</div>
          </div>
        </div>
      </template>

      <!-- ========= 活动公告 ========= -->
      <template v-if="section === 'announcement'">
        <div v-if="!activity.announcement && (!activity.announcementFiles || !activity.announcementFiles.length)" class="glass-panel" style="padding: 30px; text-align: center; color: var(--muted)">
          暂无公告
        </div>

        <div v-else class="public-announcement glass-panel">
          <DocViewer :html="activity.announcement" :files="activity.announcementFiles || []" />
        </div>
      </template>
    </template>
  </AppShell>

  <Teleport to="body">
    <div v-if="previewQrcode" class="qr-preview-overlay" @click="previewQrcode = null">
      <div class="qr-preview-panel" @click.stop>
        <img :src="previewQrcode.url" class="qr-preview-img" />
        <div class="qr-preview-actions">
          <el-button type="primary" size="small" @click="downloadQrcode(previewQrcode.url, previewQrcode.name)">下载二维码</el-button>
        </div>
      </div>
      <button class="qr-preview-close" @click="previewQrcode = null">&times;</button>
    </div>
  </Teleport>
</template>

<style scoped>
.public-not-open {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 60px 24px 48px;
  text-align: center;
}

.public-not-open-icon {
  color: #b0bec5;
  opacity: 0.7;
}

.public-not-open-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--text);
  line-height: 1.3;
}

.public-not-open-desc {
  font-size: 13px;
  color: var(--muted);
  line-height: 1.6;
  max-width: 280px;
}

.public-search-bar {
  padding: 0;
  margin-bottom: 10px;
}

.public-search-bar :deep(.el-input__wrapper) {
  min-height: 42px;
  padding: 0 12px !important;
  border-radius: 10px !important;
  background: rgba(255, 255, 255, 0.68) !important;
  border: 1px solid rgba(255, 255, 255, 0.9) !important;
  box-shadow: 0 10px 24px rgba(72, 92, 148, 0.08);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}

.public-search-bar :deep(.el-input__wrapper.is-focus) {
  background: rgba(255, 255, 255, 0.76) !important;
  box-shadow: 0 0 0 1px rgba(64, 158, 255, 0.18), 0 10px 24px rgba(72, 92, 148, 0.12);
}
.public-search-hint {
  margin-top: 6px;
  font-size: 12px;
}

.public-page-header {
  padding: 12px 14px;
  margin-bottom: 10px;
}

.public-page-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
}

.public-page-desc {
  margin-top: 6px;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.5;
}

.public-group-card {
  position: relative;
  padding: 14px;
  margin-bottom: 10px;
}

.public-group-header {
  margin-bottom: 8px;
}

.public-group-toggle {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 0;
  padding-right: 96px;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.public-group-title-block {
  min-width: 0;
}

.public-group-name {
  margin: 0 0 6px;
  font-size: 15px;
  font-weight: 700;
}

.public-group-body {
  display: grid;
  gap: 10px;
}

.public-group-collapsed-judges {
  margin-top: 8px;
}

.public-group-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  font-size: 12px;
  color: var(--muted);
}

.public-meta-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.public-section-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  margin-bottom: 6px;
}

.public-section-label-inline {
  margin-bottom: 0;
}

.public-judges {
  margin-bottom: 0;
}

.public-judge-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.public-qrcode {
  margin-bottom: 0;
}

.public-qrcode-corner {
  position: absolute;
  top: 10px;
  right: 10px;
  display: grid;
  justify-items: center;
  gap: 2px;
  flex: 0 0 auto;
}

.public-qrcode-img {
  width: 64px;
  height: 64px;
  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.88);
  object-fit: contain;
  background: #fff;
}

.qr-preview-overlay {
  position: fixed;
  inset: 0;
  z-index: 99999;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
}

.qr-preview-panel {
  display: grid;
  gap: 10px;
  justify-items: center;
  padding: 14px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.24);
}

.qr-preview-img {
  max-width: 88vw;
  max-height: min(72vh, 560px);
  object-fit: contain;
  border-radius: 8px;
  background: #fff;
}

.qr-preview-actions {
  display: flex;
  justify-content: center;
}

.qr-preview-close {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
  font-size: 28px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.public-students {
  margin-top: 6px;
}

.public-students-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  margin-bottom: 6px;
}

.public-students-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.public-student-card {
  border: 1px solid;
  border-radius: 10px;
  padding: 10px;
  min-height: 92px;
}

.public-student-card-wide {
  grid-column: 1 / -1;
}

.public-student-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.public-student-main {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.public-student-no {
  font-size: 12px;
  color: var(--muted);
}

.public-student-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.public-student-role {
  font-size: 12px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  white-space: nowrap;
}

.public-student-meta {
  margin-top: 8px;
  display: grid;
  gap: 3px;
  font-size: 12px;
  color: var(--muted);
}

.public-student-desc {
  margin-top: 6px;
  font-size: 12px;
  color: var(--text);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

/* 公开页面表格 — 比 dense-table 更宽松 */
.public-table.el-table {
  --el-table-border-color: rgba(255, 255, 255, 0.72);
  --el-table-header-bg-color: rgba(255, 255, 255, 0.46);
  --el-table-tr-bg-color: rgba(255, 255, 255, 0.26);
  --el-table-row-hover-bg-color: rgba(255, 255, 255, 0.38);
  --el-fill-color-lighter: rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.22) !important;
  border-radius: 6px !important;
}

.public-table.el-table th.el-table__cell,
.public-table.el-table tr,
.public-table.el-table td.el-table__cell {
  background: transparent !important;
}

.public-table.el-table .el-table__inner-wrapper {
  border-radius: 6px !important;
}

.public-table th .cell {
  font-size: 13px;
  font-weight: 700;
  line-height: 1.4;
  padding: 0 8px;
}

.public-table td .cell {
  font-size: 13px;
  line-height: 1.5;
  padding: 0 8px;
}

.public-table th,
.public-table td {
  padding: 10px 0;
}

.public-table .el-table__empty-text {
  font-size: 13px;
}

/* 评分标准 */
.public-template-card {
  padding: 14px;
  margin-bottom: 10px;
}

.public-template-mobile-list {
  display: none;
}

.public-template-item-card {
  display: grid;
  gap: 8px;
  padding: 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.42);
  border: 1px solid rgba(255, 255, 255, 0.82);
}

.public-template-item-top {
  display: flex;
  align-items: center;
  gap: 10px;
}

.public-template-item-index {
  flex: 0 0 auto;
  min-width: 38px;
  height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: rgba(64, 158, 255, 0.1);
  color: #2f80ed;
  font-size: 12px;
  font-weight: 700;
}

.public-template-item-main {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.public-template-item-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
}

.public-template-item-score {
  font-size: 12px;
  color: var(--muted);
}

.public-template-item-desc {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
}

/* 角色职责 */
.public-roles-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
}

.public-role-card {
  padding: 14px;
}

.public-role-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.public-role-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex: 0 0 auto;
}

.public-role-name {
  font-size: 15px;
  font-weight: 700;
}

.public-role-desc {
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

/* 活动公告 */
.public-announcement {
  padding: 16px;
}

.public-announcement-content {
  font-size: 14px;
  line-height: 1.8;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.public-announcement-content :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
}

.public-announcement-content :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 8px 0;
}

.public-announcement-content :deep(th),
.public-announcement-content :deep(td) {
  border: 1px solid var(--line);
  padding: 6px 10px;
  font-size: 13px;
}

.public-announcement-content :deep(h1),
.public-announcement-content :deep(h2),
.public-announcement-content :deep(h3) {
  margin: 16px 0 8px;
  line-height: 1.4;
}

.public-announcement-content :deep(p) {
  margin: 6px 0;
}

.public-announcement-content :deep(ul),
.public-announcement-content :deep(ol) {
  padding-left: 20px;
  margin: 6px 0;
}

@media (max-width: 600px) {
  .public-table-desktop {
    display: none !important;
  }

  .public-template-mobile-list {
    display: grid;
    gap: 8px;
  }

  .public-search-bar {
    position: fixed;
    left: 50%;
    width: min(320px, calc(100vw - 36px));
    transform: translateX(-50%);
    bottom: calc(62px + env(safe-area-inset-bottom));
    z-index: 11;
    margin-bottom: 0;
  }

  .public-search-bar-spacer {
    display: block;
    height: 74px;
  }

  .public-group-header {
    margin-bottom: 8px;
  }

  .public-group-toggle {
    padding-right: 74px;
  }

  .public-qrcode-img {
    width: 56px;
    height: 56px;
  }

  .public-roles-grid {
    grid-template-columns: 1fr;
  }

  .public-students-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .public-student-card-wide {
    grid-column: 1 / -1;
  }

  .public-student-card {
    padding: 8px;
    min-height: 84px;
  }

  .public-student-name {
    font-size: 14px;
  }

  .public-student-role {
    font-size: 11px;
    padding: 2px 7px;
  }

  .public-student-meta,
  .public-student-desc {
    font-size: 11px;
  }
}

.public-search-bar-spacer {
  display: none;
}
</style>
