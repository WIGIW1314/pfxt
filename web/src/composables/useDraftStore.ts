import { ref } from "vue";
import { useNetworkStore } from "../stores/network";

const DB_NAME = "pfxt-drafts";
const DB_VERSION = 1;
const STORE_NAME = "score-drafts";

interface DraftScore {
  id: string;          // local unique id
  activityId: string;
  studentId: string;
  judgeId: string;
  totalScore: number;
  comment: string;
  details: Record<string, number>;
  savedAt: number;     // timestamp
  synced: boolean;
}

let db: IDBDatabase | null = null;

async function openDB(): Promise<IDBDatabase> {
  if (db) return db;
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };
    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("activityId", "activityId", { unique: false });
        store.createIndex("studentId", "studentId", { unique: false });
        store.createIndex("savedAt", "savedAt", { unique: false });
        store.createIndex("synced", "synced", { unique: false });
      }
    };
  });
}

export function useDraftStore() {
  const network = useNetworkStore();
  const pendingDrafts = ref<number>(0);

  async function _countPending() {
    try {
      const database = await openDB();
      const tx = database.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const index = store.index("synced");
      const countReq = index.count(IDBKeyRange.only(false));
      return new Promise<number>((resolve) => {
        countReq.onsuccess = () => resolve(countReq.result);
        countReq.onerror = () => resolve(0);
      });
    } catch {
      return 0;
    }
  }

  async function refreshPendingCount() {
    pendingDrafts.value = await _countPending();
  }

  async function saveDraft(draft: Omit<DraftScore, "id" | "savedAt" | "synced">): Promise<string> {
    const database = await openDB();
    const id = `${draft.activityId}-${draft.studentId}-${Date.now()}`;
    const record: DraftScore = { ...draft, id, savedAt: Date.now(), synced: false };

    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(record);
      req.onsuccess = async () => {
        pendingDrafts.value = await _countPending();
        resolve(id);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function getDraft(activityId: string, studentId: string): Promise<DraftScore | null> {
    const database = await openDB();
    return new Promise((resolve) => {
      const tx = database.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const index = store.index("activityId");
      const req = index.getAll(IDBKeyRange.only(activityId));
      req.onsuccess = () => {
        const matches = (req.result as DraftScore[]).filter((d) => d.studentId === studentId);
        // Return most recent
        if (matches.length === 0) resolve(null);
        else resolve(matches.sort((a, b) => b.savedAt - a.savedAt)[0]);
      };
      req.onerror = () => resolve(null);
    });
  }

  async function deleteDraft(id: string) {
    const database = await openDB();
    return new Promise<void>((resolve) => {
      const tx = database.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = async () => {
        pendingDrafts.value = await _countPending();
        resolve();
      };
      req.onerror = () => resolve();
    });
  }

  async function getUnsyncedDrafts(): Promise<DraftScore[]> {
    const database = await openDB();
    return new Promise((resolve) => {
      const tx = database.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const index = store.index("synced");
      const req = index.getAll(IDBKeyRange.only(false));
      req.onsuccess = () => resolve(req.result as DraftScore[]);
      req.onerror = () => resolve([]);
    });
  }

  async function markSynced(id: string) {
    const database = await openDB();
    return new Promise<void>((resolve) => {
      const tx = database.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const record = getReq.result as DraftScore | undefined;
        if (record) {
          record.synced = true;
          store.put(record);
        }
      };
      getReq.onerror = () => resolve();
      tx.oncomplete = async () => {
        pendingDrafts.value = await _countPending();
        resolve();
      };
      tx.onerror = () => resolve();
    });
  }

  // Auto-sync when coming back online
  let syncTimer: ReturnType<typeof setTimeout> | null = null;
  async function trySyncDrafts() {
    if (!network.isOnline) return;
    const drafts = await getUnsyncedDrafts();
    if (drafts.length === 0) return;

    for (const draft of drafts) {
      try {
        // Submit draft score via API
        const { api } = await import("../api");
        await api.post(`/api/judge/students/${draft.studentId}/score`, {
          totalScore: draft.totalScore,
          comment: draft.comment,
          details: draft.details,
        }, { _skipGlobalError: true } as any);
        await markSynced(draft.id);
      } catch {
        // Will retry next time online
      }
    }
    await refreshPendingCount();
  }

  // Watch for coming online
  function startSyncListener() {
    window.addEventListener("online", () => {
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(trySyncDrafts, 2000); // Wait 2s for connection to stabilize
    });
  }

  function stopSyncListener() {
    if (syncTimer) clearTimeout(syncTimer);
  }

  // Initialize count on creation
  refreshPendingCount();

  return {
    pendingDrafts,
    saveDraft,
    getDraft,
    deleteDraft,
    getUnsyncedDrafts,
    markSynced,
    trySyncDrafts,
    startSyncListener,
    stopSyncListener,
    refreshPendingCount,
  };
}
