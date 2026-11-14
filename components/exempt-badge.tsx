// Marks a player with an exemption (see migration 20261117090000). Everyone who can see the player sees the scope;
// only admins and registrars see the reason and approver.
export type ExemptScope = "attendance" | "evaluation" | "both";

export const EXEMPT_LABEL: Record<ExemptScope, string> = {
  attendance: "Exempt from attending",
  evaluation: "Exempt from evaluation",
  both: "Exempt (attending and evaluation)",
};

export function ExemptBadge({ scope, short = false }: { scope: ExemptScope; short?: boolean }) {
  return (
    <span title={EXEMPT_LABEL[scope]}
      className="inline-flex shrink-0 items-center rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-800 dark:text-violet-300 print:border print:border-black print:bg-transparent print:text-black">
      {short ? "Exempt" : EXEMPT_LABEL[scope]}
    </span>
  );
}
