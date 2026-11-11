"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type Role = "coach" | "independent_evaluator" | "administrator";
const ROLES: Role[] = ["coach", "independent_evaluator", "administrator"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const go = (path: string, kind: "message" | "error", text: string): never =>
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(text)}`);
const back = (formData: FormData) => {
  const season = Number(formData.get("seasonId"));
  return Number.isSafeInteger(season) && season > 0 ? `/protected/people?season=${season}` : "/protected/people";
};

// Every action checks the caller is an admin with their own session before touching the secret key.
async function requireAdmin() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("is_admin");
  if (data !== true) redirect("/protected");
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, me: user! };
}

async function findUserByEmail(admin: SupabaseClient, email: string): Promise<User | undefined> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit || data.users.length < 200) return hit;
  }
  return undefined;
}

// Where the invite link lands: the app's own address (Site URL in Supabase must match for hosted).
async function appOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") || host?.startsWith("127.") ? "http" : "https");
  return host ? `${proto}://${host}` : undefined;
}

type InviteResult = { status: "invited" | "role_added" | "already" | "error"; message?: string };

// Invite one person (or, if the email already has an account, just add the role).
async function invite(supabase: SupabaseClient, name: string, rawEmail: string, role: Role, seasonId: number | null): Promise<InviteResult> {
  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL.test(email)) return { status: "error", message: `"${rawEmail}" is not an email address.` };
  if (!ROLES.includes(role)) return { status: "error", message: "Unknown role." };
  if (role !== "administrator" && !seasonId) return { status: "error", message: "Choose a season." };

  const admin = createAdminClient();
  let user = await findUserByEmail(admin, email);
  let status: InviteResult["status"] = "role_added";
  if (!user) {
    const origin = await appOrigin();
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { display_name: name.trim() || undefined },
      redirectTo: origin ? `${origin}/auth/update-password` : undefined,
    });
    if (error) return { status: "error", message: `${email}: ${error.message}` };
    user = data.user;
    status = "invited";
    await supabase.rpc("admin_log_account_event", { p_user_id: user.id, p_action: "account_invited", p_detail: { email, role, season_id: seasonId } });
  }
  if (name.trim()) await supabase.rpc("admin_set_display_name", { p_user_id: user.id, p_display_name: name.trim() });

  const { data: before } = await supabase.from("user_roles").select("id").eq("user_id", user.id).eq("role_name", role)
    .filter("season_id", role === "administrator" ? "is" : "eq", role === "administrator" ? null : seasonId);
  const { error } = await supabase.rpc("admin_grant_role", { p_user_id: user.id, p_role: role, p_season_id: role === "administrator" ? null : seasonId });
  if (error) return { status: "error", message: `${email}: ${error.message}` };
  if (status === "role_added" && (before ?? []).length > 0) status = "already";
  return { status };
}

export async function invitePerson(formData: FormData) {
  const { supabase } = await requireAdmin();
  const seasonId = Number(formData.get("seasonId")) || null;
  const result = await invite(supabase, String(formData.get("name") ?? ""), String(formData.get("email") ?? ""),
    String(formData.get("role") ?? "") as Role, seasonId).catch((e: Error) => ({ status: "error" as const, message: e.message }));
  revalidatePath("/protected/people");
  if (result.status === "error") go(back(formData), "error", result.message ?? "Could not invite.");
  go(back(formData), "message", result.status === "invited" ? "Invitation sent." : result.status === "already" ? "That person already has this role." : "That email already has an account; the role was added.");
}

// Bulk: rows come from the CSV preview on the page as JSON [{name, email, role}].
export async function invitePeople(formData: FormData) {
  const { supabase } = await requireAdmin();
  const seasonId = Number(formData.get("seasonId")) || null;
  let rows: { name: string; email: string; role: Role }[] = [];
  try { rows = JSON.parse(String(formData.get("rows") ?? "[]")); } catch { go(back(formData), "error", "Could not read the list."); }
  if (!Array.isArray(rows) || rows.length === 0) go(back(formData), "error", "No people selected.");
  if (rows.length > 200) go(back(formData), "error", "Invite at most 200 people at a time.");

  const tally = { invited: 0, role_added: 0, already: 0, error: 0 };
  const problems: string[] = [];
  for (const r of rows) {
    const res = await invite(supabase, String(r.name ?? ""), String(r.email ?? ""), r.role, seasonId)
      .catch((e: Error) => ({ status: "error" as const, message: e.message }));
    tally[res.status]++;
    if (res.status === "error" && res.message) problems.push(res.message);
  }
  revalidatePath("/protected/people");
  const summary = `${tally.invited} invited, ${tally.role_added} existing account(s) given the role, ${tally.already} already set.`;
  if (problems.length) go(back(formData), "error", `${summary} ${tally.error} problem(s): ${problems.slice(0, 5).join(" ")}${problems.length > 5 ? " ..." : ""}`);
  go(back(formData), "message", summary);
}

export async function grantRole(formData: FormData) {
  const { supabase } = await requireAdmin();
  const role = String(formData.get("role") ?? "") as Role;
  const { error } = await supabase.rpc("admin_grant_role", {
    p_user_id: String(formData.get("userId") ?? ""), p_role: role,
    p_season_id: role === "administrator" ? null : Number(formData.get("seasonId")) || null,
  });
  revalidatePath("/protected/people");
  if (error) go(back(formData), "error", error.message);
  go(back(formData), "message", "Role added.");
}

export async function revokeRole(formData: FormData) {
  const { supabase } = await requireAdmin();
  const role = String(formData.get("role") ?? "") as Role;
  const { error } = await supabase.rpc("admin_revoke_role", {
    p_user_id: String(formData.get("userId") ?? ""), p_role: role,
    p_season_id: role === "administrator" ? null : Number(formData.get("roleSeasonId")) || null,
  });
  revalidatePath("/protected/people");
  if (error) go(back(formData), "error", error.message);
  go(back(formData), "message", "Role removed.");
}

export async function resendInvite(formData: FormData) {
  const { supabase } = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user?.email) go(back(formData), "error", error?.message ?? "Account not found.");
  if (data.user!.last_sign_in_at) go(back(formData), "error", "This person has already signed in. They can use \"Forgot password\" on the sign-in page.");
  const origin = await appOrigin();
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(data.user!.email!, { redirectTo: origin ? `${origin}/auth/update-password` : undefined });
  if (inviteError) go(back(formData), "error", inviteError.message);
  await supabase.rpc("admin_log_account_event", { p_user_id: userId, p_action: "account_invite_resent", p_detail: { email: data.user!.email } });
  go(back(formData), "message", "Invitation sent again.");
}

export async function setDisabled(formData: FormData) {
  const { supabase, me } = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const disable = formData.get("disable") === "true";
  if (userId === me.id) go(back(formData), "error", "You can't disable your own account.");
  const admin = createAdminClient();
  // A very long ban blocks sign-in and refreshes; "none" lifts it.
  const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: disable ? "876000h" : "none" });
  if (error) go(back(formData), "error", error.message);
  await supabase.rpc("admin_log_account_event", { p_user_id: userId, p_action: disable ? "account_disabled" : "account_enabled", p_detail: null });
  revalidatePath("/protected/people");
  go(back(formData), "message", disable ? "Account disabled. They can no longer sign in." : "Account enabled.");
}
