"use client";

import { useActionState, useState } from "react";
import { Copy, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { invitePerson, signInLink, type FormResult } from "./actions";

const input = "mt-1 block h-10 w-full rounded-md border border-input bg-background px-3 text-base text-foreground sm:text-sm";

function LinkBox({ result }: { result: FormResult }) {
  const [copied, setCopied] = useState(false);
  if (!result) return null;
  return (
    <div role={result.ok ? "status" : "alert"}
      className={`space-y-2 rounded-md border p-2 text-sm ${result.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200" : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"}`}>
      <p>{result.message}</p>
      {result.link && (
        <div className="flex flex-wrap items-center gap-2">
          <input readOnly value={result.link} onFocus={(e) => e.currentTarget.select()} aria-label="Sign-in link"
            className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 font-mono text-xs text-foreground" />
          <Button type="button" size="sm" variant="outline" className="h-8"
            onClick={async () => { await navigator.clipboard.writeText(result.link!); setCopied(true); }}>
            <Copy className="mr-1 h-3.5 w-3.5" /> {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      )}
    </div>
  );
}

export function InviteForm({ seasonId, seasonName, disabled }: { seasonId: number | null; seasonName: string; disabled: boolean }) {
  const [result, action, pending] = useActionState(invitePerson, null);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="seasonId" value={seasonId ?? ""} />
      <label className="text-xs text-muted-foreground">Name<input name="name" placeholder="First Last" className={input} /></label>
      <label className="text-xs text-muted-foreground">Email<input name="email" type="email" required className={input} /></label>
      <label className="text-xs text-muted-foreground">Role
        <select name="role" className={input} defaultValue="coach">
          <option value="coach">Coach ({seasonName})</option>
          <option value="independent_evaluator">Independent evaluator ({seasonName})</option>
          <option value="administrator">League admin (all seasons)</option>
        </select>
      </label>
      <label className="text-xs text-muted-foreground">How they get in
        <select name="delivery" className={input} defaultValue="email">
          <option value="email">Email them an invitation</option>
          <option value="link">Give me a link to send myself</option>
        </select>
      </label>
      <div className="flex items-end justify-end sm:col-span-2">
        <Button type="submit" disabled={disabled || pending} className="h-10">{pending ? "Working..." : "Invite"}</Button>
      </div>
      <div className="sm:col-span-2"><LinkBox result={result} /></div>
    </form>
  );
}

// Per-person: a fresh one-time link that signs them in and asks for a new password.
export function SignInLinkButton({ userId, seasonId }: { userId: string; seasonId: number | null }) {
  const [result, action, pending] = useActionState(signInLink, null);
  return (
    <form action={action} className="contents">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="seasonId" value={seasonId ?? ""} />
      <Button type="submit" variant="ghost" size="sm" className="h-8 text-xs" disabled={pending}>
        <Link2 className="mr-1 h-3.5 w-3.5" /> Sign-in link
      </Button>
      {result && <div className="w-full"><LinkBox result={result} /></div>}
    </form>
  );
}
