"use client";

import { Button } from "@/components/ui/button";
import { signOutAction } from "@/app/actions";

export function LogoutButton() {
  return (
    <form action={signOutAction}>
      <Button variant="outline" size="sm" type="submit">
        Log Out
      </Button>
    </form>
  );
}