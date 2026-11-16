import { DobMarker } from "@/components/dob-marker";
import { RevealBirthdate } from "@/components/reveal-birthdate";

// Sports Connect import rows forget their copy of the birthdate once they are handled (birthdate protection),
// so a handled row can't speak for itself. Rows still waiting show the file's birthdate; committed and
// already-registered rows show the player record's; ignored rows show a dash.
export const HANDLED_IMPORT_STATES = new Set(["committed", "ignored", "up_to_date", "changes_reviewed"]);

export function ImportRowDob({
  rowId, reviewState, stagedHas, registrationId, registrationHas, context,
}: {
  rowId: number;
  reviewState: string;
  stagedHas: boolean;
  registrationId: number | null;
  registrationHas: boolean | null | undefined;
  context: string;
}) {
  if (!HANDLED_IMPORT_STATES.has(reviewState)) {
    return stagedHas ? <RevealBirthdate kind="import_row" id={rowId} context={context} label="✓ Show" /> : <DobMarker has={false} />;
  }
  if (registrationId === null) {
    return (
      <span title="This row was set aside, so the import's copy of the birthdate was cleared." className="text-xs text-muted-foreground">—</span>
    );
  }
  return (
    <span className="inline-flex flex-col items-start gap-0.5"
      title="The import's copy of the birthdate is cleared once a row is handled. This is the player record's birthdate.">
      {registrationHas ? <RevealBirthdate kind="registration" id={registrationId} context={context} label="✓ Show" /> : <DobMarker has={false} />}
      <span className="text-[10px] text-muted-foreground">player record</span>
    </span>
  );
}
