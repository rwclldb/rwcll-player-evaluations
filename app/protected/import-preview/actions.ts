"use server";

import { createClient } from "@/lib/supabase/server";

export type StageImportResult =
  | { ok: true; batchId: number; rowCount: number }
  | { ok: false; message: string };

type StageRow = {
  line: number;
  playerId: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  program: string;
  division: string;
  registrationNumber: string;
  paymentStatus: string;
  leagueAge: number | null;
  coachKid?: boolean | null;
  issues: string[];
};

export async function stageSportsConnectImport(input: {
  seasonId: number;
  fileName: string;
  rows: StageRow[];
}): Promise<StageImportResult> {
  if (!input || !Number.isSafeInteger(input.seasonId) || input.seasonId < 1) {
    return { ok: false, message: "Choose a valid existing season." };
  }
  if (!Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > 5000) {
    return { ok: false, message: "Staging requires between 1 and 5,000 preview rows." };
  }
  const fileName = String(input.fileName ?? "").replace(/[\r\n\u0000-\u001f]/g, " ").slice(0, 255).trim();
  if (!fileName) return { ok: false, message: "The source filename is missing." };

  // Re-check identity and administrator role server-side. The UI is not an authorization boundary.
  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims) return { ok: false, message: "Sign in again before staging this import." };
  const { data: isAdmin, error: roleError } = await supabase.rpc("is_admin_or_registrar");
  if (roleError || isAdmin !== true) return { ok: false, message: "Administrator access is required." };

  const rows = input.rows.map((row) => ({
    line: Number(row.line),
    playerId: String(row.playerId ?? "").slice(0, 200),
    firstName: String(row.firstName ?? "").slice(0, 200),
    lastName: String(row.lastName ?? "").slice(0, 200),
    birthDate: String(row.birthDate ?? "").slice(0, 40),
    program: String(row.program ?? "").slice(0, 300),
    division: String(row.division ?? "").slice(0, 200),
    registrationNumber: String(row.registrationNumber ?? "").slice(0, 200),
    paymentStatus: String(row.paymentStatus ?? "").slice(0, 100),
    leagueAge: row.leagueAge === null ? null : Number(row.leagueAge),
    coachKid: typeof row.coachKid === "boolean" ? row.coachKid : null,
    issues: Array.isArray(row.issues) ? row.issues.map((issue) => String(issue).slice(0, 300)).slice(0, 30) : [],
  }));
  if (rows.some((row) => !Number.isSafeInteger(row.line) || row.line < 2)) {
    return { ok: false, message: "One or more rows has an invalid source line number." };
  }
  if (new Set(rows.map((row) => row.line)).size !== rows.length) {
    return { ok: false, message: "Source row numbers must be unique before staging." };
  }

  const { data: batchId, error } = await supabase.rpc("stage_sports_connect_import", {
    p_season_id: input.seasonId,
    p_source_file_name: fileName,
    p_rows: rows,
  });
  if (error || typeof batchId !== "number") {
    return { ok: false, message: error?.message ?? "The staging request did not return a batch ID." };
  }
  return { ok: true, batchId, rowCount: rows.length };
}
