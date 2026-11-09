// app/auth/sign-up/page.tsx
import { Suspense } from "react";
import { SignUpForm } from "@/components/sign-up-form";

async function SignUpContent({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const params = await searchParams;
  const publicSignUpEnabled = process.env.ALLOW_PUBLIC_SIGNUP === "true";
  if (!publicSignUpEnabled) return null;
  return <SignUpForm searchParams={params} />;
}

export default function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  if (process.env.ALLOW_PUBLIC_SIGNUP !== "true") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
        <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 text-center">
          <h1 className="text-lg font-semibold text-foreground">Account creation is managed by an administrator</h1>
          <p className="mt-2 text-sm text-muted-foreground">Please contact your league administrator for access.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <Suspense
        fallback={
          <div className="h-96 w-full max-w-md rounded-lg border border-border bg-card animate-pulse" />
        }
      >
        <SignUpContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}