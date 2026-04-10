<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  Calendar,
  DataBoard,
  Document,
  Files,
  Histogram,
  Management,
  Notebook,
  Operation,
  Position,
  SwitchButton,
  User,
  UserFilled,
  ChatLineSquare,
  Reading,
} from "@element-plus/icons-vue";
import { useAuthStore } from "../stores/auth";
import { useSyncStore } from "../stores/sync";

const props = defineProps<{
  title: string;
  subtitle?: string;
  mode: "admin" | "judge" | "public";
  votingMode?: boolean;
}>();

const auth = useAuthStore();
const sync = useSyncStore();
const router = useRouter();
const route = useRoute();
const logoUrl = "/api/assets/logo.svg";

const adminItems = computed(() => {
  const base = [
    { label: "看板", path: "/admin/dashboard", icon: DataBoard },
    { label: "活动", path: "/admin/activities", icon: Calendar },
    { label: "分组", path: "/admin/groups", icon: Files },
    { label: "学生", path: "/admin/students", icon: User },
    { label: "评委", path: "/admin/judges", icon: Management },
    { label: "角色", path: "/admin/roles", icon: UserFilled },
  ];
  if (!props.votingMode) {
    base.push({ label: "模板", path: "/admin/templates", icon: Notebook });
  }
  base.push(
    { label: "结果", path: "/admin/results", icon: Histogram },
    { label: "日志", path: "/admin/logs", icon: Document },
  );
  return base;
});

const judgeItems = computed(() => {
  const isVoting = (auth.currentActivityRole as any)?.activity?.type === "投票";
  if (isVoting) {
    return [
      { label: "主页", path: "/judge/home", icon: DataBoard },
      { label: "投票", path: "/judge/voting", icon: User },
      { label: "公告", path: "/judge/announcement", icon: ChatLineSquare },
      { label: "我的", path: "/judge/profile", icon: Management },
    ];
  }
  return [
    { label: "主页", path: "/judge/home", icon: DataBoard },
    { label: "现场评分", path: "/judge/students", icon: User },
    { label: "表格评分", path: "/judge/score", icon: Operation },
    { label: "公告", path: "/judge/announcement", icon: ChatLineSquare },
    { label: "我的", path: "/judge/profile", icon: Management },
  ];
});

const publicItems = [
  { label: "分组信息", path: "/public/groups", icon: Files },
  { label: "评分标准", path: "/public/scoring", icon: Notebook },
  { label: "角色职责", path: "/public/roles", icon: UserFilled },
  { label: "活动公告", path: "/public/announcement", icon: ChatLineSquare },
];

const items = computed(() => {
  if (props.mode === "admin") return adminItems.value;
  if (props.mode === "judge") return judgeItems.value;
  return publicItems;
});
const welcomeText = computed(() =>
  props.mode === "admin"
    ? `欢迎回来，${auth.user?.realName || auth.user?.username || "管理员"}`
    : `欢迎回来，${auth.user?.realName || auth.user?.username || "评委老师"}`,
);

async function logout() {
  await sync.disconnect();
  auth.logout();
  router.push("/login");
}

onMounted(() => {
  if (props.mode !== "public" && auth.token) sync.connect();
});

onUnmounted(() => {
  if (route.path === "/login") {
    sync.disconnect();
  }
});
</script>

<template>
  <div :class="['page-shell', mode === 'admin' ? 'page-shell-admin' : mode === 'public' ? 'page-shell-public' : 'page-shell-judge']">
    <section class="glass-panel topbar">
      <div class="topbar-logo">
        <img :src="logoUrl" alt="logo" class="topbar-logo-image" />
      </div>
      <div class="topbar-info">
        <template v-if="mode === 'public'">
          <div class="topbar-system-name">{{ sync.siteTitle }}</div>
        </template>
        <template v-else-if="mode === 'admin'">
          <div class="topbar-system-name">{{ sync.siteTitle }}</div>
        </template>
        <template v-else>
          <div class="topbar-welcome">{{ welcomeText }}</div>
          <div class="topbar-activity">
            <el-icon><Calendar /></el-icon>
            <span>{{ auth.currentActivityRole?.activity?.name || title }}</span>
          </div>
        </template>
      </div>
      <div class="topbar-exit">
        <template v-if="mode === 'public'">
          <el-button type="primary" size="small" plain :icon="Reading" @click="router.push('/login')">评委入口</el-button>
        </template>
        <template v-else-if="mode === 'admin'">
          <div class="topbar-admin-welcome">欢迎您，管理员</div>
        </template>
        <template v-else>
          <el-tag class="topbar-group-tag" type="success">
            <el-icon><Position /></el-icon>
            <span>{{ auth.currentActivityRole?.group?.name || subtitle || "全局管理" }}</span>
          </el-tag>
        </template>
        <div v-if="mode !== 'public'" class="topbar-actions">
          <slot name="extra" />
          <el-button class="topbar-exit-button" plain :icon="SwitchButton" @click="logout">退出</el-button>
        </div>
      </div>
    </section>

    <slot />

    <AppDock :items="items" />
  </div>
</template>

<script lang="ts">
import AppDock from "./AppDock.vue";

export default {
  components: { AppDock },
};
</script>
