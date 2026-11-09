"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Lock, Play, AlertTriangle, CheckCircle2, RotateCcw } from "lucide-react";
import { advanceEvaluationSessionStatus } from "./actions";

interface SessionActionsProps {
  session: {
    id: string;
    status: string;
  };
  seasonClosed?: boolean;
  age: number;
  hasPrimaryEvent: boolean;
  hasEvaluator: boolean;
}

export function SessionActions({ session, seasonClosed, age, hasPrimaryEvent, hasEvaluator }: SessionActionsProps) {
  const [openModal, setOpenModal] = useState<"open" | "lock" | "setup" | null>(null);

  if (seasonClosed || session.status === "locked") {
    return <span className="text-xs font-mono text-slate-600 dark:text-slate-400">Locked Permanently</span>;
  }

  // Pop downward for higher age groups near table top to prevent overlapping header
  const isTopRow = age >= 14;
  const popoverPositionClass = isTopRow 
    ? "top-full mt-2" 
    : "bottom-full mb-2";

  return (
    <div className="relative inline-block text-left">
      {/* Action Trigger Buttons */}
      {session.status === "setup" && (
        <div className="flex flex-col items-end gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!hasPrimaryEvent || !hasEvaluator}
            onClick={() => setOpenModal(openModal === "open" ? null : "open")}
            className="h-7 text-xs border-border bg-background hover:bg-accent text-slate-700 dark:text-slate-200"
          >
            <Play className="h-3 w-3 mr-1 text-emerald-700 dark:text-emerald-400" /> Open Session
          </Button>
          {(!hasPrimaryEvent || !hasEvaluator) && (
            <span className="max-w-48 text-right text-[10px] text-muted-foreground">
              {!hasPrimaryEvent && !hasEvaluator
                ? "Schedule primary event and assign an evaluator"
                : !hasPrimaryEvent
                  ? "Schedule primary event first"
                  : "Assign at least one evaluator first"}
            </span>
          )}
        </div>
      )}

      {session.status === "open" && (
        <div className="flex flex-col items-end gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpenModal(openModal === "lock" ? null : "lock")}
            className="h-7 text-xs border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-800 dark:text-amber-300"
          >
            <Lock className="h-3 w-3 mr-1 text-amber-700 dark:text-amber-400" /> Lock Session
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpenModal(openModal === "setup" ? null : "setup")}
            className="h-7 text-xs"
          >
            <RotateCcw className="h-3 w-3 mr-1" /> Return to Setup
          </Button>
        </div>
      )}

      {/* Confirmation Modal for Opening Session */}
      {openModal === "open" && (
        <div className={`absolute ${popoverPositionClass} right-0 w-72 rounded-lg border border-border bg-background p-4 shadow-2xl z-50 text-left`}>
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 text-xs font-bold mb-1">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Open Age {age} Session?
          </div>
          <p className="text-[11px] text-slate-700 dark:text-slate-300 leading-normal mb-3">
            Are you ready to enable scoring for <span className="text-emerald-700 dark:text-emerald-400 font-semibold">League Age {age}</span>? This will make the session active for assigned evaluators.
          </p>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpenModal(null)}
              className="rounded border border-border bg-card px-3 py-1 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-accent transition-colors"
            >
              Cancel
            </button>
            <form action={advanceEvaluationSessionStatus} className="inline-block">
              <input type="hidden" name="sessionId" value={session.id} />
              <input type="hidden" name="status" value="open" />
              <button
                type="submit"
                className="rounded bg-emerald-600 hover:bg-emerald-500 px-3 py-1 text-xs font-medium text-foreground transition-colors"
              >
                Confirm Open
              </button>
            </form>
          </div>
        </div>
      )}


      {/* Safeguarded return-to-setup confirmation */}
      {openModal === "setup" && (
        <div className={`absolute ${popoverPositionClass} right-0 w-80 rounded-lg border border-border bg-background p-4 shadow-2xl z-50 text-left`}>
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 text-xs font-bold mb-1">
            <AlertTriangle className="h-4 w-4 shrink-0" /> Return Age {age} Session to Setup?
          </div>
          <p className="text-[11px] text-slate-700 dark:text-slate-300 leading-normal mb-3">
            This is available only when the session has no evaluation records. Existing event schedules and evaluator assignments are preserved. If any evaluation work exists, the server will refuse the change and nothing will be deleted.
          </p>
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setOpenModal(null)} className="rounded border border-border bg-card px-3 py-1 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-accent">Cancel</button>
            <form action={advanceEvaluationSessionStatus} className="inline-block">
              <input type="hidden" name="sessionId" value={session.id} />
              <input type="hidden" name="status" value="setup" />
              <button type="submit" className="rounded bg-amber-600 hover:bg-amber-500 px-3 py-1 text-xs font-medium text-white">Confirm Return to Setup</button>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Locking Session */}
      {openModal === "lock" && (
        <div className={`absolute ${popoverPositionClass} right-0 w-72 rounded-lg border border-border bg-background p-4 shadow-2xl z-50 text-left`}>
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 text-xs font-bold mb-1">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Lock Age {age} Session?
          </div>
          <p className="text-[11px] text-slate-700 dark:text-slate-300 leading-normal mb-3">
            Locking is permanent. Once locked, evaluators cannot enter or modify scores and{" "}
            <span className="text-amber-700 dark:text-amber-400 font-semibold">this session cannot be reopened</span>.
          </p>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpenModal(null)}
              className="rounded border border-border bg-card px-3 py-1 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-accent transition-colors"
            >
              Cancel
            </button>
            <form action={advanceEvaluationSessionStatus} className="inline-block">
              <input type="hidden" name="sessionId" value={session.id} />
              <input type="hidden" name="status" value="locked" />
              <button
                type="submit"
                className="rounded bg-amber-600 hover:bg-amber-500 px-3 py-1 text-xs font-medium text-foreground transition-colors"
              >
                Confirm Lock
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}