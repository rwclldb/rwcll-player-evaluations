import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { PREVIEW_COOKIE } from "@/lib/preview";
import { type EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/";

  if (token_hash && type) {
    const supabase = await createClient();

    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash,
    });
    if (!error) {
      // An admin's "View as" link: mark this sign-in read-only and ignore any edited "next".
      const { data: preview } = await supabase.rpc("start_preview_from_token", { p_token_hash: token_hash });
      if (preview === true) {
        // Marks this browser as a preview so refused saves are explained (wording only; the server enforces it).
        (await cookies()).set(PREVIEW_COOKIE, "1", { path: "/", sameSite: "lax", maxAge: 60 * 60 * 12 });
        redirect("/protected");
      }
      (await cookies()).delete(PREVIEW_COOKIE); // an ordinary sign-in link
      // redirect user to specified redirect URL or root of app
      redirect(next);
    } else {
      // redirect the user to an error page with some instructions
      redirect(`/auth/error?error=${error?.message}`);
    }
  }

  // redirect the user to an error page with some instructions
  redirect(`/auth/error?error=No token hash or type`);
}
