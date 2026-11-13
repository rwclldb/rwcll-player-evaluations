import Link from "next/link";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, History, PencilLine } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { RatingInputs } from "@/app/protected/evaluations/rating-inputs";
import { saveCorrection } from "../actions";

type Params = Promise<{ evaluationId: string }>;
type SearchParams = Promise<{ message?: string; error?: string }>;
type Snapshot = { status?: string; ratings?: Record<string, number>; answers?: Record<string, string> };
type AuditRow = { id: number; actor_user_id: string | null; reason: string | null; before_data: Snapshot | null; after_data: Snapshot | null; created_at: string };

const EXPERIENCE_QUESTIONS = [
  { code: "pitched_before", label: "Has pitched before" },
  { code: "caught_before", label: "Has caught before" },
  { code: "interested_in_pitching", label: "Interested in pitching" },
  { code: "interested_in_catching", label: "Interested in catching" },
];
const STATUS_LABEL: Record<string, string> = { submitted: "Saved (counts)", not_evaluated: "Not evaluated", draft: "Draft (not counted)" };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

async function CorrectionContent({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { evaluationId } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (isAdmin !== true) redirect("/protected");

  const id = Number(evaluationId);
  if (!Number.isSafeInteger(id) || id < 1) notFound();
  const { data: evaluation } = await supabase.from("evaluations")
    .select("id, status, evaluator_user_id, evaluator_type, player_season_id, evaluation_session_id, submitted_at, updated_at")
    .eq("id", id).maybeSingle();
  if (!evaluation) notFound();

  const [{ data: session }, { data: registration }, { data: ratingData }, { data: answerData }, { data: categoryData }, { data: profileData }, { data: auditData }] =
    await Promise.all([
      supabase.from("evaluation_sessions").select("id, league_age, status, published_at, seasons(name, is_closed)").eq("id", evaluation.evaluation_session_id).maybeSingle(),
      supabase.from("player_seasons").select("evaluation_number, players(first_name, last_name)").eq("id", evaluation.player_season_id).maybeSingle(),
      supabase.from("ratings").select("rating_category_id, score").eq("evaluation_id", id),
      supabase.from("experience_answers").select("question_code, answer").eq("evaluation_id", id),
      supabase.from("rating_categories").select("id, code, name, category_group, sort_order").order("sort_order"),
      supabase.from("user_profiles").select("user_id, display_name"),
      supabase.from("audit_log").select("id, actor_user_id, reason, before_data, after_data, created_at")
        .eq("action", "evaluation_admin_corrected").eq("target_table", "evaluations").eq("target_id", String(id)).order("created_at", { ascending: false }),
    ]);
  const categories = categoryData ?? [];
  const nameOf = (userId: string | null) => (profileData ?? []).find((p) => p.user_id === userId)?.display_name?.trim() || "an admin";
  const skillName = (code: string) => categories.find((c) => c.code === code)?.name ?? code;
  const scores = Object.fromEntries((ratingData ?? []).map((r) => [categories.find((c) => c.id === r.rating_category_id)?.code ?? "", r.score]));
  const answers = Object.fromEntries((answerData ?? []).map((a) => [a.question_code, a.answer]));
  const s = session as unknown as { league_age: number | null; status: string; published_at: string | null; seasons: { name: string; is_closed: boolean } | null } | null;
  const reg = registration as unknown as { evaluation_number: number | null; players: { first_name: string; last_name: string } | null } | null;
  const closed = s?.seasons?.is_closed === true;
  const released = Boolean(s?.published_at);
  const history = (auditData ?? []) as AuditRow[];
  const scorer = nameOf(evaluation.evaluator_user_id);

  const changes = (h: AuditRow) => {
    const b = h.before_data ?? {}; const a = h.after_data ?? {};
    const codes = [...new Set([...Object.keys(b.ratings ?? {}), ...Object.keys(a.ratings ?? {})])];
    const parts = codes.filter((c) => b.ratings?.[c] !== a.ratings?.[c])
      .map((c) => `${skillName(c)} ${b.ratings?.[c] ?? "—"} → ${a.ratings?.[c] ?? "—"}`);
    if (b.status !== a.status) parts.unshift(`Status ${STATUS_LABEL[b.status ?? ""] ?? b.status} → ${STATUS_LABEL[a.status ?? ""] ?? a.status}`);
    const answerChanges = Object.keys({ ...(b.answers ?? {}), ...(a.answers ?? {}) }).filter((q) => b.answers?.[q] !== a.answers?.[q]).length;
    if (answerChanges) parts.push(`${answerChanges} experience answer(s)`);
    return parts.join("; ") || "No score changes";
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-col gap-3 border-b border-border pb-5">
        <Button asChild variant="ghost" size="sm" className="h-8 w-fit px-2 text-xs text-muted-foreground hover:text-foreground">
          <Link href="/protected/evaluation-review"><ArrowLeft className="mr-1 h-4 w-4" /> Data Review</Link>
        </Button>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
          <PencilLine className="h-6 w-6 text-emerald-700 dark:text-emerald-400" />
          {reg?.players ? `${reg.players.first_name} ${reg.players.last_name}` : "Player"}
          {reg?.evaluation_number != null && <span className="font-mono text-lg text-muted-foreground">#{reg.evaluation_number}</span>}
        </h1>
        <p className="text-sm text-muted-foreground">
          Scored by <b className="text-foreground">{scorer}</b> ({evaluation.evaluator_type === "coach" ? "coach" : "independent evaluator"})
          {" · "}{s?.seasons?.name} age {s?.league_age} · {STATUS_LABEL[evaluation.status] ?? evaluation.status}
          {" · "}last saved {when(evaluation.updated_at)}
        </p>
      </div>

      {sp.message && <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{sp.message}</div>}
      {sp.error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">{sp.error}</div>}

      {closed ? (
        <div role="status" className="rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">This season is closed, so scores can&apos;t be corrected. They are shown read-only.</div>
      ) : released ? (
        <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
          <b>This age group&apos;s draft report is released.</b> Coaches and evaluators can already see it, and a correction changes what they see right away.
        </div>
      ) : s?.status === "locked" ? (
        <div role="status" className="rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">Scoring is locked: the scorer can&apos;t change these any more, but your correction still applies.</div>
      ) : (
        <div role="status" className="rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">Scoring is open: the scorer can still change these too. The newest save wins.</div>
      )}

      <form action={saveCorrection} className="space-y-6 rounded-lg border border-border bg-card p-4">
        <input type="hidden" name="evaluationId" value={id} />
        <fieldset disabled={closed} className="space-y-6">
          <RatingInputs categories={categories} initialScores={Object.fromEntries(categories.map((c) => [c.code, scores[c.code] ?? null]))} />

          <div className="space-y-3 border-t border-border pt-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">Pitching and catching experience</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {EXPERIENCE_QUESTIONS.map((q) => (
                <div key={q.code} className="space-y-2 text-xs">
                  <span className="block font-semibold text-slate-700 dark:text-slate-300">{q.label}</span>
                  <div className="grid grid-cols-3 gap-2" role="group" aria-label={q.label}>
                    {[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }, { value: "unknown", label: "Not sure" }].map((o) => (
                      <label key={o.value} className="cursor-pointer">
                        <input type="radio" name={`experience_${q.code}`} value={o.value} defaultChecked={(answers[q.code] ?? "unknown") === o.value} className="peer sr-only" />
                        <span className="flex min-h-10 items-center justify-center rounded-md border border-border bg-card px-2 text-xs font-medium text-slate-700 hover:bg-accent peer-checked:border-emerald-500 peer-checked:bg-emerald-600 peer-checked:text-white dark:text-slate-300">
                          {o.label}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
            <fieldset className="space-y-2 text-sm">
              <legend className="mb-1 text-xs font-bold uppercase tracking-wider text-foreground">Status</legend>
              {["submitted", "not_evaluated", ...(evaluation.status === "draft" ? ["draft"] : [])].map((value) => (
                <label key={value} className="flex items-center gap-2">
                  <input type="radio" name="status" value={value} defaultChecked={evaluation.status === value} className="h-4 w-4" />
                  {STATUS_LABEL[value]}
                </label>
              ))}
              <p className="text-xs text-muted-foreground">Not evaluated clears every score.</p>
            </fieldset>
            <label className="text-sm font-medium text-foreground">Reason (required)
              <textarea name="reason" required minLength={5} rows={3} placeholder="For example: coach scored the wrong bib"
                className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-base text-foreground sm:text-sm" />
              <span className="mt-1 block text-xs font-normal text-muted-foreground">Recorded in the audit log with the before and after. The scorer is not notified.</span>
            </label>
          </div>
          <div className="flex justify-end">
            <Button type="submit" className="min-h-11">Save correction</Button>
          </div>
        </fieldset>
      </form>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground"><History className="h-4 w-4" /> Corrections</h2>
        {history.length === 0 ? <p className="text-sm text-muted-foreground">None. These are the scorer&apos;s own scores.</p> : (
          <ul className="space-y-2 text-xs">
            {history.map((h) => (
              <li key={h.id} className="rounded border border-border bg-card p-2">
                <p className="text-muted-foreground">{when(h.created_at)} · {nameOf(h.actor_user_id)}{h.reason ? ` · ${h.reason}` : ""}</p>
                <p className="mt-1 text-foreground">{changes(h)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function CorrectionPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 w-full animate-pulse rounded-lg border border-border bg-card" />}>
      <CorrectionContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
