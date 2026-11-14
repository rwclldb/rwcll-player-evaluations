import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ArrowLeft, Ban, Copy, GitMerge, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DobMarker } from "@/components/dob-marker";
import { createClient } from "@/lib/supabase/server";
import { dismissDuplicate, mergePlayers, restoreDuplicate } from "../actions";

type Registration = {
  id: number; season_id: number; season_name: string; season_closed: boolean; league_age: number | null; bib: number | null;
  player_id: string | null; source: string; is_coach_kid: boolean; scores: number; check_ins: number;
};
type Card = { id: number; first_name: string; last_name: string; has_birth_date: boolean; created_at: string; prior_year_ratings: number; registrations: Registration[] };
type Pair = {
  player_a: Card; player_b: Card; reasons: string[]; dismissed: boolean;
  dismiss_reason: string | null; dismissed_by_name: string | null; dismissed_at: string | null;
};
type SearchParams = Promise<{ tab?: string; message?: string; error?: string }>;

const REASONS: Record<string, string> = {
  name_birthdate: "Same name and birthdate",
  name_birthdate_missing: "Same name; a birthdate is missing",
  same_player_id: "Same Sports Connect Player Id",
};
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric" });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Why a merge can't happen yet: a season both are registered in that is closed, or where both have scores.
function blockers(a: Card, b: Card) {
  return a.registrations.flatMap((ra) => {
    const rb = b.registrations.find((r) => r.season_id === ra.season_id);
    if (!rb) return [];
    if (ra.season_closed) return [`Both are registered in ${ra.season_name}, which is closed. Reopen the season to merge them.`];
    if (ra.scores > 0 && rb.scores > 0) return [`Both registrations in ${ra.season_name} have scores. Remove one set of scores first, then merge.`];
    return [];
  });
}
const sharedSeasons = (a: Card, b: Card) => a.registrations.filter((ra) => b.registrations.some((rb) => rb.season_id === ra.season_id)).map((r) => r.season_name);
// Suggest keeping the record with more history, then the one with a birthdate, then the older one.
const suggestedKeep = (a: Card, b: Card) =>
  b.registrations.length + b.prior_year_ratings > a.registrations.length + a.prior_year_ratings || (!a.has_birth_date && b.has_birth_date) ? b.id : a.id;

