
import { AuthButton } from "@/components/auth-button";
import { EnvVarWarning } from "@/components/env-var-warning";
import { hasEnvVars } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";
import { createSeason } from "./actions";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";

function SeasonLoading() {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <p className="text-sm text-gray-500">Loading seasons...</p>
    </section>
  );
}

async function SeasonDashboard() {
  const supabase = await createClient();

  const { data: seasons, error } = await supabase
    .from("seasons")
    .select("id, name, start_date, end_date, is_closed")
    .order("start_date", { ascending: false, nullsFirst: false });

  return (
    <>
      <section className="mb-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold">Create a season</h2>
        <p className="mt-1 text-sm text-gray-600">
          Add a season to begin setting up your evaluation workspace.
        </p>

        <form action={createSeason} className="mt-5 grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="name" className="mb-1 block text-sm font-medium">
              Season name
            </label>
            <input
              id="name"
              name="name"
              required
              placeholder="Spring 2027"
              className="w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </div>

          <div>
            <label htmlFor="start_date" className="mb-1 block text-sm font-medium">
              Start date
            </label>
            <input
              id="start_date"
              name="start_date"
              type="date"
              className="w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </div>

          <div>
            <label htmlFor="end_date" className="mb-1 block text-sm font-medium">
              End date
            </label>
            <input
              id="end_date"
              name="end_date"
              type="date"
              className="w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </div>

          <div className="sm:col-span-3">
            <button
              type="submit"
              className="rounded-md bg-blue-700 px-5 py-2 font-medium text-white hover:bg-blue-800"
            >
              Create season
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold">Seasons</h2>

        {error ? (
          <p className="mt-4 text-sm text-red-700">
            Could not load seasons: {error.message}
          </p>
        ) : seasons && seasons.length > 0 ? (
          <div className="mt-4 divide-y divide-gray-200">
            {seasons.map((season) => (
              <div
                key={season.id}
                className="flex flex-wrap items-center justify-between gap-3 py-4"
              >
                <div>
                  <h3 className="font-semibold">{season.name}</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    {season.start_date || "No start date"} –{" "}
                    {season.end_date || "No end date"}
                  </p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    season.is_closed
                      ? "bg-gray-100 text-gray-600"
                      : "bg-green-100 text-green-800"
                  }`}
                >
                  {season.is_closed ? "Closed" : "Open"}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-gray-600">
            No seasons have been created yet.
          </p>
        )}
      </section>
    </>
  );
}

async function HomeContent() {
  // Supabase auth and season data are request-specific. Keep this route out of
  // build-time prerendering when Cache Components are enabled.
  await connection();

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <Link href="/" className="text-lg font-bold tracking-tight">
            Redwood City Little League
          </Link>
          {!hasEnvVars ? (
            <EnvVarWarning />
          ) : (
            <Suspense fallback={<span className="text-sm text-gray-500">Loading account...</span>}>
              <AuthButton />
            </Suspense>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-10">
        <section className="mb-8">
          <p className="mb-2 text-sm font-semibold uppercase tracking-wider text-blue-700">
            Administration
          </p>
          <h1 className="text-3xl font-bold tracking-tight">
            Player Evaluation Center
          </h1>
          <p className="mt-3 text-gray-600">
            Manage seasons and prepare your league's player evaluations.
          </p>
        </section>

        <Suspense fallback={<SeasonLoading />}>
          <SeasonDashboard />
        </Suspense>
      </div>
    </main>
  );
}


export default function Home() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-gray-50 p-6 text-gray-900">
          <p className="mx-auto max-w-7xl text-sm text-gray-500">Loading Player Evaluation Center...</p>
        </main>
      }
    >
      <HomeContent />
    </Suspense>
  );
}
