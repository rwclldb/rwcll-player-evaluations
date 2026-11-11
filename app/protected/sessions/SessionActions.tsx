"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Lock, Unlock, Play, AlertTriangle, CheckCircle2, RotateCcw, Send, EyeOff } from "lucide-react";
import { advanceEvaluationSessionStatus, changeSessionStage } from "./actions";

interface SessionActionsProps {
  session: {
    id: string | number;
    status: string;
  };
  released: boolean;
  seasonClosed?: boolean;
  age: number;
  hasPrimaryEvent: boolean;
  hasEvaluator: boolean;
  submittedCount: number;
  draftCount: number;
}

type Modal = "open" | "setup" | "lock" | "unlock" | "release" | "unrelease" | null;

export function SessionActions({
  session, released, seasonClosed, age, hasPrimaryEvent, hasEvaluator, submittedCount, draftCount,
}: SessionActionsProps) {
  const [modal, setModal] = useState<Modal>(null);
  const toggle = (m: Exclude<Modal, null>) => setModal(modal === m ? null : m);

  if (seasonClosed) {
    return <span className="text-xs text-muted-foreground">Season closed</span>;
  }

  const popover = age >= 14 ? "top-full mt-2" : "bottom-full mb-2";
  const actionButton = (m: Exclude<Modal, null>, label: string, icon: ReactNode, tone: string, disabled = false) => (
    <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => toggle(m)} className={`h-7 text-xs ${tone}`}>
      {icon} {label}
    </Button>
  );

  return (
    <div className="relative inline-block text-left">
      <div className="flex flex-col items-end gap-1">
        {session.status === "setup" && (
          <>
            {actionButton("open", "Open Session", <Play className="h-3 w-3 mr-1 text-emerald-700 dark:text-emerald-400" />, "", !hasPrimaryEvent || !hasEvaluator)}
            {(!hasPrimaryEvent || !hasEvaluator) && (
              <span className="max-w-48 text-right text-[10px] text-muted-foreground">
                {!hasPrimaryEvent && !hasEvaluator
                  ? "Schedule primary event and assign an evaluator"
                  : !hasPrimaryEvent
                    ? "Schedule primary event first"
                    : "Assign at least one evaluator first"}
              </span>
            )}
          </>
        )}

        {session.status === "open" && (
          <>
            {actionButton("lock", "Lock Scoring", <Lock className="h-3 w-3 mr-1" />, "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300")}
            {actionButton("setup", "Return to Setup", <RotateCcw className="h-3 w-3 mr-1" />, "")}
          </>
        )}

        {session.status === "locked" && !released && (
          <>
            {actionButton("release", "Release to Coaches", <Send className="h-3 w-3 mr-1" />, "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300")}
            {actionButton("unlock", "Unlock Scoring", <Unlock className="h-3 w-3 mr-1" />, "")}
          </>
        )}

        {session.status === "locked" && released && (
          actionButton("unrelease", "Unrelease", <EyeOff className="h-3 w-3 mr-1" />, "")
        )}
      </div>

      {modal && (
        <div className={`absolute ${popover} right-0 z-50 w-80 rounded-lg border border-border bg-background p-4 text-left shadow-2xl`}>
          {modal === "open" && (
            <Confirm title={`Open Age ${age} for scoring?`} tone="emerald" onCancel={() => setModal(null)} sessionId={session.id} kind="status" value="open" confirmLabel="Open Session">
              <li>Assigned coaches and evaluators can start scoring Age {age} players.</li>
              <li>The event schedule becomes read-only.</li>
              <li><strong>Undo:</strong> Return to Setup, as long as nobody has saved an evaluation yet.</li>
            </Confirm>
          )}

          {modal === "setup" && (
            <Confirm title={`Return Age ${age} to Setup?`} tone="amber" onCancel={() => setModal(null)} sessionId={session.id} kind="status" value="setup" confirmLabel="Return to Setup">
              <li>Scoring stops and you can edit the event schedule again.</li>
              <li>Only allowed if nobody has saved an evaluation. Otherwise the change is refused and nothing is deleted.</li>
            </Confirm>
          )}

          {modal === "lock" && (
            <Confirm title={`Lock Age ${age} scoring?`} tone="amber" onCancel={() => setModal(null)} sessionId={session.id} kind="stage" value="lock" confirmLabel="Lock Scoring">
              <li><strong>Step 1 of 2.</strong> Evaluators can no longer enter or change scores.</li>
              <li>Coaches <strong>still cannot</strong> see the draft report. You release it in step 2.</li>
              <li>
                {submittedCount} submitted evaluation{submittedCount === 1 ? "" : "s"} will count.
                {draftCount > 0 && (
                  <span className="text-amber-700 dark:text-amber-400"> {draftCount} unsubmitted draft{draftCount === 1 ? "" : "s"} will <strong>not</strong> count unless you unlock and the evaluator submits.</span>
                )}
              </li>
              <li><strong>Undo:</strong> Unlock Scoring (reason required).</li>
            </Confirm>
          )}

          {modal === "unlock" && (
            <Confirm title={`Unlock Age ${age} scoring?`} tone="amber" onCancel={() => setModal(null)} sessionId={session.id} kind="stage" value="unlock" confirmLabel="Unlock Scoring" needsReason>
              <li>Evaluators can enter and change scores again.</li>
              <li>Coaches still cannot see the draft report.</li>
              <li>This is recorded in the audit log with your reason.</li>
            </Confirm>
          )}

          {modal === "release" && (
            <Confirm title={`Release Age ${age} reports to coaches?`} tone="emerald" onCancel={() => setModal(null)} sessionId={session.id} kind="stage" value="release" confirmLabel="Release to Coaches">
              <li><strong>Step 2 of 2.</strong> Every coach can see the Age {age} draft report.</li>
              <li>The report shows coach averages, evaluator averages, and prior-year ratings in separate columns. Other coaches&apos; individual ratings and evaluator names stay hidden.</li>
              <li>Scores stay locked.</li>
              <li><strong>Undo:</strong> Unrelease (reason required). Coaches lose access immediately.</li>
            </Confirm>
          )}

          {modal === "unrelease" && (
            <Confirm title={`Unrelease Age ${age} reports?`} tone="amber" onCancel={() => setModal(null)} sessionId={session.id} kind="stage" value="unrelease" confirmLabel="Unrelease" needsReason>
              <li>Coaches immediately lose access to the Age {age} draft report.</li>
              <li>Scores stay locked. To change scores, unrelease first, then Unlock Scoring.</li>
              <li>This is recorded in the audit log with your reason.</li>
            </Confirm>
          )}
        </div>
      )}
    </div>
  );
}

