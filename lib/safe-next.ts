// Where to go after signing in. Only pages inside the app (/protected...) are allowed, so a link can never send
// someone to another site ("//evil.example", "https://...", backslashes are all refused).
export function safeNext(value: unknown): string {
  const next = typeof value === "string" ? value.trim() : "";
  if (!next.startsWith("/protected") || next.startsWith("//") || next.includes("\\") || /[\r\n]/.test(next)) return "/protected";
  return next;
}
