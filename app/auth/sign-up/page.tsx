// app/auth/sign-up/page.tsx
import { Suspense } from "react";
import { SignUpForm } from "@/components/sign-up-form";

async function SignUpContent({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const params = await searchParams;
  return <SignUpForm searchParams={params} />;
}

export default function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
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