// app/auth/forgot-password/page.tsx
import { Suspense } from "react";
import { ForgotPasswordForm } from "@/components/forgot-password-form";

async function ForgotPasswordContent({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const params = await searchParams;
  return <ForgotPasswordForm searchParams={params} />;
}

export default function ForgotPasswordPage({
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
        <ForgotPasswordContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}