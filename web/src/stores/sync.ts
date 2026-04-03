import { ref } from "vue";
import { defineStore } from "pinia";
import { useAuthStore } from "./auth";
import { API_BASE } from "../api";

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

  async function fetchSiteTitle() {
    try {
      const res = await fetch(`${API_BASE}/api/meta/active-title`);
      if (res.ok) {
        const data = await res.json();
        siteTitle.value = data.title || "线上评分系统";
      }
    } catch {
      // keep default title on network error
    }
  }

  async function pingPresence() {
    const auth = useAuthStore();
    if (!auth.token) return;
    try {
      await fetch(`${API_BASE}/api/presence/ping`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
        },
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
    if (!auth.token) return;
    try {
      await fetch(`${API_BASE}/api/presence/offline`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.token}`,
        },
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
    if (!auth.token || socket) return;
    shouldReconnect = true;
    const wsBase = API_BASE.replace(/^http/, "ws");
    const params = new URLSearchParams({
      token: auth.token,
      activityId: auth.currentActivityRole?.activityId || "",
      groupId: auth.currentActivityRole?.groupId || "",
    });
    socket = new WebSocket(`${wsBase}/ws?${params.toString()}`);
    pingPresence();
    if (heartbeatTimer) {
      window.clearInterval(heartbeatTimer);
    }
    heartbeatTimer = window.setInterval(pingPresence, 10_000);
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
        window.setTimeout(connect, 1500);
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
