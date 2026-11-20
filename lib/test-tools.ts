// Test tools (Test dates) are shown only when ENABLE_TEST_TOOLS=true is set for the app (local or a test server).
// Server-side only: read on each request, so it's never baked into the browser bundle.

export function testToolsEnabled(): boolean {
  return process.env.ENABLE_TEST_TOOLS === "true";
}

export type TestDateMode = "week_before" | "evaluation_day" | "makeup_day" | "after";

export const TEST_DATE_MODES: { mode: TestDateMode; label: string; short: string; detail: string }[] = [
  { mode: "week_before", label: "Make today the week before", short: "a week before evaluations", detail: "The first evaluation day is a week from today: the roadmap shows Evaluation week (rosters, QR codes, who has not signed in)." },
  { mode: "evaluation_day", label: "Make today evaluation day", short: "evaluation day is today", detail: "The first evaluation day is today: Check-in, Call players, Here, Now up and Scoring progress work as on the day." },
  { mode: "makeup_day", label: "Make today a makeup day", short: "a makeup day is today", detail: "The first makeup is today and the main days are before it: makeup lists leave out players already called or scored." },
  { mode: "after", label: "Make evaluations finished", short: "evaluations finished yesterday", detail: "The last event was yesterday: the roadmap shows After evaluations, and the end-of-day check lists anyone never checked in." },
];

export function modeLabel(mode: string | null | undefined): string {
  return TEST_DATE_MODES.find((m) => m.mode === mode)?.short ?? "moved";
}
