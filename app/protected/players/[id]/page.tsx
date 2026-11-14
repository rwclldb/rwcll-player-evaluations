import Link from "next/link";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, History } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { leagueAgeForBirthDate } from "@/lib/sports-connect-preview";
import { type RegistrationRow, usDate } from "@/lib/players";
import { saveRegistration, setCoachKid } from "../actions";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ message?: string; error?: string }>;
type AuditRow = { id: number; action: string; reason: string | null; before_data: Record<string, unknown> | null; after_data: Record<string, unknown> | null; created_at: string };

const input = "mt-1 block h-11 w-full rounded-md border border-input bg-background px-3 text-base text-foreground sm:text-sm";
const LABELS: Record<string, string> = {
  first_name: "First name", last_name: "Last name", date_of_birth: "Birthdate", league_age: "Age group", evaluation_number: "Bib",
};

async function EditContent({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (isAdmin !== true) redirect("/protected");

  const psId = Number(id);
  if (!Number.isSafeInteger(psId) || psId <= 0) notFound();
  const { data } = await supabase.from("player_seasons")
    .select("id, season_id, evaluation_number, league_age, league_age_source, registration_source, external_player_id, external_registration_id, is_coach_kid, players(id, first_name, last_name, date_of_birth), seasons(name, is_closed)")
    .eq("id", psId).maybeSingle();
  if (!data) notFound();
  const reg = data as unknown as RegistrationRow & { external_registration_id: string | null; seasons: { name: string; is_closed: boolean } | null };

  const [{ data: auditData }, { count: evaluationCount }] = await Promise.all([
    supabase.from("audit_log").select("id, action, reason, before_data, after_data, created_at")
      .eq("target_table", "player_seasons").eq("target_id", String(psId)).order("created_at", { ascending: false }).limit(20),
    supabase.from("evaluations").select("id", { count: "exact", head: true }).eq("player_season_id", psId),
  ]);
  const history = (auditData ?? []) as AuditRow[];
  const chartAge = leagueAgeForBirthDate(reg.players?.date_of_birth);
  const locked = (evaluationCount ?? 0) > 0;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-col gap-3 border-b border-border pb-5">
        <Button asChild variant="ghost" size="sm" className="h-8 w-fit px-2 text-xs text-muted-foreground hover:text-foreground">
          <Link href={`/protected/players?season=${reg.season_id}`}><ArrowLeft className="mr-1 h-4 w-4" /> All players</Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{reg.players?.first_name} {reg.players?.last_name}</h1>
        <p className="text-sm text-muted-foreground">
          {reg.seasons?.name} · {reg.registration_source === "on_site" ? "Added on site" : "From Sports Connect"}
          {reg.external_player_id ? ` · Player Id ${reg.external_player_id}` : " · No Sports Connect Player Id yet"}
        </p>
      </div>

      {sp.message && <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{sp.message}</div>}
      {sp.error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">{sp.error}</div>}

      <form action={setCoachKid} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4">
        <input type="hidden" name="registrationId" value={reg.id} />
        <input type="hidden" name="value" value={reg.is_coach_kid ? "false" : "true"} />
        <div className="min-w-56 flex-1">
          <p className="text-sm font-semibold text-foreground">Coach&apos;s kid: {reg.is_coach_kid ? "Yes" : "No"}</p>
          <p className="text-xs text-muted-foreground">Shown to coaches and evaluators while scoring and on draft reports. The player is scored as usual.</p>
        </div>
        <Button type="submit" variant="outline" size="sm" disabled={reg.seasons?.is_closed}>
          {reg.is_coach_kid ? "Not a coach's kid" : "Mark as coach's kid"}
        </Button>
      </form>

      <form action={saveRegistration} className="space-y-4 rounded-lg border border-border bg-card p-4">
        <input type="hidden" name="playerSeasonId" value={reg.id} />
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-foreground">First name
            <input name="firstName" required defaultValue={reg.players?.first_name} className={input} />
          </label>
          <label className="text-sm font-medium text-foreground">Last name
            <input name="lastName" required defaultValue={reg.players?.last_name} className={input} />
          </label>
          <label className="text-sm font-medium text-foreground">Birthdate
            <input name="birthDate" defaultValue={usDate(reg.players?.date_of_birth)} placeholder="MM/DD/YYYY" className={input} />
            <span className="mt-1 block text-xs font-normal text-muted-foreground">
              {chartAge !== null ? `Age chart: league age ${chartAge}.` : reg.players?.date_of_birth ? "Not on the age chart." : "Missing. Set the age group by hand."}
            </span>
          </label>
          <label className="text-sm font-medium text-foreground">Age group (league age)
            <input name="leagueAge" inputMode="numeric" defaultValue={reg.league_age ?? ""} disabled={locked} className={input} />
            {locked && <input type="hidden" name="leagueAge" value={reg.league_age ?? ""} />}
            <span className="mt-1 block text-xs font-normal text-muted-foreground">
              {locked ? "Locked: this player already has evaluations in this age group."
                : reg.league_age_source === "admin" ? "Set by an admin." : "From the registration import."}
            </span>
          </label>
          <label className="text-sm font-medium text-foreground">Bib
            <input name="bib" inputMode="numeric" defaultValue={reg.evaluation_number ?? ""} className={input} />
            <span className="mt-1 block text-xs font-normal text-muted-foreground">Must be unique this season. Leave blank for none.</span>
          </label>
        </div>
        <label className="block text-sm font-medium text-foreground">Reason
          <input name="reason" placeholder="Needed when changing the name, birthdate, or age group" className={input} />
        </label>
        <div className="flex justify-end">
          <Button type="submit" className="min-h-11" disabled={reg.seasons?.is_closed}>Save changes</Button>
        </div>
        {reg.seasons?.is_closed && <p className="text-xs text-muted-foreground">This season is closed, so changes are turned off.</p>}
      </form>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground"><History className="h-4 w-4" /> Change history</h2>
        {history.length === 0 ? <p className="text-sm text-muted-foreground">No admin changes yet.</p> : (
          <ul className="space-y-2 text-xs">
            {history.map((h) => (
              <li key={h.id} className="rounded border border-border bg-card p-2">
                <p className="text-muted-foreground">{new Date(h.created_at).toLocaleString("en-US")} · {h.action === "registration_added_on_site" ? "Added on site" : "Edited"}{h.reason ? ` · ${h.reason}` : ""}</p>
                {h.before_data && h.after_data && (
                  <p className="mt-1 text-foreground">
                    {Object.keys(LABELS).filter((k) => JSON.stringify(h.before_data?.[k]) !== JSON.stringify(h.after_data?.[k]))
                      .map((k) => `${LABELS[k]}: ${String(h.before_data?.[k] ?? "—")} → ${String(h.after_data?.[k] ?? "—")}`).join("; ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function EditPlayerPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 w-full animate-pulse rounded-lg border border-border bg-card" />}>
      <EditContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
