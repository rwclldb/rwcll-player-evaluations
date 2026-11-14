// Scores saved on this phone or computer that haven't reached the server yet (no signal at the field).
// Kept in localStorage, one list per signed-in person, newest save per player. Sent by OfflineSync.

export type SavePayload = {
  sessionId: number;
  playerSeasonId: number;
  intent: "submitted" | "not_evaluated";
  ratings: Record<string, number>;
  answers: Record<string, string>;
  noteKind: "private" | "shared" | null;
  note: string | null;
};

export type QueuedSave = {
  key: string; // `${sessionId}:${playerSeasonId}`
  label: string; // "#204 Vale, Dakota (age 8)"
  payload: SavePayload;
  savedAt: string;
  /** Set when the server refused it (for example the age group was locked); it stays until sent or discarded. */
  error?: string;
  /** true when the refusal may pass on a later try (an expired sign-in), so it is retried automatically. */
  retryable?: boolean;
};

const EVENT = "rwcll-unsent-changed";
const storageKey = (userId: string) => `rwcll:unsent:v1:${userId}`;

export function readQueue(userId: string): QueuedSave[] {
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    const list = raw ? (JSON.parse(raw) as QueuedSave[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeQueue(userId: string, list: QueuedSave[]) {
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(list));
  } finally {
    window.dispatchEvent(new Event(EVENT));
  }
}

/** Add or replace this player's unsent save. Throws if the browser can't store it (private mode, storage full). */
export function enqueue(userId: string, item: Omit<QueuedSave, "key" | "savedAt">) {
  const key = `${item.payload.sessionId}:${item.payload.playerSeasonId}`;
  const list = readQueue(userId).filter((q) => q.key !== key);
  list.push({ ...item, key, savedAt: new Date().toISOString() });
  window.localStorage.setItem(storageKey(userId), JSON.stringify(list));
  window.dispatchEvent(new Event(EVENT));
}

export function removeFromQueue(userId: string, key: string) {
  writeQueue(userId, readQueue(userId).filter((q) => q.key !== key));
}

export function markQueueError(userId: string, key: string, error: string, retryable: boolean) {
  writeQueue(userId, readQueue(userId).map((q) => (q.key === key ? { ...q, error, retryable } : q)));
}

/** The raw stored list, for useSyncExternalStore (same string while nothing changes). */
export function queueSnapshot(userId: string): string {
  try {
    return window.localStorage.getItem(storageKey(userId)) ?? "[]";
  } catch {
    return "[]";
  }
}

/** Calls back whenever the queue changes in this tab or another tab. Returns an unsubscribe function. */
export function onQueueChange(callback: () => void) {
  const onStorage = (e: StorageEvent) => { if (e.key?.startsWith("rwcll:unsent:")) callback(); };
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", onStorage);
  };
}

/** A failed fetch (no signal) rather than an answer from the server. */
export function isNetworkError(error: unknown) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /fetch|network|load failed|connection|offline/i.test(message);
}
