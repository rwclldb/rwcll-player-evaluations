"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/password-input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { loginAction } from "@/app/actions";

export function LoginForm({
  searchParams,
}: {
  searchParams?: { message?: string };
}) {
  return (
    <Card className="w-full max-w-md mx-auto border-border bg-card">
      <CardHeader>
        <CardTitle className="text-xl text-foreground">Sign In</CardTitle>
        <CardDescription className="text-muted-foreground">
          Enter your credentials to access the evaluation portal.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={loginAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" placeholder="coach@rwcll.org" required />
          </div>
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label htmlFor="password">Password</Label>
              <Link href="/auth/forgot-password" className="text-xs text-emerald-700 dark:text-emerald-400 hover:underline">
                Forgot password?
              </Link>
            </div>
            <PasswordInput id="password" name="password" required autoComplete="current-password" className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </div>

          {searchParams?.message && (
            <div className="p-3 text-xs rounded bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-400">
              {searchParams.message}
            </div>
          )}

          <Button type="submit" className="w-full">
            Sign In
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}