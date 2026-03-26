import type { FastifyInstance } from "fastify";
import { prisma } from "./db.js";
import { removePresence, touchPresence, getPresenceSnapshot } from "./presence.js";
import type { AuthPayload } from "./types.js";

type ClientConnection = {
  socket: any;
  user: AuthPayload;
  activityId?: string | null;
  groupId?: string | null;
};

const clients = new Set<ClientConnection>();

// Public SSE: anonymous clients that receive refresh signals
const publicSseClients = new Set<any>();

export function addPublicSseClient(reply: any) {
  publicSseClients.add(reply);
}

export function removePublicSseClient(reply: any) {
  publicSseClients.delete(reply);
}

function notifyPublicClients(event: string) {
  for (const reply of publicSseClients) {
    try {
      reply.raw.write(`data: ${JSON.stringify({ type: event })}

`);
    } catch {
      publicSseClients.delete(reply);
    }
  }
}

export function registerWsRoute(app: FastifyInstance) {
  app.get("/ws", { websocket: true }, async (connection, request) => {
    const query = request.query as { token?: string; activityId?: string; groupId?: string };
    const token = query.token;
    if (!token) {
      connection.close();
      return;
    }

    try {
      const user = await request.server.jwt.verify<AuthPayload>(token);
      const client = { socket: connection, user, activityId: query.activityId ?? null, groupId: query.groupId ?? null };
      clients.add(client);
      touchPresence({
        userId: user.userId,
        username: user.username,
        role: user.role,
        activityId: query.activityId ?? null,
        groupId: query.groupId ?? null,
      });
      scheduleBroadcastOnlineSnapshot();

      connection.on("close", () => {
        clients.delete(client);
        removePresence(user.userId);
        scheduleBroadcastOnlineSnapshot();
      });

      connection.send(JSON.stringify({ type: "connected", payload: { userId: user.userId } }));
      void sendOnlineSnapshot(connection);
    } catch {
      connection.close();
    }
  });
}

export function broadcast(event: string, payload: unknown) {
  // Notify public SSE clients for relevant events
  notifyPublicClients(event);

  for (const client of clients) {
    const socket = client.socket;
    if (!socket) {
      clients.delete(client);
      continue;
    }

    try {
      if (socket.readyState === 1) {
        socket.send(JSON.stringify({ type: event, payload }));
      } else if (socket.readyState >= 2) {
        clients.delete(client);
      }
    } catch {
      clients.delete(client);
    }
  }
}

export function getOnlineStats() {
  const presence = getPresenceSnapshot();
  return {
    total: presence.length,
    judges: presence.filter((item) => item.role === "JUDGE").length,
    admins: presence.filter((item) => item.role === "SUPER_ADMIN" || item.role === "ACTIVITY_ADMIN").length,
    secretaries: presence.filter((item) => item.role === "SECRETARY").length,
  };
}

export function getOnlineUserIds() {
  return getPresenceSnapshot().map((p) => p.userId);
}

export async function getOnlineSnapshot() {
  const presence = getPresenceSnapshot();
  const onlineIds = presence.map((p) => p.userId);
  const users = onlineIds.length
    ? await prisma.user.findMany({
        where: { id: { in: onlineIds } },
        include: {
          activityRoles: {
            include: {
              activity: true,
              group: true,
              customRole: true,
            },
          },
        },
      })
    : [];

  const onlineUsers = users.map((user) => {
    const p = presence.find((x) => x.userId === user.id);
    const currentRole = p?.activityId
      ? user.activityRoles.find((item) => item.activityId === p.activityId)
      : null;
    return {
      id: user.id,
      username: user.username,
      realName: user.realName,
      role: user.role,
      activityId: p?.activityId || null,
      activityName: currentRole?.activity?.name || null,
      activityRole: currentRole?.role || null,
      customRoleId: currentRole?.customRoleId || null,
      customRoleName: currentRole?.customRole?.name || null,
      customRoleColor: currentRole?.customRole?.color || null,
      customRoleSortOrder: currentRole?.customRole?.sortOrder ?? null,
      groupId: p?.groupId || null,
      groupName: currentRole?.group?.name || null,
    };
  });

  return {
    total: onlineUsers.length,
    judges: onlineUsers.filter((item) => item.role === "JUDGE").length,
    admins: onlineUsers.filter((item) => item.role === "SUPER_ADMIN" || item.role === "ACTIVITY_ADMIN").length,
    secretaries: onlineUsers.filter((item) => item.role === "SECRETARY").length,
    users: onlineUsers,
  };
}

async function sendOnlineSnapshot(socket: any) {
  try {
    if (!socket || socket.readyState !== 1) return;
    const snapshot = await getOnlineSnapshot();
    socket.send(JSON.stringify({ type: "online.snapshot", payload: snapshot }));
  } catch {
    // ignore single socket push failures
  }
}

async function broadcastOnlineSnapshot() {
  const snapshot = await getOnlineSnapshot();
  broadcast("online.snapshot", snapshot);
}

// Debounced version: coalesce rapid connect/disconnect bursts into a single DB query
let _onlineSnapshotTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleBroadcastOnlineSnapshot() {
  if (_onlineSnapshotTimer) return;
  _onlineSnapshotTimer = setTimeout(() => {
    _onlineSnapshotTimer = null;
    void broadcastOnlineSnapshot();
  }, 300);
}
