import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { api } from "../api";
import type { AuthUser } from "../types";

export const useAuthStore = defineStore("auth", () => {
  const token = ref(localStorage.getItem("score-system-token") || "");
  const user = ref<AuthUser | null>(null);
  const initialized = ref(false);

  const isJudge = computed(() => user.value?.role === "JUDGE" || user.value?.role === "SECRETARY");
  const currentActivityRole = computed(() => {
    const roles = user.value?.activityRoles || [];
    return roles.find((r) => r.activity?.isActive) ?? null;
  });

  async function login(username: string, password: string) {
    const { data } = await api.post("/api/auth/login", { username, password });
    token.value = data.token;
    localStorage.setItem("score-system-token", data.token);
    user.value = data.user;
    await fetchMe();
  }

  async function fetchMe() {
    if (!token.value) {
      initialized.value = true;
      return;
    }

    try {
      const { data } = await api.get("/api/auth/me");
      user.value = data;
    } catch {
      // token 失效或网络错误：清除本地凭证，让用户重新登录
      token.value = "";
      user.value = null;
      localStorage.removeItem("score-system-token");
    } finally {
      initialized.value = true;
    }
  }

  function logout() {
    token.value = "";
    user.value = null;
    localStorage.removeItem("score-system-token");
  }

  return { token, user, initialized, isJudge, currentActivityRole, login, fetchMe, logout };
});
