"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
            <Input id="password" name="password" type="password" required />
          </div>
          <Button type="submit" className="w-full">
            Update Password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}