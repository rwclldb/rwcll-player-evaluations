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
      ]),
    ),
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
    <fieldset className="space-y-3">
      <legend className="font-medium">Player ratings (1–5)</legend>
      <p className="text-xs text-muted-foreground">
        1 is the lowest rating; 5 is the highest. Choose Not scored when a category was not evaluated.
      </p>

      <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-3">
        <div>
          <p className="text-xs text-muted-foreground">Core total</p>
          <p className="text-xl font-semibold" aria-live="polite">
            {summary.count === 0
              ? "—"
              : summary.count === 5
                ? `${summary.total} / 25`
                : `${summary.total} (${summary.count}/5 rated)`}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Core average</p>
          <p className="text-xl font-semibold" aria-live="polite">
            {summary.average === null ? "—" : summary.average.toFixed(1)}
          </p>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <p className="text-xs text-muted-foreground">Core categories rated</p>
          <p className="text-xl font-semibold">{summary.count} of 5</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {categories.map((category) => (
          <div key={category.id} className="space-y-2 text-sm">
            <span className="block font-medium">
              {category.name}
              {category.category_group !== "core" && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {category.category_group}
                </span>
              )}
            </span>
            <div
              className="grid grid-cols-3 gap-2 sm:grid-cols-6"
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
                <span className="flex min-h-12 items-center justify-center rounded-md border px-2 text-center text-sm font-medium transition-colors hover:bg-accent peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2">
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
                  <span className="flex min-h-12 items-center justify-center rounded-md border text-lg font-semibold transition-colors hover:bg-accent peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2">
                    {score}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </fieldset>
  );
}
