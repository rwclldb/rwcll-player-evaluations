const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8")
);

const testScripts = Object.keys(packageJson.scripts || {})
  .filter((name) => name.startsWith("test:") && name !== "test:all")
  .sort();

const checks = [
  ...testScripts.map((name) => ({
    name,
    command: ["run", name],
  })),
  { name: "lint", command: ["run", "lint"] },
  { name: "TypeScript", command: ["exec", "--", "tsc", "--noEmit"] },
  { name: "production build", command: ["run", "build"] },
];

if (testScripts.length === 0) {
  console.error("No test:* scripts found in package.json.");
  process.exit(1);
}

const resultsDir = path.join(root, "test-results");
fs.mkdirSync(resultsDir, { recursive: true });

const timestamp = new Date()
  .toISOString()
  .replace(/:/g, "-")
  .replace(/\.\d{3}Z$/, "Z");

const logPath = path.join(resultsDir, `test-run-${timestamp}.txt`);
const lines = [];
const results = [];

const write = (value = "") => {
  lines.push(value);
  console.log(value);
};

write("RWCLL Player Evaluations - Full Validation Run");
write(`Started: ${new Date().toISOString()}`);
write(`Project: ${root}`);
write(`Import test scripts: ${testScripts.length}`);
write(`Total checks: ${checks.length}`);
write("");

for (const check of checks) {
  write("=".repeat(72));
  write(`RUNNING: ${check.name}`);
  write(`COMMAND: npm ${check.command.join(" ")}`);
  write("=".repeat(72));

  const result = spawnSync("npm", check.command, {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  });

  const output = [
    result.stdout || "",
    result.stderr || "",
  ].filter(Boolean).join("");

  if (output) write(output.trimEnd());
  if (result.error) write(`Runner error: ${result.error.message}`);
  if (result.signal) write(`Process terminated by signal: ${result.signal}`);

  const passed = result.status === 0 && !result.error;
  results.push({ name: check.name, status: passed ? "PASS" : "FAIL" });

  write("");
  write(`${passed ? "PASS" : "FAIL"}: ${check.name}`);
  write("");
}

const passedCount = results.filter((r) => r.status === "PASS").length;
const failedCount = results.length - passedCount;

write("=".repeat(72));
write("SUMMARY");
write("=".repeat(72));

for (const result of results) {
  write(`${result.status.padEnd(4)} ${result.name}`);
}

write("");
write(`Total: ${results.length}`);
write(`Passed: ${passedCount}`);
write(`Failed: ${failedCount}`);
write(`Finished: ${new Date().toISOString()}`);
write(`Overall result: ${failedCount === 0 ? "PASS" : "FAIL"}`);

fs.writeFileSync(logPath, lines.join("\n") + "\n", "utf8");

console.log("");
console.log(`Full report saved to: ${logPath}`);

if (failedCount > 0) process.exitCode = 1;
