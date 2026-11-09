import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function AuthErrorPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <Card className="w-full max-w-md border-border bg-card text-center">
        <CardHeader>
          <CardTitle className="text-xl text-rose-700 dark:text-rose-400">Authentication Error</CardTitle>
          <CardDescription className="text-slate-700 dark:text-slate-300">
            An issue occurred during authentication or link verification.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" className="w-full">
            <Link href="/auth/login">Return to Sign In</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}