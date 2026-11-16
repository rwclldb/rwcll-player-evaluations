import { strToU8, zipSync } from "fflate";
import { createClient } from "@/lib/supabase/server";
import { backupFileName, buildBackupFiles, type Backup, type DraftRow } from "@/lib/season-backup";

// Season backup (admins): a zip of spreadsheets with everything the app stores for one season.
// admin_season_backup checks the admin, gathers the tables (never birthdates or private notes) and audits the download.
export async function GET(_request: Request, ctx: RouteContext<"/protected/seasons/[id]/backup">) {
  const { id } = await ctx.params;
  const seasonId = Number(id);
  if (!Number.isSafeInteger(seasonId) || seasonId <= 0) return new Response("Season not found.", { status: 404 });

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return new Response("Please sign in again.", { status: 401 });
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (isAdmin !== true) return new Response("Only league admins can download a season backup.", { status: 403 });

  const { data, error } = await supabase.rpc("admin_season_backup", { p_season_id: seasonId });
  if (error || !data) return new Response(`Could not make the backup: ${error?.message ?? "no data"}`, { status: 500 });
  const backup = data as Backup;

  // Averages exactly as the Draft Reports page shows them, one call per age group.
  const draft: DraftRow[] = [];
  for (const session of backup.tables.evaluation_sessions ?? []) {
    const { data: rows, error: draftError } = await supabase.rpc("draft_report", { p_session_id: Number(session.id) });
    if (draftError) return new Response(`Could not load the age ${session.league_age} draft report: ${draftError.message}`, { status: 500 });
    draft.push(...((rows ?? []) as DraftRow[]));
  }

  const { data: profile } = await supabase.from("user_profiles").select("display_name").eq("user_id", claims.claims.sub).maybeSingle();
  const madeBy = [profile?.display_name, claims.claims.email].filter(Boolean).join(", ") || "League admin";
  const files = buildBackupFiles(backup, draft, madeBy);
  const zip = zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])), { level: 6 });

  const seasonName = String(backup.tables.seasons?.[0]?.name ?? `season-${seasonId}`);
  return new Response(zip as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${backupFileName(seasonName, backup.made_at)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
