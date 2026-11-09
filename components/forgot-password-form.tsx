"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { forgotPasswordAction } from "@/app/actions";

export function ForgotPasswordForm({
  searchParams,
}: {
  searchParams?: { message?: string };
}) {
  return (
    <Card className="w-full max-w-md mx-auto border-border bg-card">
      <CardHeader>
        <CardTitle className="text-xl text-foreground">Reset Password</CardTitle>
        <CardDescription className="text-muted-foreground">
          Enter your email to receive a password reset link.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={forgotPasswordAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email address</Label>
            <Input id="email" name="email" type="email" placeholder="you@example.com" required />
          </div>

          {searchParams?.message && (
            <div className="p-3 text-xs rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400">
              {searchParams.message}
            </div>
          )}

          <Button type="submit" className="w-full">
            Send Reset Link
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}