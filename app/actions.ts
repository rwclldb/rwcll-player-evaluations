
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export async function createSeason(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const startDate = String(formData.get("start_date") ?? "");
  const endDate = String(formData.get("end_date") ?? "");

  if (!name) {
    throw new Error("Please enter a season name.");
  }

  if (startDate && endDate && startDate > endDate) {
    throw new Error("The end date must be on or after the start date.");
  }

  const supabase = await createClient();

  const { error } = await supabase.from("seasons").insert({
    name,
    start_date: startDate || null,
    end_date: endDate || null,
  });

  if (error) {
    throw new Error(`Could not create season: ${error.message}`);
  }

  revalidatePath("/");
}

export async function loginAction(formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return redirect(`/auth/login?message=${encodeURIComponent(error.message)}`);
  }

  return redirect("/protected");
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return redirect("/auth/login");
}

export async function forgotPasswordAction(formData: FormData) {
  const email = formData.get("email") as string;
  const supabase = await createClient();

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/auth/update-password`,
  });

  if (error) {
    return redirect(`/auth/forgot-password?message=${encodeURIComponent(error.message)}`);
  }

  return redirect(`/auth/forgot-password?message=${encodeURIComponent("Password reset link sent to your email.")}`);
}

export async function updatePasswordAction(formData: FormData) {
  const password = formData.get("password") as string;
  const supabase = await createClient();

  const { error } = await supabase.auth.updateUser({
    password,
  });

  if (error) {
    return redirect(`/auth/update-password?message=${encodeURIComponent(error.message)}`);
  }

  return redirect("/protected");
}