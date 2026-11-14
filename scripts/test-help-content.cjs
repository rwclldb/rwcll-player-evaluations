// In-app help stays in step with the app (no database needed):
//   * every [[Label]] in lib/help.ts still appears somewhere in the app's code (a renamed button fails this test)
//   * section ids are unique within each guide
//   * every link to /protected/help/<guide>#<section> in the app points at a guide and section that exist
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, { alias: { "@": root } });
const { GUIDES } = jiti(path.join(root, "lib/help.ts"));

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${ok || detail === undefined ? "" : ` (${JSON.stringify(detail)})`}`);
  if (!ok) failed++;
};

// All app source except the help content itself, with HTML entities decoded as they show on screen.
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return /\.(tsx?|jsx?)$/.test(e.name) ? [p] : [];
  });
}
const sources = [...files(path.join(root, "app")), ...files(path.join(root, "components")), ...files(path.join(root, "lib"))]
  .filter((p) => !p.endsWith(path.join("lib", "help.ts")));
const appText = sources.map((p) => fs.readFileSync(p, "utf8")).join("\n")
  .replace(/&amp;/g, "&").replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&rarr;/g, "→").replace(/&nbsp;/g, " ");

const text = (block) => (typeof block === "string" ? [block] : block.steps ?? block.list ?? [block.tip]);
for (const guide of GUIDES) {
  const ids = guide.sections.map((s) => s.id);
  check(`${guide.key}: section ids are unique`, new Set(ids).size === ids.length, ids);
  const labels = [...new Set(guide.sections.flatMap((s) => s.blocks.flatMap(text)).flatMap((t) => [...t.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1])))];
  const missing = labels.filter((l) => !appText.includes(l));
  check(`${guide.key}: all ${labels.length} on-screen labels exist in the app`, missing.length === 0, missing);
}

const links = [...appText.matchAll(/\/protected\/help\/([a-z-]+)(?:#([a-z0-9-]+))?/g)]
  .filter((m) => !m[1].startsWith("$")).map((m) => ({ guide: m[1], section: m[2] }));
const broken = links.filter(({ guide, section }) => {
  const g = GUIDES.find((x) => x.key === guide);
  return !g || (section && !g.sections.some((s) => s.id === section));
});
check(`all ${links.length} help links point at a real guide and section`, broken.length === 0, broken);
// The scoring screen builds its link from a variable; both guides it may open need a "scoring" section.
check("coach and evaluator guides both have a scoring section", ["coach", "evaluator"].every((k) => GUIDES.find((g) => g.key === k)?.sections.some((s) => s.id === "scoring")));

if (failed) { console.error(`FAIL: ${failed} help check(s) failed`); process.exit(1); }
console.log("PASS: help content matches the app");
