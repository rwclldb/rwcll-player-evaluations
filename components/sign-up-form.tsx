"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { signUpAction } from "@/app/actions";

export function SignUpForm({
  searchParams,
}: {
  searchParams?: { message?: string };
}) {
  return (
    <Card className="w-full max-w-md mx-auto border-border bg-card">
      <CardHeader>
        <CardTitle className="text-xl text-foreground">Create Account</CardTitle>
        <CardDescription className="text-muted-foreground">
          Sign up to assist with RWCLL player evaluations.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={signUpAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" placeholder="evaluator@rwcll.org" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" required />
          </div>

          {searchParams?.message && (
            <div className="p-3 text-xs rounded bg-rose-500/10 border border-rose-500/20 text-rose-400">
              {searchParams.message}
            </div>
          )}

          <Button type="submit" className="w-full">
            Create Account
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}