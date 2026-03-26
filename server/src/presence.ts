import type { UserRole } from "@prisma/client";

type PresenceRecord = {
  userId: string;
  username: string;
  role: UserRole;
  activityId?: string | null;
  groupId?: string | null;
  lastSeenAt: number;
};

const PRESENCE_TTL_MS = 30_000;
const presenceMap = new Map<string, PresenceRecord>();

function pruneExpired() {
  const now = Date.now();
  for (const [userId, record] of presenceMap.entries()) {
    if (now - record.lastSeenAt > PRESENCE_TTL_MS) {
      presenceMap.delete(userId);
    }
  }
}

export function touchPresence(input: Omit<PresenceRecord, "lastSeenAt">) {
  pruneExpired();
  presenceMap.set(input.userId, {
    ...input,
    lastSeenAt: Date.now(),
  });
}

export function removePresence(userId: string) {
  presenceMap.delete(userId);
}

export function getPresenceSnapshot() {
  pruneExpired();
  return Array.from(presenceMap.values());
}
