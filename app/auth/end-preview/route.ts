import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { PREVIEW_COOKIE } from "@/lib/preview";

// Ends an admin's "View as" preview: marks the session ended and signs this window out.
// A GET route (not a server action) because server actions are refused during a preview.
export async function GET() {
  const supabase = await createClient();
  await supabase.rpc("end_preview");
  await supabase.auth.signOut({ scope: "local" });
  (await cookies()).delete(PREVIEW_COOKIE);
  redirect("/auth/login");
}
