import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { signOutAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { changeMyPassword, saveMyName } from "./actions";

type Account = { display_name: string | null; roles: { role: string; season: string | null; divisions: string[] }[] };

const ROLE_LABELS: Record<string, string> = {
  administrator: "League admin",
  coach: "Coach",
  independent_evaluator: "Independent evaluator",
};
const field = "mt-1 block h-11 w-full rounded-md border border-input bg-background px-3 text-base text-foreground";
const card = "space-y-4 rounded-lg border border-border bg-card p-5";

function Notice({ show, message, error }: { show: boolean; message?: string; error?: string }) {
  if (!show) return null;
  if (error) return <p role="alert" className="rounded-md border border-rose-500/30 bg-rose-500/10 p-2 text-sm text-rose-700 dark:text-rose-300">{error}</p>;
  if (message) return <p role="status" className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2 text-sm text-emerald-700 dark:text-emerald-300">{message}</p>;
  return null;
}

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string; section?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const { data } = await supabase.rpc("my_account");
  const account = (data ?? { display_name: null, roles: [] }) as Account;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground">
          <Link href="/protected"><ArrowLeft className="mr-1 h-4 w-4 text-emerald-700 dark:text-emerald-400" /> Home</Link>
        </Button>
        <h1 className="mt-2 text-2xl font-bold text-foreground">Your account</h1>
      </div>

      <section className={card}>
        <div>
          <p className="text-xs text-muted-foreground">Sign-in email</p>
          <p className="break-all font-mono text-sm text-foreground">{user.email}</p>
          <p className="mt-1 text-xs text-muted-foreground">This is your user name. To change it, ask a league admin.</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Roles</p>
          {account.roles.length === 0 ? (
            <p className="text-sm text-foreground">None yet. A league admin adds roles.</p>
          ) : (
            <ul className="text-sm text-foreground">
              {account.roles.map((r, i) => (
                <li key={i}>
                  {ROLE_LABELS[r.role] ?? r.role}
                  {r.season && <span className="text-muted-foreground">, {r.season}</span>}
                  {r.divisions.length > 0 && <span className="text-muted-foreground"> ({r.divisions.join(", ")})</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <form action={saveMyName} className={card}>
        <h2 className="font-semibold text-foreground">Name</h2>
        <Notice show={sp.section === "name"} message={sp.message} error={sp.error} />
        <label className="block text-sm text-muted-foreground">Your name as others see it
          <input name="name" required maxLength={100} defaultValue={account.display_name ?? ""} autoComplete="name" className={field} />
        </label>
        <Button type="submit" className="min-h-11">Save name</Button>
      </form>

      <form action={changeMyPassword} className={card}>
        <h2 className="font-semibold text-foreground">Change password</h2>
        <Notice show={sp.section === "password"} message={sp.message} error={sp.error} />
        {/* Lets password managers tie the new password to this account. */}
        <input type="email" name="username" value={user.email ?? ""} autoComplete="username" readOnly hidden />
        <label className="block text-sm text-muted-foreground">Current password
          <input name="current" type="password" required autoComplete="current-password" className={field} />
        </label>
        <label className="block text-sm text-muted-foreground">New password (at least 8 characters)
          <input name="password" type="password" required minLength={8} autoComplete="new-password" className={field} />
        </label>
        <label className="block text-sm text-muted-foreground">New password again
          <input name="confirm" type="password" required minLength={8} autoComplete="new-password" className={field} />
        </label>
        <Button type="submit" className="min-h-11">Change password</Button>
        <p className="text-xs text-muted-foreground">
          Forgot your current password? Sign out and use &quot;Forgot password&quot; on the sign-in page, or ask a league admin for a sign-in link.
        </p>
      </form>

      <form action={signOutAction}>
        <Button type="submit" variant="outline" className="min-h-11">Sign out</Button>
      </form>
    </div>
  );
}
