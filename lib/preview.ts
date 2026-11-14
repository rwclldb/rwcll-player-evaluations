// "View as" preview marker for the browser. Set by /auth/confirm when an admin's preview starts and cleared by
// /auth/end-preview. Only used to word messages ("read-only"); the server and database do the actual refusing.
export const PREVIEW_COOKIE = "rwcll_preview";
export const PREVIEW_MESSAGE = "Admin preview is read-only: nothing is saved.";

export function inPreviewBrowser(): boolean {
  return typeof document !== "undefined" && document.cookie.split("; ").some((c) => c.startsWith(`${PREVIEW_COOKIE}=`));
}
