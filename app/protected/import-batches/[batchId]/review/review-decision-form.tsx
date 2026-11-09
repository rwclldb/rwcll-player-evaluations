"use client";

import { useState, useTransition } from "react";
import { 
  saveImportRowReview, 
  commitImportRow, 
  resolveDuplicatePlayerIdWarning, 
  reopenIgnoredImportRow 
} from "../../review-actions";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  AlertTriangle, 
  CheckCircle2, 
  Loader2, 
  Lock, 
  RotateCcw, 
  UserCheck, 
  Save 
} from "lucide-react";

type Candidate = { id: number; label: string };

const labels: Record<string, string> = {
  needs_review: "Needs review",
  ready_for_match_review: "Ready for match review",
  approved_new: "Approve as new player (decision only)",
  approved_match: "Approve match to existing player",
  ignored: "Ignore this row",
  committed: "Committed (cannot change)",
};

export function ReviewDecisionForm({
  rowId,
  batchId,
  currentDecision,
  currentMatchedPlayerId,
  committedPlayerLabel,
  committedPlayerSeasonId,
  candidates,
  disabled,
  hasDuplicatePlayerIdFlag,
  duplicatePlayerIdResolvedAt,
  duplicatePlayerIdResolutionReason,
}: {
  rowId: number;
  batchId: number;
  currentDecision: string;
  currentMatchedPlayerId: number | null;
  committedPlayerLabel: string | null;
  committedPlayerSeasonId: number | null;
  candidates: Candidate[];
  disabled: boolean;
  hasDuplicatePlayerIdFlag: boolean;
  duplicatePlayerIdResolvedAt: string | null;
  duplicatePlayerIdResolutionReason: string | null;
}) {
  const isCommitted = currentDecision === "committed";
  const [decision, setDecision] = useState(currentDecision);
  const [matchedPlayerId, setMatchedPlayerId] = useState(
    currentMatchedPlayerId ? String(currentMatchedPlayerId) : ""
  );
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const match = decision === "approved_match";
  const router = useRouter();

  const [commitReason, setCommitReason] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [duplicateResolutionReason, setDuplicateResolutionReason] = useState("");
  const [duplicateResolutionMessage, setDuplicateResolutionMessage] = useState("");
  const duplicatePlayerIdResolved = Boolean(duplicatePlayerIdResolvedAt);
  const isIgnored = currentDecision === "ignored";
  const [reopenReason, setReopenReason] = useState("");
  const [reopenMessage, setReopenMessage] = useState("");

  function submit() {
    setMessage("");
    const data = new FormData();
    data.set("rowId", String(rowId));
    data.set("batchId", String(batchId));
    data.set("decision", decision);
    data.set("matchedPlayerId", match ? matchedPlayerId : "");
    data.set("reason", reason);

    startTransition(async () => {
      const result = await saveImportRowReview(data);
      setMessage(result.ok ? "Decision saved and audit entry recorded." : result.message);
      if (result.ok) setReason("");
    });
  }

  function submitCommit() {
    setCommitMessage("");
    const data = new FormData();
    data.set("rowId", String(rowId));
    data.set("batchId", String(batchId));
    data.set("reason", commitReason);

    startTransition(async () => {
      const result = await commitImportRow(data);
      if (!result.ok) {
        setCommitMessage(result.message);
        return;
      }
      setCommitMessage(
        result.alreadyCommitted
          ? `Already committed. Existing player registration #${result.playerSeasonId} was returned; no duplicate was created.`
          : `Committed successfully. Player registration #${result.playerSeasonId} was created.`
      );
      setCommitReason("");
      router.refresh();
    });
  }

  function submitReopen() {
    setReopenMessage("");
    const data = new FormData();
    data.set("rowId", String(rowId));
    data.set("batchId", String(batchId));
    data.set("reason", reopenReason);

    startTransition(async () => {
      const result = await reopenIgnoredImportRow(data);
      if (!result.ok) {
        setReopenMessage(result.message);
        return;
      }
      setReopenMessage("Row reopened. Audit entry recorded.");
      setReopenReason("");
      router.refresh();
    });
  }

  function submitDuplicateResolution() {
    setDuplicateResolutionMessage("");
    const data = new FormData();
    data.set("rowId", String(rowId));
    data.set("batchId", String(batchId));
    data.set("reason", duplicateResolutionReason);

    startTransition(async () => {
      const result = await resolveDuplicatePlayerIdWarning(data);
      if (!result.ok) {
        setDuplicateResolutionMessage(result.message);
        return;
      }
      setDuplicateResolutionMessage("Duplicate Player ID warning resolved and audit entry recorded.");
      setDuplicateResolutionReason("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4 border-t border-border pt-4">
      {/* Committed Registration Card */}
      {isCommitted && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 text-xs space-y-1">
          <h3 className="font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4 shrink-0" /> Commit Details
          </h3>
          <p className="text-slate-700 dark:text-slate-300">
            <span className="font-medium text-foreground">Player:</span>{" "}
            {committedPlayerLabel ?? "Could not load the linked player name"}
          </p>
          <p className="text-slate-700 dark:text-slate-300 font-mono">
            <span className="font-medium text-foreground">Season Registration ID:</span>{" "}
            {committedPlayerSeasonId ?? "—"}
          </p>
        </div>
      )}

      {/* Duplicate Player ID Warning Controls */}
      {hasDuplicatePlayerIdFlag && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-xs space-y-3">
          <h3 className="font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4 shrink-0" /> Duplicate Player ID Warning
          </h3>

          {duplicatePlayerIdResolved ? (
            <div className="space-y-1 text-slate-700 dark:text-slate-300">
              <p className="font-semibold text-emerald-700 dark:text-emerald-400">Explicitly Resolved</p>
              <p>Resolution reason: {duplicatePlayerIdResolutionReason || "Not available"}</p>
              <p className="text-[11px] text-muted-foreground italic">
                The original import warning is preserved. The resolution and audit entry are recorded separately.
              </p>
            </div>
          ) : (
            <>
              <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                This row has a duplicate Player ID warning from the uploaded file. Verify source rows and player identity before resolving it.
              </p>

              <div className="space-y-1">
                <label className="text-slate-700 dark:text-slate-300 font-semibold block">
                  Resolution Reason <span className="text-muted-foreground font-normal">(5–1,000 characters)</span>
                </label>
                <textarea
                  className="w-full min-h-20 rounded-md border border-border bg-background p-2.5 text-xs text-foreground placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
                  minLength={5}
                  maxLength={1000}
                  required
                  value={duplicateResolutionReason}
                  onChange={(e) => setDuplicateResolutionReason(e.target.value)}
                  disabled={disabled || isPending || isCommitted || isIgnored}
                  placeholder="Explain how you checked the duplicate ID and why it is safe to proceed."
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={submitDuplicateResolution}
                  disabled={
                    disabled ||
                    isPending ||
                    isCommitted ||
                    duplicateResolutionReason.trim().length < 5 ||
                    duplicateResolutionReason.trim().length > 1000
                  }
                  className="border-amber-500/40 bg-amber-500/20 text-amber-800 dark:text-amber-300 hover:bg-amber-500/30 text-xs"
                >
                  {isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
                  Resolve Duplicate Player ID Warning
                </Button>

                {duplicateResolutionMessage && (
                  <span className="text-xs font-mono text-emerald-700 dark:text-emerald-400">{duplicateResolutionMessage}</span>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Ignored Row Controls */}
      {isIgnored && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-xs space-y-3">
          <h3 className="font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
            <Lock className="h-4 w-4 shrink-0" /> Row Is Ignored
          </h3>
          <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
            Ignored rows cannot be changed through ordinary review. An administrator must explicitly reopen this row and record a reason.
          </p>

          <div className="space-y-1">
            <label className="text-slate-700 dark:text-slate-300 font-semibold block">
              Reopening Reason <span className="text-muted-foreground font-normal">(5–1,000 characters)</span>
            </label>
            <textarea
              className="w-full min-h-20 rounded-md border border-border bg-background p-2.5 text-xs text-foreground placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
              minLength={5}
              maxLength={1000}
              required
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
              disabled={disabled || isPending || isCommitted}
              placeholder="Explain why this row needs to be reviewed again."
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={submitReopen}
              disabled={
                disabled ||
                isPending ||
                isCommitted ||
                reopenReason.trim().length < 5 ||
                reopenReason.trim().length > 1000
              }
              className="border-amber-500/40 bg-amber-500/20 text-amber-800 dark:text-amber-300 hover:bg-amber-500/30 text-xs"
            >
              {isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5 mr-1.5" />}
              Reopen Ignored Row
            </Button>

            {reopenMessage && <span className="text-xs font-mono text-emerald-700 dark:text-emerald-400">{reopenMessage}</span>}
          </div>
        </div>
      )}

      {/* Review Decision Standard Form */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-foreground flex items-center gap-1.5">
          <UserCheck className="h-4 w-4 text-emerald-700 dark:text-emerald-400" /> Review Decision
        </h3>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">Decision</label>
          <select
            className="w-full rounded-md border border-border bg-background p-2 text-xs text-foreground focus:outline-none focus:border-emerald-500"
            value={decision}
            onChange={(e) => setDecision(e.target.value)}
            disabled={disabled || isPending || isCommitted || isIgnored}
          >
            {Object.entries(labels).map(([val, label]) => (
              <option key={val} value={val}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {match && (
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">
              Existing Player <span className="text-rose-700 dark:text-rose-400">*</span>
            </label>
            <select
              className="w-full rounded-md border border-border bg-background p-2 text-xs text-foreground focus:outline-none focus:border-emerald-500"
              value={matchedPlayerId}
              onChange={(e) => setMatchedPlayerId(e.target.value)}
              disabled={disabled || isPending || isCommitted || isIgnored}
            >
              <option value="">Choose a candidate — verify identity</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            {candidates.length === 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-400 font-mono italic mt-1">
                No suggestions available. Do not approve a match without verifying the player.
              </p>
            )}
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">
            Reason <span className="text-muted-foreground font-normal">(5–1,000 characters)</span>
          </label>
          <textarea
            className="w-full min-h-20 rounded-md border border-border bg-background p-2.5 text-xs text-foreground placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
            minLength={5}
            maxLength={1000}
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={disabled || isPending || isCommitted || isIgnored}
            placeholder="Explain the evidence and why this decision is appropriate."
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            size="sm"
            onClick={submit}
            disabled={
              disabled ||
              isPending ||
              isCommitted ||
              isIgnored ||
              reason.trim().length < 5 ||
              reason.length > 1000 ||
              (match && !matchedPlayerId)
            }
            className="bg-emerald-600 hover:bg-emerald-500 text-foreground text-xs"
          >
            {isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
            Save Decision
          </Button>

          {message && <span className="text-xs font-mono text-emerald-700 dark:text-emerald-400">{message}</span>}
        </div>
      </div>

      {/* Commit Approved Row Section */}
      {(currentDecision === "approved_new" || currentDecision === "approved_match") && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-xs space-y-3">
          <h3 className="font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4 shrink-0" /> Commit Approved Row
          </h3>
          <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
            This creates the season registration and, for an approved new player, creates the player record. Confirm review decision and source data before continuing.
          </p>

          <div className="space-y-1">
            <label className="text-slate-700 dark:text-slate-300 font-semibold block">
              Commit Reason <span className="text-muted-foreground font-normal">(5–1,000 characters)</span>
            </label>
            <textarea
              className="w-full min-h-20 rounded-md border border-border bg-background p-2.5 text-xs text-foreground placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
              minLength={5}
              maxLength={1000}
              required
              value={commitReason}
              onChange={(e) => setCommitReason(e.target.value)}
              disabled={disabled || isCommitted || isPending}
              placeholder="Explain why this approved row is ready to be committed."
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={submitCommit}
              disabled={
                disabled ||
                isPending ||
                commitReason.trim().length < 5 ||
                commitReason.trim().length > 1000
              }
              className="border-amber-500/40 bg-amber-500/20 text-amber-800 dark:text-amber-300 hover:bg-amber-500/30 text-xs"
            >
              {isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
              Commit Approved Row
            </Button>
            {commitMessage && <span className="text-xs font-mono text-emerald-700 dark:text-emerald-400">{commitMessage}</span>}
          </div>
        </div>
      )}

      <p className="text-xs font-mono text-slate-600 dark:text-slate-400">
        Every successful save records a reason and audit entry. This does not create a player or registration. Verify name and birth date manually; IDs alone are not proof of identity.
      </p>
    </div>
  );
}