function Confirm({
  title, tone, children, onCancel, sessionId, kind, value, confirmLabel, needsReason = false,
}: {
  title: string;
  tone: "emerald" | "amber";
  children: ReactNode;
  onCancel: () => void;
  sessionId: string | number;
  kind: "status" | "stage";
  value: string;
  confirmLabel: string;
  needsReason?: boolean;
}) {
  const color = tone === "emerald" ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400";
  const button = tone === "emerald" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-amber-600 hover:bg-amber-500";
  return (
    <form action={kind === "status" ? advanceEvaluationSessionStatus : changeSessionStage} className="space-y-3">
      <div className={`flex items-center gap-2 text-xs font-bold ${color}`}>
        {tone === "emerald" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
        {title}
      </div>
      <ul className="list-disc space-y-1 pl-4 text-[11px] leading-normal text-slate-700 dark:text-slate-300">{children}</ul>
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name={kind === "status" ? "status" : "stageAction"} value={value} />
      {needsReason && (
        <label className="block space-y-1 text-[11px] font-medium text-foreground">
          Reason (required)
          <textarea name="reason" required minLength={5} maxLength={1000} rows={2} className="w-full rounded border border-border bg-card p-2 text-xs" />
        </label>
      )}
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded border border-border bg-card px-3 py-1 text-xs font-medium text-slate-700 hover:bg-accent dark:text-slate-300">
          Cancel
        </button>
        <button type="submit" className={`rounded px-3 py-1 text-xs font-medium text-white ${button}`}>
          {confirmLabel}
        </button>
      </div>
    </form>
  );
}
