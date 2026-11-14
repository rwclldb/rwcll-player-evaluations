"use server";

import { createClient as createPlainClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const back = (kind: "message" | "error", text: string, section: "name" | "password"): never =>
  redirect(`/protected/account?${kind}=${encodeURIComponent(text)}&section=${section}`);

export async function saveMyName(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) back("error", "Enter your name.", "name");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_my_display_name", { p_display_name: name });
  if (error) back("error", error.message, "name");
  revalidatePath("/protected", "layout");
  back("message", "Name saved.", "name");
}

export async function changeMyPassword(formData: FormData) {
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (next.length < 8) back("error", "Use at least 8 characters for the new password.", "password");
  if (next !== confirm) back("error", "The two new passwords don't match.", "password");
  if (next === current) back("error", "The new password is the same as the current one.", "password");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) redirect("/auth/login");

  // Check the current password with a throwaway client so the signed-in session's cookies are untouched.
  const checker = createPlainClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: wrong } = await checker.auth.signInWithPassword({ email: user.email, password: current });
  if (wrong) back("error", "Your current password isn't right.", "password");
  await checker.auth.signOut({ scope: "local" });

  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) back("error", error.message, "password");
  await supabase.rpc("log_my_password_change");
  back("message", "Password changed. Use the new one next time you sign in.", "password");
}
