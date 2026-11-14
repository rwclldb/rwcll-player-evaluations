"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type Role = "coach" | "independent_evaluator" | "administrator";
type Delivery = "email" | "link";
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

// The app's own address, so links work on localhost, previews and the main site.
async function appOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") || host?.startsWith("127.") ? "http" : "https");
  return host ? `${proto}://${host}` : "";
}

// A one-time link handled by the app's own /auth/confirm route (no email template needed).
const confirmLink = (origin: string, tokenHash: string, type: "invite" | "recovery") =>
  `${origin}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=${type}&next=/auth/update-password`;

type InviteResult = { status: "invited" | "role_added" | "already" | "error"; message?: string; link?: string; userId?: string };

// Invite one person (or, if the email already has an account, just add the role).
// delivery "email": Supabase sends its invite email. "link": no email; the result carries a link to send yourself.
async function invite(supabase: SupabaseClient, name: string, rawEmail: string, role: Role, seasonId: number | null, delivery: Delivery): Promise<InviteResult> {
  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL.test(email)) return { status: "error", message: `"${rawEmail}" is not an email address.` };
  if (!ROLES.includes(role)) return { status: "error", message: "Unknown role." };
  if (role !== "administrator" && !seasonId) return { status: "error", message: "Choose a season." };

  const admin = createAdminClient();
  const origin = await appOrigin();
  let user = await findUserByEmail(admin, email);
  let status: InviteResult["status"] = "role_added";
  let link: string | undefined;
  if (!user) {
    const data = { display_name: name.trim() || undefined };
    if (delivery === "email") {
      const res = await admin.auth.admin.inviteUserByEmail(email, { data, redirectTo: origin ? `${origin}/auth/update-password` : undefined });
      if (res.error) return { status: "error", message: `${email}: ${res.error.message}` };
      user = res.data.user;
    } else {
      const res = await admin.auth.admin.generateLink({ type: "invite", email, options: { data } });
      if (res.error) return { status: "error", message: `${email}: ${res.error.message}` };
      user = res.data.user;
      link = confirmLink(origin, res.data.properties.hashed_token, "invite");
    }
    status = "invited";
    await supabase.rpc("admin_log_account_event", { p_user_id: user.id, p_action: "account_invited", p_detail: { email, role, season_id: seasonId, delivery } });
  }
  if (name.trim()) await supabase.rpc("admin_set_display_name", { p_user_id: user.id, p_display_name: name.trim() });

  const { data: before } = await supabase.from("user_roles").select("id").eq("user_id", user.id).eq("role_name", role)
    .filter("season_id", role === "administrator" ? "is" : "eq", role === "administrator" ? null : seasonId);
  const { error } = await supabase.rpc("admin_grant_role", { p_user_id: user.id, p_role: role, p_season_id: role === "administrator" ? null : seasonId });
  if (error) return { status: "error", message: `${email}: ${error.message}` };
  if (status === "role_added" && (before ?? []).length > 0) status = "already";
  return { status, link, userId: user.id };
}

export type FormResult = { ok: boolean; message: string; link?: string } | null;

// Single invite (used with useActionState so a link can be shown without putting it in the address bar).
export async function invitePerson(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const { supabase } = await requireAdmin();
  const seasonId = Number(formData.get("seasonId")) || null;
  const delivery: Delivery = formData.get("delivery") === "link" ? "link" : "email";
  const email = String(formData.get("email") ?? "");
  const result = await invite(supabase, String(formData.get("name") ?? ""), email, String(formData.get("role") ?? "") as Role, seasonId, delivery)
    .catch((e: Error) => ({ status: "error" as const, message: e.message, link: undefined }));
  revalidatePath("/protected/people");
  if (result.status === "error") return { ok: false, message: result.message ?? "Could not invite." };
  if (result.status === "invited") {
    return delivery === "link"
      ? { ok: true, message: `Account created for ${email}. Send them this link (it works once and expires; make a new one with "Sign-in link" if needed):`, link: result.link }
      : { ok: true, message: `Invitation emailed to ${email}.` };
  }
  return { ok: true, message: result.status === "already" ? "That person already has this role." : "That email already has an account; the role was added." };
}

