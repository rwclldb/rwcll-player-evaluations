import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";

async function LoginContent({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const params = await searchParams;
  return <LoginForm searchParams={params} />;
}

export default function LoginPage({
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
        <LoginContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}