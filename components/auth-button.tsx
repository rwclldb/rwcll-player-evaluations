import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/app/actions";

export async function AuthButton() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user ? (
    <div className="flex items-center gap-4">
      <span className="text-xs font-mono text-muted-foreground bg-background px-2.5 py-1 rounded border border-border">
        {user.email}
      </span>
      <form action={signOutAction}>
        <Button variant="outline" size="sm" type="submit">
          Sign Out
        </Button>
      </form>
    </div>
  ) : (
    <div className="flex items-center gap-2">
      <Button asChild size="sm">
        <Link href="/auth/login">Sign In</Link>
      </Button>
    </div>
  );
}