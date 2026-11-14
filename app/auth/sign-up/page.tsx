// Accounts are invite-only: league admins create them on the People page.
export default function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 text-center">
        <h1 className="text-lg font-semibold text-foreground">Account creation is managed by an administrator</h1>
        <p className="mt-2 text-sm text-muted-foreground">Please contact your league administrator for access.</p>
      </div>
    </div>
  );
}