// Bulk: rows come from the CSV preview on the page as JSON [{name, email, role, divisions}].
// Coaches' divisions (from the file's Division Name column) are added to what they already have.
// With delivery "link" accounts are created without email; use each person's "Sign-in link" afterwards.
export async function invitePeople(formData: FormData) {
  const { supabase } = await requireAdmin();
  const seasonId = Number(formData.get("seasonId")) || null;
  const delivery: Delivery = formData.get("delivery") === "link" ? "link" : "email";
  let rows: { name: string; email: string; role: Role; divisions?: string[] }[] = [];
  try { rows = JSON.parse(String(formData.get("rows") ?? "[]")); } catch { go(back(formData), "error", "Could not read the list."); }
  if (!Array.isArray(rows) || rows.length === 0) go(back(formData), "error", "No people selected.");
  if (rows.length > 200) go(back(formData), "error", "Invite at most 200 people at a time.");

  const tally = { invited: 0, role_added: 0, already: 0, error: 0 };
  const problems: string[] = [];
  let withDivisions = 0;
  const skipped = new Set<string>();
  for (const r of rows) {
    const res: InviteResult = await invite(supabase, String(r.name ?? ""), String(r.email ?? ""), r.role, seasonId, delivery)
      .catch((e: Error) => ({ status: "error" as const, message: e.message }));
    tally[res.status]++;
    if (res.status === "error" && res.message) problems.push(res.message);
    const divisions = Array.isArray(r.divisions) ? r.divisions.map(String).filter(Boolean) : [];
    if (res.status !== "error" && res.userId && r.role === "coach" && divisions.length && seasonId) {
      const { data, error } = await supabase.rpc("admin_set_coach_divisions", {
        p_user_id: res.userId, p_season_id: seasonId, p_division_names: divisions, p_replace: false,
      });
      if (error) problems.push(`${r.email}: ${error.message}`);
      else {
        if (((data as { divisions?: string[] })?.divisions ?? []).length) withDivisions++;
        for (const n of (data as { skipped?: string[] })?.skipped ?? []) skipped.add(n);
      }
    }
  }
  revalidatePath("/protected/people");
  const created = delivery === "link" ? `${tally.invited} account(s) created (no email sent; use Sign-in link for each)` : `${tally.invited} invited by email`;
  const summary = `${created}, ${tally.role_added} existing account(s) given the role, ${tally.already} already set.`
    + (withDivisions ? ` Divisions recorded for ${withDivisions} coach(es).` : "")
    + (skipped.size ? ` Not divisions this season (ignored): ${[...skipped].join(", ")}.` : "");
  if (problems.length) go(back(formData), "error", `${summary} ${tally.error} problem(s): ${problems.slice(0, 5).join(" ")}${problems.length > 5 ? " ..." : ""}`);
  go(back(formData), "message", summary);
}

// A fresh one-time sign-in link for someone (first sign-in, expired invite, or forgotten password).
// Opening it signs them in and asks them to choose a password.
export async function signInLink(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const { supabase } = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user?.email) return { ok: false, message: error?.message ?? "Account not found." };
  const res = await admin.auth.admin.generateLink({ type: "recovery", email: data.user.email });
  if (res.error) return { ok: false, message: res.error.message };
  await supabase.rpc("admin_log_account_event", { p_user_id: userId, p_action: "account_invite_resent", p_detail: { email: data.user.email, delivery: "link" } });
  return { ok: true, message: `Sign-in link for ${data.user.email} (works once; don't share it with anyone else):`, link: confirmLink(await appOrigin(), res.data.properties.hashed_token, "recovery") };
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
  if (data.user!.last_sign_in_at) go(back(formData), "error", "This person has already signed in. Use Sign-in link, or they can use \"Forgot password\".");
  const origin = await appOrigin();
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(data.user!.email!, { redirectTo: origin ? `${origin}/auth/update-password` : undefined });
  if (inviteError) go(back(formData), "error", `${inviteError.message} (Use Sign-in link to send a link yourself.)`);
  await supabase.rpc("admin_log_account_event", { p_user_id: userId, p_action: "account_invite_resent", p_detail: { email: data.user!.email, delivery: "email" } });
  go(back(formData), "message", "Invitation emailed again.");
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

// The divisions a coach coaches this season (People page). Replaces the coach's list.
export async function setCoachDivisions(formData: FormData) {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.rpc("admin_set_coach_divisions", {
    p_user_id: String(formData.get("userId") ?? ""),
    p_season_id: Number(formData.get("seasonId")) || null,
    p_division_names: formData.getAll("division").map(String),
    p_replace: true,
  });
  revalidatePath("/protected/people");
  revalidatePath("/protected/assignments");
  if (error) go(back(formData), "error", error.message);
  const list = (data as { divisions?: string[] })?.divisions ?? [];
  go(back(formData), "message", list.length ? `Divisions saved: ${list.join(", ")}.` : "Divisions cleared.");
}

// Correct a person's name and/or sign-in email. Email changes take effect at once (no confirmation email):
// the person signs in with the new address and the same password.
export async function updateAccount(formData: FormData) {
  const { supabase } = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!userId) go(back(formData), "error", "Account not found.");
  if (name.length > 100) go(back(formData), "error", "Keep the name under 100 characters.");

  const admin = createAdminClient();
  const { data: found, error: findError } = await admin.auth.admin.getUserById(userId);
  if (findError || !found.user) go(back(formData), "error", "Account not found.");
  const user = found.user!;
  const { data: profile } = await supabase.from("user_profiles").select("display_name").eq("user_id", userId).maybeSingle();
  const oldName = (profile?.display_name as string | null) ?? "";
  const changes: string[] = [];

  if (name !== oldName) {
    const { error } = await supabase.rpc("admin_set_display_name", { p_user_id: userId, p_display_name: name });
    if (error) go(back(formData), "error", error.message);
    await supabase.rpc("admin_log_account_event", { p_user_id: userId, p_action: "account_name_changed", p_detail: { before: oldName, after: name } });
    changes.push(name ? `name is now ${name}` : "name cleared");
  }

  if (email && email !== (user.email ?? "").toLowerCase()) {
    if (!EMAIL.test(email)) go(back(formData), "error", `"${email}" is not an email address.`);
    if (await findUserByEmail(admin, email)) go(back(formData), "error", `${email} already has an account.`);
    const { error } = await admin.auth.admin.updateUserById(userId, { email, email_confirm: true });
    if (error) go(back(formData), "error", error.message);
    await supabase.rpc("admin_log_account_event", { p_user_id: userId, p_action: "account_email_changed", p_detail: { before: user.email, after: email } });
    changes.push(`signs in as ${email}`);
  }

  revalidatePath("/protected/people");
  revalidatePath("/protected/assignments");
  go(back(formData), "message", changes.length ? `Saved: ${changes.join("; ")}.` : "No changes.");
}
