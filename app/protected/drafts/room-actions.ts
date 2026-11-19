"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Board, RoomPlayer } from "@/lib/draft-room";

type Result<T = null> = { ok: true; data: T } | { ok: false; message: string };
const num = (n: unknown) => (Number.isSafeInteger(Number(n)) && Number(n) > 0 ? Number(n) : 0);

export async function fetchBoard(draftId: number): Promise<Result<Board>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("draft_board", { p_draft_id: num(draftId) });
  return error ? { ok: false, message: error.message } : { ok: true, data: data as Board };
}

export async function fetchPlayers(draftId: number): Promise<Result<RoomPlayer[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("draft_players", { p_draft_id: num(draftId) });
  return error ? { ok: false, message: error.message } : { ok: true, data: (data ?? []) as RoomPlayer[] };
}

// Every change returns the fresh board, so the screen updates at once.
async function thenBoard(draftId: number, error: { message: string } | null): Promise<Result<Board>> {
  if (error) return { ok: false, message: error.message };
  return fetchBoard(draftId);
}

export async function makePick(draftId: number, playerSeasonId: number, note: string): Promise<Result<Board>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_draft_pick", {
    p_draft_id: num(draftId), p_player_season_id: num(playerSeasonId), p_note: String(note ?? "").slice(0, 500) || null,
  });
  return thenBoard(draftId, error);
}

export async function siblingDecision(draftId: number, playerSeasonId: number, take: boolean): Promise<Result<Board>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_draft_sibling_decision", { p_draft_id: num(draftId), p_player_season_id: num(playerSeasonId), p_take: take === true });
  return thenBoard(draftId, error);
}

export async function pauseDraft(draftId: number, pause: boolean): Promise<Result<Board>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_pause_draft", { p_draft_id: num(draftId), p_pause: pause === true });
  return thenBoard(draftId, error);
}

export async function finishDraft(draftId: number): Promise<Result<Board>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_finish_draft", { p_draft_id: num(draftId) });
  revalidatePath("/protected/drafts");
  return thenBoard(draftId, error);
}

export async function toggleStar(playerSeasonId: number): Promise<Result<boolean>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("toggle_player_star", { p_player_season_id: num(playerSeasonId) });
  return error ? { ok: false, message: error.message } : { ok: true, data: data === true };
}

export async function saveNote(playerSeasonId: number, text: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_private_note", { p_player_season_id: num(playerSeasonId), p_note_text: String(text ?? "").slice(0, 4000) });
  return error ? { ok: false, message: error.message } : { ok: true, data: null };
}

// From the setup page.
export async function startDraft(formData: FormData) {
  const divisionId = num(formData.get("divisionId"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_start_draft", { p_draft_id: num(formData.get("draftId")) });
  if (error) redirect(`/protected/drafts/${divisionId}?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/protected/drafts");
  redirect(`/protected/drafts/${divisionId}/room`);
}
