"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CloudOff, RefreshCw } from "lucide-react";
import { saveScores } from "@/app/protected/evaluations/actions";
import {
  isNetworkError, markQueueError, onQueueChange, queueSnapshot, readQueue, removeFromQueue, type QueuedSave,
} from "@/lib/offline-queue";

/** This person's unsent saves, updated live (this tab, other tabs). */
export function useUnsent(userId: string): QueuedSave[] {
  const raw = useSyncExternalStore(onQueueChange, () => queueSnapshot(userId), () => "[]");
  return useMemo(() => {
    try {
      const list = JSON.parse(raw) as QueuedSave[];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }, [raw]);
}

/** Whether the browser thinks it has a connection. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb);
      window.addEventListener("offline", cb);
      return () => { window.removeEventListener("online", cb); window.removeEventListener("offline", cb); };
    },
    () => navigator.onLine,
    () => true,
  );
}

/** Sends unsent saves, one at a time. Stops at the first network failure. Returns how many were sent. */
export async function sendQueued(userId: string, items: QueuedSave[], includeRefused: boolean): Promise<number> {
  let sent = 0;
  for (const item of items) {
    if (item.error && !item.retryable && !includeRefused) continue;
    try {
      const result = await saveScores(item.payload);
      if (result.ok) { removeFromQueue(userId, item.key); sent++; }
      else markQueueError(userId, item.key, result.error, result.retry);
    } catch (error) {
      if (isNetworkError(error)) break;
      markQueueError(userId, item.key, error instanceof Error ? error.message : "Could not send.", true);
    }
  }
  return sent;
}

// Header badge plus the background sender. Shown only while something is waiting to be sent.
export function OfflineStatus({ userId }: { userId: string }) {
  const items = useUnsent(userId);
  const online = useOnline();
  const [sending, setSending] = useState(false);
  const busy = useRef(false);

  const send = useCallback(async (includeRefused: boolean) => {
    if (busy.current || !navigator.onLine) return;
    busy.current = true;
    setSending(true);
    try {
      await sendQueued(userId, readQueue(userId), includeRefused);
    } finally {
      busy.current = false;
      setSending(false);
    }
  }, [userId]);

  // Try when the connection comes back, when something new is queued, and every 15 seconds while anything waits.
  const pending = items.some((i) => !i.error || i.retryable);
  useEffect(() => {
    if (!pending || !online) return;
    const first = setTimeout(() => void send(false), 500);
    const timer = setInterval(() => void send(false), 15000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [pending, online, send]);

  if (items.length === 0) return null;
  const refused = items.filter((i) => i.error && !i.retryable);
  return (
    <details className="relative">
      <summary className={`flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold ${
        refused.length ? "bg-rose-600 text-white" : "bg-amber-500 text-black"}`}
        title="Scores saved on this device that haven't reached the league's system yet">
        {sending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CloudOff className="h-4 w-4" />}
        {items.length} not sent
      </summary>
      <div className="absolute right-0 z-50 mt-1 w-80 max-w-[calc(100vw-2rem)] space-y-2 rounded-lg border border-border bg-card p-3 text-sm text-foreground shadow-lg">
        <p className="text-xs text-muted-foreground">
          {online ? "These scores are saved on this device and are being sent." : "No signal. These scores are saved on this device and will be sent automatically when you're back online."}
          {" "}Don&apos;t clear this browser&apos;s data or sign out until they&apos;re sent.
        </p>
        <ul className="max-h-60 space-y-1.5 overflow-y-auto">
          {items.map((i) => (
            <li key={i.key} className="rounded border border-border p-2">
              <span className="block font-medium">{i.label}</span>
              <span className="block text-xs text-muted-foreground">
                {i.payload.intent === "not_evaluated" ? "Not evaluated" : "Scores"} saved {new Date(i.savedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </span>
              {i.error && <span className="block text-xs text-rose-700 dark:text-rose-300">{i.error}</span>}
              {i.error && !i.retryable && (
                <button type="button" className="mt-1 text-xs text-muted-foreground underline"
                  onClick={() => { if (window.confirm(`Throw away the unsent scores for ${i.label}? This can't be undone.`)) removeFromQueue(userId, i.key); }}>
                  Discard
                </button>
              )}
            </li>
          ))}
        </ul>
        <button type="button" disabled={!online || sending} onClick={() => void send(true)}
          className="h-10 w-full rounded-md bg-emerald-600 font-medium text-white disabled:opacity-50">
          {sending ? "Sending…" : online ? "Send now" : "Waiting for signal"}
        </button>
      </div>
    </details>
  );
}