function PlayerCard({ card, pairKey, keep, canMerge }: { card: Card; pairKey: string; keep: boolean; canMerge: boolean }) {
  return (
    <div className="flex-1 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{card.first_name} {card.last_name}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <DobMarker has={card.has_birth_date} /> · Added {day(card.created_at)}
            {card.prior_year_ratings > 0 && <> · {plural(card.prior_year_ratings, "prior-year rating")}</>}
          </p>
        </div>
        {canMerge && (
          <label className="flex cursor-pointer items-center gap-1.5 text-sm font-medium">
            <input type="radio" name="keep" value={card.id} defaultChecked={keep} form={pairKey} required /> Keep this one
          </label>
        )}
      </div>
      {card.registrations.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Not registered in any season.</p>
      ) : (
        <ul className="mt-3 space-y-1.5 text-sm">
          {card.registrations.map((r) => (
            <li key={r.id} className="rounded-md bg-muted/50 px-2.5 py-1.5">
              <span className="font-medium">{r.season_name}</span>
              {r.season_closed && <span className="ml-1 text-xs text-muted-foreground">(closed)</span>}
              <span className="text-muted-foreground">
                {" "}· {r.league_age != null ? `age ${r.league_age}` : "no age"} · {r.bib != null ? `bib ${r.bib}` : "no bib"}
                {r.player_id && <> · Player Id {r.player_id}</>}
                {r.source === "on_site" && <> · walk-up</>}
                {r.is_coach_kid && <> · coach&apos;s kid</>}
                {" "}· {r.scores > 0 ? plural(r.scores, "score") : "no scores"}
                {r.check_ins > 0 && <> · checked in</>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PairCard({ pair }: { pair: Pair }) {
  const { player_a: a, player_b: b } = pair;
  const pairKey = `merge-${a.id}-${b.id}`;
  const blocked = blockers(a, b);
  const shared = sharedSeasons(a, b);
  const keep = suggestedKeep(a, b);
  const canMerge = !pair.dismissed && blocked.length === 0;
  return (
    <li id={`pair-${a.id}-${b.id}`} className="space-y-4 rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap gap-2">
        {pair.reasons.map((r) => (
          <span key={r} className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-800 dark:text-amber-300">{REASONS[r] ?? r}</span>
        ))}
      </div>
      <div className="flex flex-col gap-3 md:flex-row">
        <PlayerCard card={a} pairKey={pairKey} keep={keep === a.id} canMerge={canMerge} />
        <PlayerCard card={b} pairKey={pairKey} keep={keep === b.id} canMerge={canMerge} />
      </div>

      {pair.dismissed ? (
        <form action={restoreDuplicate} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/50 p-3 text-sm">
          <input type="hidden" name="playerA" value={a.id} /><input type="hidden" name="playerB" value={b.id} />
          <span>
            <span className="font-semibold">Not a duplicate:</span> “{pair.dismiss_reason}”
            <span className="text-muted-foreground"> · {pair.dismissed_by_name ?? "unknown"}{pair.dismissed_at ? `, ${day(pair.dismissed_at)}` : ""}</span>
          </span>
          <Button type="submit" variant="outline" size="sm"><RotateCcw className="mr-1 h-4 w-4" /> Flag again</Button>
        </form>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {canMerge ? (
            <form id={pairKey} action={mergePlayers} className="space-y-2 rounded-xl border border-border p-4">
              <input type="hidden" name="playerA" value={a.id} /><input type="hidden" name="playerB" value={b.id} />
              <h3 className="flex items-center gap-1.5 text-sm font-semibold"><GitMerge className="h-4 w-4" /> Same child: merge</h3>
              <p className="text-xs text-muted-foreground">
                Everything moves onto the record you keep (its name stays) and the other record is deleted.
                {shared.length > 0 && <> Both are registered in {shared.join(", ")}: the registration with scores stays (or the kept record&apos;s, if neither has scores); the other one&apos;s check-ins, notes, stars and exemption move over and its bib is freed.</>}
                {" "}This can&apos;t be undone.
              </p>
              <textarea name="reason" required minLength={10} rows={2} placeholder="Reason, e.g., Same child: walk-up who was already registered"
                className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
              <Button type="submit" variant="destructive" size="sm"><GitMerge className="mr-1 h-4 w-4" /> Merge</Button>
            </form>
          ) : (
            <div className="space-y-1 rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm">
              <h3 className="flex items-center gap-1.5 font-semibold"><GitMerge className="h-4 w-4" /> Can&apos;t merge yet</h3>
              {blocked.map((t) => <p key={t} className="text-rose-700 dark:text-rose-300">{t}</p>)}
            </div>
          )}
          <form action={dismissDuplicate} className="space-y-2 rounded-xl border border-border p-4">
            <input type="hidden" name="playerA" value={a.id} /><input type="hidden" name="playerB" value={b.id} />
            <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Ban className="h-4 w-4" /> Different children</h3>
            <p className="text-xs text-muted-foreground">Twins or siblings, for example. The pair won&apos;t be flagged again unless you choose Flag again.</p>
            <input name="reason" required minLength={5} placeholder="Reason, e.g., Twins" className="block h-9 w-full rounded-md border border-input bg-background px-3 text-sm" />
            <Button type="submit" variant="outline" size="sm">Not a duplicate</Button>
          </form>
        </div>
      )}
    </li>
  );
}

// Player records that may be the same child, across all seasons (admins). Birthdates are compared in the database, never shown.
async function DuplicatesContent({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (isAdmin !== true) redirect("/protected/players");
  const { data, error } = await supabase.rpc("admin_possible_duplicates");
  const pairs = (data ?? []) as Pair[];
  const dismissedTab = sp.tab === "dismissed";
  const open = pairs.filter((p) => !p.dismissed);
  const dismissed = pairs.filter((p) => p.dismissed);
  const shown = dismissedTab ? dismissed : open;
  const tab = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-medium ${active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <div className="space-y-2 border-b border-border pb-5">
        <Button asChild variant="ghost" size="sm" className="-ml-2 h-8 px-2 text-xs text-muted-foreground">
          <Link href="/protected/players"><ArrowLeft className="mr-1 h-4 w-4" /> Players</Link>
        </Button>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><Copy className="h-7 w-7 text-amber-600" /> Possible duplicates</h1>
        <p className="text-sm text-muted-foreground">
          Player records that may be the same child, across all seasons: same name and birthdate, same name with a birthdate
          missing, or the same Sports Connect Player Id. Nothing is merged automatically. Merge the ones that are the same child,
          or mark them as different children. Both are logged.
        </p>
      </div>

      {sp.message && <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{sp.message}</div>}
      {sp.error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">{sp.error}</div>}
      {error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">Could not load possible duplicates: {error.message}</div>}

      <nav className="inline-flex gap-1 rounded-lg bg-muted p-1">
        <Link href="/protected/players/duplicates" className={tab(!dismissedTab)}>To review ({open.length})</Link>
        <Link href="/protected/players/duplicates?tab=dismissed" className={tab(dismissedTab)}>Not duplicates ({dismissed.length})</Link>
      </nav>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {dismissedTab ? "No pairs are marked as different children." : "No possible duplicates. Every player record looks like a different child."}
        </p>
      ) : (
        <ul className="space-y-4">{shown.map((p) => <PairCard key={`${p.player_a.id}-${p.player_b.id}`} pair={p} />)}</ul>
      )}
    </div>
  );
}

export default function DuplicatesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Looking for possible duplicates…</p>}>
      <DuplicatesContent searchParams={searchParams} />
    </Suspense>
  );
}
