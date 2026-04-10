import { ref } from "vue";
import { defineStore } from "pinia";
import { useAuthStore } from "./auth";
import { API_BASE, cachedGet } from "../api";

export const useSyncStore = defineStore("sync", () => {
  const version = ref(0);
  const events = ref<string[]>([]);
  const latestEvent = ref<{ type: string; payload: any } | null>(null);
  const siteTitle = ref("线上评分系统");
  const onlineSnapshot = ref<{
    total: number;
    judges: number;
    admins: number;
    secretaries: number;
    users: Array<{
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
    }>;
  } | null>(null);
  let socket: WebSocket | null = null;
  let heartbeatTimer: number | null = null;
  let shouldReconnect = true;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_DELAY = 30_000;

  async function fetchSiteTitle() {
    try {
      const data = await cachedGet<{ title?: string }>("/api/meta/active-title", 60_000);
      siteTitle.value = data.title || "线上评分系统";
    } catch {
      // keep default title on network error
    }
  }

  async function pingPresence() {
    const auth = useAuthStore();
    if (!auth.user) return;
    try {
      await fetch(`${API_BASE}/api/presence/ping`, {
        method: "POST",
        credentials: "include", // Send httpOnly cookie
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activityId: auth.currentActivityRole?.activityId || null,
          groupId: auth.currentActivityRole?.groupId || null,
        }),
      });
    } catch {
      // keep silent; next heartbeat will retry
    }
  }

  async function markOffline() {
    const auth = useAuthStore();
    if (!auth.user) return;
    try {
      await fetch(`${API_BASE}/api/presence/offline`, {
        method: "POST",
        credentials: "include", // Send httpOnly cookie
        keepalive: true,
      });
    } catch {
      // ignore logout/offline race
    }
  }

  function reconnect() {
    if (socket) {
      shouldReconnect = false;
      socket.close();
      socket = null;
    }
    if (heartbeatTimer) {
      window.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    connect();
  }

  function connect() {
    const auth = useAuthStore();
    if (!auth.user || socket) return;
    shouldReconnect = true;
    const wsBase = API_BASE.replace(/^http/, "ws");
    const params = new URLSearchParams({
      activityId: auth.currentActivityRole?.activityId || "",
      groupId: auth.currentActivityRole?.groupId || "",
    });
    // Cookie (httpOnly) is sent automatically by the browser
    socket = new WebSocket(`${wsBase}/ws?${params.toString()}`);
    reconnectAttempts = 0; // Reset backoff on successful connection attempt
    pingPresence();
    if (heartbeatTimer) {
      window.clearInterval(heartbeatTimer);
    }
    // 30s heartbeat interval reduces unnecessary requests (was 10s)
    heartbeatTimer = window.setInterval(pingPresence, 30_000);
    socket.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      latestEvent.value = payload;
      if (payload.type === "online.snapshot") {
        onlineSnapshot.value = payload.payload;
      }
      events.value.unshift(payload.type);
      events.value = events.value.slice(0, 10);
      version.value += 1;
    };
    socket.onclose = () => {
      socket = null;
      if (shouldReconnect) {
        // Exponential backoff: 1.5s, 3s, 6s, 12s, 24s, 30s (max)
        reconnectAttempts++;
        const delay = Math.min(1500 * Math.pow(2, reconnectAttempts - 1), MAX_RECONNECT_DELAY);
        window.setTimeout(connect, delay);
      }
    };
  }

  async function disconnect() {
    shouldReconnect = false;
    if (heartbeatTimer) {
      window.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    await markOffline();
    socket?.close();
    socket = null;
  }

  return { version, events, latestEvent, siteTitle, onlineSnapshot, connect, disconnect, reconnect, fetchSiteTitle };
});
