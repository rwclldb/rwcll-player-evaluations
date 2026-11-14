"use client";

import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/password-input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { updatePasswordAction } from "@/app/actions";

export function UpdatePasswordForm() {
  return (
    <Card className="w-full max-w-md mx-auto border-border bg-card">
      <CardHeader>
        <CardTitle className="text-xl text-foreground">Set New Password</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={updatePasswordAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">New Password</Label>
            <PasswordInput id="password" name="password" required minLength={8} autoComplete="new-password" className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </div>
          <Button type="submit" className="w-full">
            Update Password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}