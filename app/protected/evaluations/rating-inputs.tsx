"use client";

import { useMemo, useState } from "react";

type RatingCategory = {
  id: number;
  code: string;
  name: string;
  category_group: string;
  sort_order: number;
};

type RatingInputsProps = {
  categories: RatingCategory[];
  initialScores: Record<string, number | null>;
};

const CORE_CODES = [
  "hitting",
  "throwing",
  "grounders",
  "fly_balls",
  "running_awareness",
] as const;

export function RatingInputs({
  categories,
  initialScores,
}: RatingInputsProps) {
  const [scores, setScores] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      categories.map((category) => [
        category.code,
        initialScores[category.code] == null
          ? ""
          : String(initialScores[category.code]),
      ])
    )
  );

  const summary = useMemo(() => {
    const scored = CORE_CODES.flatMap((code) => {
      const raw = scores[code] ?? "";
      return raw === "" ? [] : [Number(raw)];
    });
    const total = scored.reduce((sum, score) => sum + score, 0);
    const average = scored.length ? total / scored.length : null;
    return { count: scored.length, total, average };
  }, [scores]);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h4 className="text-xs font-bold text-foreground font-mono uppercase tracking-wider">
          Player Ratings (1–5 Scale)
        </h4>
        <p className="text-[11px] text-muted-foreground font-mono">
          1 is the lowest rating; 5 is the highest. Choose &quot;Not scored&quot; when a category was not evaluated.
        </p>
      </div>

      {/* Dynamic Score Summary Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 rounded-lg border border-border bg-background p-3 text-xs">
        <div>
          <p className="text-[11px] font-mono text-muted-foreground">Core Total</p>
          <p className="text-lg font-bold text-foreground font-mono mt-0.5" aria-live="polite">
            {summary.count === 0
              ? "—"
              : summary.count === 5
              ? `${summary.total} / 25`
              : `${summary.total} (${summary.count}/5 rated)`}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-mono text-muted-foreground">Core Average</p>
          <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400 font-mono mt-0.5" aria-live="polite">
            {summary.average === null ? "—" : summary.average.toFixed(1)}
          </p>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <p className="text-[11px] font-mono text-muted-foreground">Core Categories Rated</p>
          <p className="text-lg font-bold text-foreground font-mono mt-0.5">
            {summary.count} of 5
          </p>
        </div>
      </div>

      {/* Rating Options Grid */}
      <div className="grid gap-4 sm:grid-cols-2">
        {categories.map((category) => (
          <div key={category.id} className="space-y-2 text-xs">
            <span className="font-semibold text-slate-700 dark:text-slate-200 block">
              {category.name}
              {category.category_group !== "core" && (
                <span className="ml-2 text-[10px] font-mono text-muted-foreground uppercase">
                  ({category.category_group})
                </span>
              )}
            </span>
            <div
              className="grid grid-cols-3 sm:grid-cols-6 gap-1.5"
              role="group"
              aria-label={`${category.name} rating`}
            >
              <label className="cursor-pointer">
                <input
                  type="radio"
                  name={`rating_${category.code}`}
                  value=""
                  checked={(scores[category.code] ?? "") === ""}
                  onChange={() =>
                    setScores((current) => ({ ...current, [category.code]: "" }))
                  }
                  className="peer sr-only"
                />
                <span className="flex min-h-10 items-center justify-center rounded-md border border-border bg-card px-1 text-center text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent peer-checked:border-emerald-500 peer-checked:bg-emerald-600/20 peer-checked:text-emerald-400">
                  Not scored
                </span>
              </label>
              {[1, 2, 3, 4, 5].map((score) => (
                <label key={score} className="cursor-pointer">
                  <input
                    type="radio"
                    name={`rating_${category.code}`}
                    value={score}
                    checked={scores[category.code] === String(score)}
                    onChange={() =>
                      setScores((current) => ({
                        ...current,
                        [category.code]: String(score),
                      }))
                    }
                    className="peer sr-only"
                  />
                  <span className="flex min-h-10 items-center justify-center rounded-md border border-border bg-card text-sm font-bold font-mono text-slate-700 dark:text-slate-200 transition-colors hover:bg-accent peer-checked:border-emerald-500 peer-checked:bg-emerald-600 peer-checked:text-foreground">
                    {score}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}