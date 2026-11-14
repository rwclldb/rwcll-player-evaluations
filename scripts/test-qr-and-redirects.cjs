// QR codes and "come back after signing in" (no database needed):
//   * safeNext only allows pages inside the app, never another site
//   * qrSvg makes an SVG for a link
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, { alias: { "@": root } });
const { safeNext } = jiti(path.join(root, "lib/safe-next.ts"));
const { qrSvg } = jiti(path.join(root, "lib/qr.ts"));

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${ok || detail === undefined ? "" : ` (${JSON.stringify(detail)})`}`);
  if (!ok) failed++;
};

const cases = [
  ["/protected/evaluations?sessionId=3", "/protected/evaluations?sessionId=3"],
  ["/protected", "/protected"],
  ["https://evil.example/protected", "/protected"],
  ["//evil.example/protected", "/protected"],
  ["/protected\\..\\evil", "/protected"],
  ["/auth/login", "/protected"],
  ["/protected\r\nSet-Cookie: x", "/protected"],
  [undefined, "/protected"],
];
for (const [input, want] of cases) check(`safeNext(${JSON.stringify(input)}) is ${want}`, safeNext(input) === want, safeNext(input));

(async () => {
  const svg = await qrSvg("https://example.test/protected/evaluations?sessionId=12");
  check("qrSvg returns an SVG with dark modules", svg.startsWith("<svg") && svg.includes("<path") && svg.includes("#000000"), svg.slice(0, 80));
  if (failed) { console.error(`FAIL: ${failed} check(s) failed`); process.exit(1); }
  console.log("PASS: QR codes and sign-in redirects");
})();
