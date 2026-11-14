"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, CloudOff, History, Lock, MessageSquare, Search, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CoachKidBadge } from "@/components/coach-kid-badge";
import { useOnline, useUnsent } from "@/components/offline-sync";
import { enqueue, isNetworkError, removeFromQueue, type SavePayload } from "@/lib/offline-queue";
import { saveScores } from "./actions";
import { RatingInputs } from "./rating-inputs";

// The scoring screen for one age group. Everything (players, your scores, notes) is loaded once, so moving between
// players and saving work with no signal: saves that can't be sent are kept on this device and sent later.

export type ScoringCategory = { id: number; code: string; name: string; category_group: string; sort_order: number };
export type ScoringPlayer = { id: number; bib: number | null; name: string; leagueAge: number; birthDate: string | null; coachKid: boolean; here: boolean };
export type MyScores = { status: string; scores: Record<string, number>; answers: Record<string, string> };
export type PriorYear = { prior_overall: number | null; prior_ratings: number; prior_skills: Record<string, number> };

const CORE = ["hitting", "throwing", "grounders", "fly_balls", "running_awareness"];
const EXPERIENCE_QUESTIONS = [
  { code: "pitched_before", label: "Has pitched before" },
  { code: "caught_before", label: "Has caught before" },
  { code: "interested_in_pitching", label: "Interested in pitching" },
  { code: "interested_in_catching", label: "Interested in catching" },
] as const;
const PRIOR_SKILLS: [string, string][] = [
  ["hitting", "Hitting"], ["throwing", "Throwing"], ["grounders", "Grounders"], ["fly_balls", "Fly Balls"],
  ["running_awareness", "Running"], ["pitching", "Pitching"], ["catching", "Catching"],
];
const SAVED_TEXT = {
  submitted: "Saved. You can still change it until the session is locked.",
  not_evaluated: "Marked Not Evaluated. Any ratings for this player were cleared.",
} as const;
const OFFLINE_TEXT = "Saved on this phone (no signal). It will be sent automatically.";

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  submitted: { label: "Saved", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  draft: { label: "Draft (not counted)", className: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  not_evaluated: { label: "Not evaluated", className: "bg-slate-500/15 text-slate-700 dark:text-slate-300" },
  queued: { label: "On phone (not sent)", className: "bg-amber-500/20 text-amber-900 dark:text-amber-200" },
  refused: { label: "Not sent: see the red badge", className: "bg-rose-500/15 text-rose-700 dark:text-rose-300" },
  none: { label: "Not started", className: "bg-muted text-muted-foreground" },
};
function StatusChip({ status }: { status?: string }) {
  const s = STATUS_STYLE[status ?? "none"] ?? STATUS_STYLE.none;
  return <span className={`inline-block whitespace-nowrap rounded px-2 py-0.5 text-[11px] font-semibold ${s.className}`}>{s.label}</span>;
}
const bibLabel = (p: ScoringPlayer) => (p.bib === null ? "No bib" : `#${p.bib}`);

type Notice = { text: string; tone: "ok" | "offline" | "error" };

export function ScoringSession(props: {
  userId: string;
  sessionId: number;
  ageLabel: string;
  categories: ScoringCategory[];
  players: ScoringPlayer[];
  mine: Record<number, MyScores>;
  notes: Record<number, string>;
  prior: Record<number, PriorYear>;
  noteKind: "private" | "shared" | null;
  initialPlayerId: number | null;
  /** Server-rendered schedule, shown on the player list. */
  children?: ReactNode;
}) {
  const { userId, sessionId, categories, players, noteKind } = props;
  const [current, setCurrent] = useState<number | null>(props.initialPlayerId);
  const [mine, setMine] = useState(props.mine);
  const [notes, setNotes] = useState(props.notes);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [version, setVersion] = useState(0); // rebuilds the form after a save
  const [busy, setBusy] = useState(false);
  const dirty = useRef(false);
  const online = useOnline();

  // Saves still on this device override what the server sent (they are newer).
  const unsent = useUnsent(userId);
  const queuedHere = useMemo(() => new Map(unsent.filter((q) => q.payload.sessionId === sessionId).map((q) => [q.payload.playerSeasonId, q])), [unsent, sessionId]);
  const statusOf = useCallback((id: number) => {
    const q = queuedHere.get(id);
    if (q) return q.error && !q.retryable ? "refused" : "queued";
    return mine[id]?.status;
  }, [queuedHere, mine]);
  const scoresOf = (id: number): MyScores | undefined => {
    const q = queuedHere.get(id);
    return q ? { status: q.payload.intent, scores: q.payload.ratings, answers: q.payload.answers } : mine[id];
  };
  const noteOf = (id: number) => {
    const q = queuedHere.get(id);
    return q && q.payload.note !== null ? q.payload.note : notes[id] ?? "";
  };

  const url = (id: number | null) => `/protected/evaluations?sessionId=${sessionId}${id ? `&player=${id}` : ""}`;
  const go = useCallback((id: number | null, opts: { force?: boolean; notice?: Notice | null } = {}) => {
    if (!opts.force && dirty.current && !window.confirm("You have changes that are not saved. Leave this player without saving?")) return;
    dirty.current = false;
    setCurrent(id);
    setNotice(opts.notice ?? null);
    window.history.pushState(null, "", url(id));
    window.scrollTo({ top: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Browser back/forward.
  useEffect(() => {
    const onPop = () => {
      const p = Number(new URLSearchParams(window.location.search).get("player"));
      dirty.current = false;
      setCurrent(Number.isSafeInteger(p) && p > 0 ? p : null);
      setNotice(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Warn before closing the tab with unsaved taps.
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => { if (dirty.current) { e.preventDefault(); } };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  const index = players.findIndex((p) => p.id === current);
  const player = index >= 0 ? players[index] : undefined;
  const previous = index > 0 ? players[index - 1] : undefined;
  const next = index >= 0 && index < players.length - 1 ? players[index + 1] : undefined;
  const done = players.filter((p) => { const s = statusOf(p.id); return s === "submitted" || s === "not_evaluated" || s === "queued"; }).length;
  const hereCount = players.filter((p) => p.here).length;
  const queuedCount = queuedHere.size;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!player || busy) return;
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const choice = submitter?.value ?? "submitted";
    const intent: SavePayload["intent"] = choice === "not_evaluated" ? "not_evaluated" : "submitted";
    const goNext = choice === "submitted_next" && next;
    const form = new FormData(e.currentTarget);
    const ratings: Record<string, number> = {};
    for (const c of categories) {
      const v = String(form.get(`rating_${c.code}`) ?? "");
      if (v) ratings[c.code] = Number(v);
    }
    if (intent === "submitted" && !CORE.some((c) => ratings[c])) {
      setNotice({ text: "Rate at least one core skill (hitting, throwing, grounders, fly balls, running) before saving, or use Not Evaluated.", tone: "error" });
      return;
    }
    const answers = Object.fromEntries(EXPERIENCE_QUESTIONS.map((q) => [q.code, String(form.get(`experience_${q.code}`) ?? "unknown")]));
    const payload: SavePayload = {
      sessionId, playerSeasonId: player.id, intent,
      ratings: intent === "not_evaluated" ? {} : ratings, answers,
      noteKind, note: noteKind ? String(form.get("note") ?? "") : null,
    };
    const label = `${bibLabel(player)} ${player.name} (age ${player.leagueAge})`;

    const keepOnPhone = (error?: string): Notice | null => {
      try {
        enqueue(userId, { label, payload, ...(error ? { error, retryable: true } : {}) });
        return { text: error ? `${error}` : OFFLINE_TEXT, tone: "offline" };
      } catch {
        return null;
      }
    };
    const after = (n: Notice) => {
      setMine((m) => ({ ...m, [player.id]: { status: intent, scores: payload.ratings, answers } }));
      if (noteKind) setNotes((all) => ({ ...all, [player.id]: payload.note ?? "" }));
      dirty.current = false;
      if (goNext) go(next.id, { force: true, notice: { ...n, text: `${n.text} Showing the next player.` } });
      else { setNotice(n); setVersion((v) => v + 1); }
    };

    setBusy(true);
    try {
      if (!navigator.onLine) {
        const n = keepOnPhone();
        if (n) after(n);
        else setNotice({ text: "No signal, and this browser can't store the scores (private browsing?). Write them down and try again later.", tone: "error" });
        return;
      }
      let result;
      try {
        result = await saveScores(payload);
      } catch (error) {
        if (!isNetworkError(error)) throw error;
        const n = keepOnPhone();
        if (n) after(n);
        else setNotice({ text: "No signal, and this browser can't store the scores. Write them down and try again later.", tone: "error" });
        return;
      }
      if (result.ok) {
        removeFromQueue(userId, `${sessionId}:${player.id}`); // an older unsent save for this player is now replaced
        after({ text: SAVED_TEXT[intent], tone: "ok" });
      } else if (result.retry) {
        const n = keepOnPhone(result.error);
        if (n) after(n); else setNotice({ text: result.error, tone: "error" });
      } else {
        setNotice({ text: result.error, tone: "error" });
      }
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : "Could not save.", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  const noticeBox = notice && (
    <div role={notice.tone === "error" ? "alert" : "status"} className={`rounded-lg border p-3 text-sm ${
      notice.tone === "ok" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : notice.tone === "offline" ? "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200"
      : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"}`}>
      {notice.text}
    </div>
  );
  const offlineBanner = (!online || queuedCount > 0) && (
    <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
      <CloudOff className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        {!online
          ? "No signal. Keep scoring: saves stay on this phone. Don't refresh this page until you're back online."
          : `Sending ${queuedCount} saved score${queuedCount === 1 ? "" : "s"} from this phone…`}
      </span>
    </p>
  );
  const navLink = (target: ScoringPlayer | null, className: string, content: ReactNode) => (
    <a href={url(target?.id ?? null)} className={className} onClick={(e) => { e.preventDefault(); go(target?.id ?? null); }}>{content}</a>
  );
  const navBar = (position: string) => player && (
    <div className="grid grid-cols-3 items-center gap-2" aria-label={`Player navigation ${position}`}>
      {previous ? navLink(previous, "inline-flex min-h-11 items-center justify-center gap-1 rounded-md border border-border bg-card px-2 text-sm font-medium hover:bg-accent",
        <><ChevronLeft className="h-4 w-4" /> {bibLabel(previous)}</>) : <span />}
      {navLink(null, "inline-flex min-h-11 items-center justify-center rounded-md px-2 text-sm text-muted-foreground hover:text-foreground", "All players")}
      {next ? navLink(next, "inline-flex min-h-11 items-center justify-center gap-1 rounded-md border border-emerald-600 bg-emerald-600 px-2 text-sm font-semibold text-white hover:bg-emerald-500",
        <>Next {bibLabel(next)} <ChevronRight className="h-4 w-4" /></>) : <span className="text-center text-xs text-muted-foreground">Last player</span>}
    </div>
  );

  // ===== One player =====
  if (player) {
    const saved = scoresOf(player.id);
    const prior = props.prior[player.id];
    return (
      <div className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-6">
        {navBar("top")}
        {offlineBanner}
        {noticeBox}
        <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
          <div>
            <p className="font-mono text-3xl font-bold text-foreground">{bibLabel(player)}</p>
            <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold text-foreground">
              {player.name}{player.coachKid && <CoachKidBadge />}
              {player.here && <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">Here</span>}
            </h2>
            <p className="text-xs text-muted-foreground">
              LL age {player.leagueAge}{player.birthDate ? ` · born ${player.birthDate}` : ""} · player {index + 1} of {players.length}
            </p>
          </div>
          <StatusChip status={statusOf(player.id)} />
        </div>

        {prior && (
          <section className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3 text-xs" aria-label="Prior-year ratings">
            <p className="mb-1 flex items-center gap-1 font-semibold text-sky-800 dark:text-sky-300">
              <History className="h-3.5 w-3.5" /> Prior-year coach rating: {prior.prior_overall === null ? "—" : Number(prior.prior_overall).toFixed(2)}
              <span className="font-normal text-muted-foreground">({prior.prior_ratings} rating{prior.prior_ratings === 1 ? "" : "s"})</span>
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
              {PRIOR_SKILLS.filter(([c]) => prior.prior_skills?.[c] !== undefined).map(([c, l]) => (
                <span key={c}>{l} <strong className="font-mono text-foreground">{Number(prior.prior_skills[c]).toFixed(1)}</strong></span>
              ))}
            </div>
          </section>
        )}

        {/* key: a fresh form for each player and after each save, so nothing carries over between players. */}
        <form key={`${player.id}|${version}`} id="evaluation-form" onSubmit={onSubmit} className="space-y-6"
          onChange={() => { dirty.current = true; }} onInput={() => { dirty.current = true; }}>
          <RatingInputs categories={categories} initialScores={Object.fromEntries(categories.map((c) => [c.code, saved?.scores[c.code] ?? null]))} />

          <div className="space-y-3 border-t border-border pt-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">Pitching and catching experience</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {EXPERIENCE_QUESTIONS.map((q) => (
                <div key={q.code} className="space-y-2 text-xs">
                  <span className="block font-semibold text-slate-700 dark:text-slate-300">{q.label}</span>
                  <div className="grid grid-cols-3 gap-2" role="group" aria-label={q.label}>
                    {[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }, { value: "unknown", label: "Not sure" }].map((o) => (
                      <label key={o.value} className="cursor-pointer">
                        <input type="radio" name={`experience_${q.code}`} value={o.value} defaultChecked={(saved?.answers[q.code] ?? "unknown") === o.value} className="peer sr-only" />
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

          {noteKind && (
            <div className="space-y-2 border-t border-border pt-4">
              <label htmlFor="player-note" className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-foreground">
                {noteKind === "private" ? <><Lock className="h-3.5 w-3.5" /> Private note</> : <><MessageSquare className="h-3.5 w-3.5" /> Shared note</>}
              </label>
              <p id="player-note-help" className="text-xs text-muted-foreground">
                {noteKind === "private"
                  ? "Only you can see this note. You can read and change it anytime, including after scoring closes (My Notes)."
                  : "Coaches see this note after the age group's draft report is released, without your name. Admins see it with your name. It locks with the session."}
              </p>
              <textarea id="player-note" name="note" defaultValue={noteOf(player.id)} maxLength={2000} rows={3} aria-describedby="player-note-help"
                placeholder={noteKind === "private" ? "Anything you want to remember about this player" : "Observations other coaches should know"}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500 sm:text-sm" />
            </div>
          )}

          <div className="space-y-3 border-t border-border pt-4">
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Leave a skill on &quot;Not scored&quot; if you didn&apos;t see it. Blank skills are flagged, never counted as zero. Saving needs at least one core skill. Your ratings count in reports as soon as you save, and you can change them until the session is locked. With no signal, saves stay on this phone and are sent later.
            </p>
            <div className="grid gap-2 sm:flex sm:flex-row-reverse sm:flex-wrap">
              {next && (
                <Button type="submit" name="intent" value="submitted_next" disabled={busy} className="min-h-11 bg-emerald-600 text-white hover:bg-emerald-500">
                  Save &amp; Next ({bibLabel(next)})
                </Button>
              )}
              <Button type="submit" name="intent" value="submitted" disabled={busy} variant={next ? "outline" : "default"} className={`min-h-11 ${next ? "" : "bg-emerald-600 text-white hover:bg-emerald-500"}`}>
                Save
              </Button>
              <Button type="submit" name="intent" value="not_evaluated" disabled={busy} variant="outline" className="min-h-11 text-muted-foreground">
                Not Evaluated (clears ratings)
              </Button>
            </div>
          </div>
        </form>
        {navBar("bottom")}
      </div>
    );
  }

  // ===== Player list =====
  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-6">
      <h2 className="text-lg font-bold text-foreground">{props.ageLabel}</h2>
      {props.children}
      {offlineBanner}
      {noticeBox}
      {players.length === 0 ? (
        <p className="rounded-lg border border-border bg-background p-6 text-center text-sm font-semibold text-foreground">No players in this age group yet</p>
      ) : (
        <>
          <form className="flex gap-2" role="search" onSubmit={(e) => {
            e.preventDefault();
            const raw = String(new FormData(e.currentTarget).get("bib") ?? "");
            const hit = players.find((p) => p.bib === Number(raw.replace(/^#/, "").trim()));
            if (hit) go(hit.id); else setNotice({ text: `No player with bib ${raw} in this age group.`, tone: "error" });
          }}>
            <label htmlFor="bib-search" className="sr-only">Bib number</label>
            <input id="bib-search" name="bib" inputMode="numeric" placeholder="Go to bib #" required
              className="min-h-11 w-full rounded-md border border-border bg-background px-3 text-base" />
            <Button type="submit" className="min-h-11"><Search className="mr-1 h-4 w-4" /> Go</Button>
          </form>
          <p className="text-xs text-muted-foreground">
            {done} of {players.length} players done (saved or not evaluated).{hereCount > 0 && ` ${hereCount} checked in today ("Here").`} A player marked &quot;Draft (not counted)&quot; stays out of reports until you open it and save.
            {Object.keys(props.prior).length > 0 && " Prior-year ratings are shown on each player's page."}
          </p>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {players.map((p) => (
              <li key={p.id}>
                {navLink(p, "flex min-h-12 items-center gap-3 px-3 py-2 hover:bg-accent", <>
                  <span className="w-14 shrink-0 font-mono text-base font-bold text-foreground">{p.bib ?? "—"}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">{p.name}</span>
                  {p.here && <span title="Checked in today" className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">Here</span>}
                  {p.coachKid && <CoachKidBadge short />}
                  {noteOf(p.id) && <StickyNote className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-label="Has your note" />}
                  <span className="hidden text-xs text-muted-foreground sm:inline">Age {p.leagueAge}</span>
                  <StatusChip status={statusOf(p.id)} />
                </>)}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
