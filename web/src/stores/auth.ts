import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { api } from "../api";
import type { AuthUser } from "../types";

export const useAuthStore = defineStore("auth", () => {
  const user = ref<AuthUser | null>(null);
  const initialized = ref(false);

  const token = computed(() => Boolean(user.value));

  const isJudge = computed(() => user.value?.role === "JUDGE" || user.value?.role === "SECRETARY");
  const currentActivityRole = computed(() => {
    const roles = user.value?.activityRoles || [];
    return roles.find((r) => r.activity?.isActive) ?? null;
  });

  async function login(username: string, password: string) {
    const { data } = await api.post("/api/auth/login", { username, password });
    user.value = data.user;
    await fetchMe();
  }

  async function fetchMe() {
    try {
      const { data } = await api.get("/api/auth/me");
      user.value = data;
    } catch {
      user.value = null;
    } finally {
      initialized.value = true;
    }
  }

  function logout() {
    user.value = null;
    // Tell the server to clear the httpOnly cookie
    api.post("/api/auth/logout").catch(() => {});
  }

  return { token, user, initialized, isJudge, currentActivityRole, login, fetchMe, logout };
});
