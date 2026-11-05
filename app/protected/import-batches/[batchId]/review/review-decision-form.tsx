"use client";

import { useState, useTransition } from "react";
import { saveImportRowReview, commitImportRow } from "../../review-actions";
import { useRouter } from "next/navigation";


type Candidate = { id: number; label: string };
const labels: Record<string, string> = {
  needs_review: "Needs review", ready_for_match_review: "Ready for match review", approved_new: "Approve as new player (decision only)", approved_match: "Approve match to existing player", ignored: "Ignore this row",
committed: "Committed (cannot change)",};

export function ReviewDecisionForm({ rowId, batchId, currentDecision, currentMatchedPlayerId, candidates, disabled }: {
  rowId: number; batchId: number; currentDecision: string; currentMatchedPlayerId: number | null; candidates: Candidate[]; disabled: boolean;
}) {
  const isCommitted = currentDecision === "committed";
  const [decision, setDecision] = useState(currentDecision);
  const [matchedPlayerId, setMatchedPlayerId] = useState(currentMatchedPlayerId ? String(currentMatchedPlayerId) : "");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const match = decision === "approved_match";
  const router = useRouter();
  const [commitReason, setCommitReason] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  function submit() {
    setMessage("");
    const data = new FormData();
    data.set("rowId", String(rowId)); data.set("batchId", String(batchId)); data.set("decision", decision);
    data.set("matchedPlayerId", match ? matchedPlayerId : ""); data.set("reason", reason);
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

  return <div className="flex flex-col gap-3 border-t pt-4">
    <h3 className="font-semibold">Review decision</h3>
    <label className="flex flex-col gap-1 text-sm">Decision<select className="rounded-md border bg-background p-2" value={decision} onChange={(e) => setDecision(e.target.value)} disabled={disabled || isPending}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    {match && <label className="flex flex-col gap-1 text-sm">Existing player (required)<select className="rounded-md border bg-background p-2" value={matchedPlayerId} onChange={(e) => setMatchedPlayerId(e.target.value)} disabled={disabled || isPending}><option value="">Choose a candidate — verify identity</option>{candidates.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>{candidates.length === 0 && <span className="text-amber-700">No suggestions available. Do not approve a match without verifying the player.</span>}</label>}
    <label className="flex flex-col gap-1 text-sm">Reason (required, 5–1,000 characters)<textarea className="min-h-20 rounded-md border bg-background p-2" minLength={5} maxLength={1000} required value={reason} onChange={(e) => setReason(e.target.value)} disabled={disabled || isPending} placeholder="Explain the evidence and why this decision is appropriate." /></label>
    <div className="flex flex-wrap items-center gap-3"><button type="button" className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50" onClick={submit} disabled={disabled || isPending || reason.trim().length < 5 || reason.length > 1000 || (match && !matchedPlayerId)}>{isPending ? "Saving…" : "Save decision"}</button><span aria-live="polite" role="status" className="text-sm">{message}</span></div>
    {(currentDecision === "approved_new" ||
  currentDecision === "approved_match") && (
  <section className="flex flex-col gap-3 rounded-lg border border-amber-500/50 p-4">
    <h3 className="font-semibold">Commit approved row</h3>
    <p className="text-sm">
      This is a separate, write operation. It creates the season registration
      and, for an approved new player, creates the player record. Confirm that
      the review decision and source data are correct before continuing.
    </p>

    <label className="flex flex-col gap-1 text-sm">
      Commit reason (required, 5–1,000 characters)
      <textarea
        className="min-h-20 rounded-md border bg-background p-2"
        minLength={5}
        maxLength={1000}
        required
        value={commitReason}
        onChange={(e) => setCommitReason(e.target.value)}
        disabled={disabled || isCommitted || isPending}
        placeholder="Explain why this approved row is ready to be committed."
      />
    </label>

    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        className="rounded-md border border-amber-600 px-4 py-2 disabled:opacity-50"
        onClick={submitCommit}
        disabled={
          disabled ||
          isPending ||
          commitReason.trim().length < 5 ||
          commitReason.trim().length > 1000
        }
      >
        {isPending ? "Processing…" : "Commit approved row"}
      </button>
      <span aria-live="polite" role="status" className="text-sm">
        {commitMessage}
      </span>
    </div>
  </section>
)}<p className="text-xs text-muted-foreground">Every successful save records a reason and audit entry. This does not create a player or registration. Verify name and birth date manually; IDs alone are not proof of identity.</p>
  </div>;
}
