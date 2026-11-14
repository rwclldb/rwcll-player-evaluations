// Marks a registration flagged as a coach's kid. The app only shows the flag; draft rules are the league's.
export function CoachKidBadge({ short = false }: { short?: boolean }) {
  return (
    <span title="Coach's kid" className="inline-flex shrink-0 items-center rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-800 dark:text-sky-300 print:border print:border-black print:bg-transparent print:text-black">
      {short ? "CK" : "Coach's kid"}
    </span>
  );
}
