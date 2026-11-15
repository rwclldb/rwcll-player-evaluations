import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resendInvite } from "./people/actions";
import { SignInLinkButton } from "./people/link-forms";
import { CopyText } from "./copy-text";

export type PendingPerson = { user_id: string; email: string; display_name: string | null; roles: string[]; invited_at: string | null };

const ROLE: Record<string, string> = { coach: "Coach", independent_evaluator: "Evaluator", registrar: "Registrar", announcer: "Announcer" };

function daysAgo(iso: string | null) {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return days <= 0 ? "invited today" : days === 1 ? "invited yesterday" : `invited ${days} days ago`;
}

// On the roadmap: who hasn't signed in yet, with the two ways to help them right there.
export function PendingSignins({ people, seasonId, returnTo }: { people: PendingPerson[]; seasonId: number; returnTo: string }) {
  if (people.length === 0) return null;
  return (
    <details className="mt-3 rounded-lg border border-border bg-background" open={people.length <= 5}>
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-foreground">
        Not signed in yet ({people.length})
      </summary>
      <div className="space-y-2 border-t border-border p-3">
        <p className="text-xs text-muted-foreground">
          &quot;Email invite again&quot; sends Supabase&apos;s invitation email. &quot;Sign-in link&quot; makes a one-time link you can text or email yourself.
        </p>
        <ul className="divide-y divide-border">
          {people.map((p) => (
            <li key={p.user_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">{p.display_name ?? p.email}</span>
                <span className="block text-xs text-muted-foreground">
                  {p.display_name ? `${p.email} · ` : ""}{p.roles.map((r) => ROLE[r] ?? r).join(", ")}{p.invited_at ? ` · ${daysAgo(p.invited_at)}` : ""}
                </span>
              </span>
              <form action={resendInvite}>
                <input type="hidden" name="userId" value={p.user_id} />
                <input type="hidden" name="seasonId" value={seasonId} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <Button type="submit" variant="ghost" size="sm" className="h-8 text-xs"><Mail className="mr-1 h-3.5 w-3.5" /> Email invite again</Button>
              </form>
              <SignInLinkButton userId={p.user_id} seasonId={seasonId} />
            </li>
          ))}
        </ul>
        <CopyText text={people.map((p) => p.email).join(", ")} label="Copy all emails" />
      </div>
    </details>
  );
}
