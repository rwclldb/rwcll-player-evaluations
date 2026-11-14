import { CircleAlert } from "lucide-react";

// Lists never show birthdates (birthdate protection): this says whether one is on file.
export function DobMarker({ has }: { has: boolean | null | undefined }) {
  return has ? (
    <span title="Birthdate on file" className="inline-flex items-center whitespace-nowrap text-xs font-medium text-emerald-700 dark:text-emerald-400 print:text-black">
      ✓ DOB
    </span>
  ) : (
    <span title="No birthdate on file" className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-amber-700 dark:text-amber-400 print:text-black">
      <CircleAlert className="h-3.5 w-3.5" aria-hidden /> No DOB
    </span>
  );
}
