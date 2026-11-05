
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { createClient } = require("@supabase/supabase-js");

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function requireSuccess(result, description) {
  if (result.error) {
    throw new Error(`${description}: ${result.error.message}`);
  }
  return result.data;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const values = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    values[match[1]] = value;
  }
  return values;
}

function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    if (hidden && process.stdin.isTTY) {
      process.stdout.write(question);
      let answer = "";

      const onData = (chunk) => {
        const char = chunk.toString();
        if (char === "\r" || char === "\n") {
          process.stdout.write("\n");
          process.stdin.removeListener("data", onData);
          process.stdin.setRawMode(false);
          process.stdin.pause();
          rl.close();
          resolve(answer);
        } else if (char === "\u0003") {
          process.exit(1);
        } else if (char === "\u007f" || char === "\b") {
          answer = answer.slice(0, -1);
        } else {
          answer += char;
        }
      };

      process.stdin.resume();
      process.stdin.setRawMode(true);
      process.stdin.on("data", onData);
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

function getBatchId(data) {
  if (typeof data === "number" || typeof data === "string") {
    return Number(data);
  }
  if (Array.isArray(data) && data.length === 1) {
    return getBatchId(data[0]);
  }
  if (data && typeof data === "object") {
    const id = data.id ?? data.batch_id ?? data.import_batch_id;
    if (id !== undefined) return Number(id);
  }
  throw new Error(`Unexpected staging result: ${JSON.stringify(data)}`);
}

async function main() {
  requireCondition(
    process.env.ALLOW_LOCAL_IMPORT_TESTS === "YES",
    "Safety stop: set ALLOW_LOCAL_IMPORT_TESTS=YES to authorize this local-only test."
  );

  const root = path.resolve(__dirname, "..");
  const env = {
    ...loadEnvFile(path.join(root, ".env")),
    ...loadEnvFile(path.join(root, ".env.local")),
    ...process.env,
  };

  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  requireCondition(url && key, "Local Supabase URL or publishable/anon key is missing.");

  const parsed = new URL(url);
  requireCondition(
    parsed.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(parsed.hostname) &&
      parsed.port === "54321",
    `Safety stop: local Supabase only. Configured URL: ${url}`
  );

  console.log(`Local-only URL verified: ${parsed.origin}`);

  const email = await ask("Local Supabase administrator email: ");
  const password = await ask("Local Supabase administrator password: ", true);
  requireCondition(email && password, "Administrator credentials are required.");

  const client = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  const signIn = requireSuccess(
    await client.auth.signInWithPassword({ email, password }),
    "Local administrator sign-in failed"
  );
  requireCondition(signIn.user, "Sign-in did not return a user.");

  requireCondition(
    requireSuccess(await client.rpc("is_admin"), "Could not verify administrator") === true,
    "Safety stop: this local account is not an administrator."
  );
  console.log("PASS: Local administrator verified.");

  const seasonId = 1;
  const season = requireSuccess(
    await client.from("seasons").select("id").eq("id", seasonId).maybeSingle(),
    "Could not check local season"
  );
  requireCondition(season, `Local season ${seasonId} does not exist.`);

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const externalPlayerId = `LOCAL-DUP-RESOLVE-${suffix}`;

  const rows = [
    {
      line: 2,
      playerId: externalPlayerId,
      firstName: "Unresolved",
      lastName: "SyntheticTest",
      birthDate: "2016-01-01",
      program: "Baseball",
      division: "AAA",
      registrationNumber: `LOCAL-DUP-REG-A-${suffix}`,
      paymentStatus: "Paid",
      leagueAge: 10,
      issues: ["Duplicate Player ID in file"],
    },
    {
      line: 3,
      playerId: externalPlayerId,
      firstName: "Resolved",
      lastName: "SyntheticTest",
      birthDate: "2016-02-02",
      program: "Baseball",
      division: "AAA",
      registrationNumber: `LOCAL-DUP-REG-B-${suffix}`,
      paymentStatus: "Paid",
      leagueAge: 10,
      issues: ["Duplicate Player ID in file"],
    },
  ];

  const staged = requireSuccess(
    await client.rpc("stage_sports_connect_import", {
      p_season_id: seasonId,
      p_source_file_name: `local-duplicate-resolution-${suffix}.csv`,
      p_rows: rows,
    }),
    "Could not stage synthetic duplicate rows"
  );

  const batchId = getBatchId(staged);
  const stagedRows = requireSuccess(
    await client
      .from("sports_connect_import_rows")
      .select("id, source_row_number, review_flags")
      .eq("import_batch_id", batchId)
      .order("source_row_number"),
    "Could not retrieve the synthetic rows"
  );

  requireCondition(stagedRows.length === 2, "Expected exactly two staged rows.");

  for (const row of stagedRows) {
    requireCondition(
      Array.isArray(row.review_flags) &&
        row.review_flags.includes("Duplicate Player ID in file"),
      `Row ${row.id} was not flagged as a duplicate Player ID. Flags: ${JSON.stringify(row.review_flags)}`
    );

    requireSuccess(
      await client.rpc("review_sports_connect_import_row", {
        p_row_id: row.id,
        p_decision: "approved_new",
        p_matched_player_id: null,
        p_reason: "Local regression test: synthetic duplicate Player ID",
      }),
      `Could not approve synthetic row ${row.id}`
    );
  }

  console.log(`PASS: Both rows in batch ${batchId} have the duplicate warning.`);

  // Attempt to commit the first row without resolving its warning.
  const unresolvedRow = stagedRows[0];
  const rejected = await client.rpc("commit_sports_connect_import_row", {
    p_row_id: unresolvedRow.id,
    p_reason: "Local regression test: warning intentionally unresolved",
  });

  requireCondition(
    rejected.error,
    "FAIL: Commit unexpectedly succeeded while the duplicate Player ID warning was unresolved."
  );

  console.log(`PASS: Unresolved warning blocked commit (${rejected.error.message}).`);

  const unresolvedAfter = requireSuccess(
    await client
      .from("sports_connect_import_rows")
      .select("review_state, committed_player_season_id, duplicate_player_id_resolved_at")
      .eq("id", unresolvedRow.id)
      .single(),
    "Could not verify the rejected row"
  );

  requireCondition(
    unresolvedAfter.review_state !== "committed" &&
      unresolvedAfter.committed_player_season_id === null &&
      unresolvedAfter.duplicate_player_id_resolved_at === null,
    "FAIL: The unresolved row appears committed or its resolution fields changed."
  );

  // Explicitly resolve the second row. The other row remains uncommitted,
  // so this test does not create a database identifier collision.
  const resolvedRow = stagedRows[1];
  requireSuccess(
    await client.rpc("resolve_duplicate_player_id_warning", {
      p_row_id: resolvedRow.id,
      p_reason: "Synthetic test: verified duplicate entry; testing explicit resolution",
    }),
    "Could not resolve the duplicate Player ID warning"
  );

  const resolution = requireSuccess(
    await client
      .from("sports_connect_import_rows")
      .select("duplicate_player_id_resolved_at, duplicate_player_id_resolution_reason")
      .eq("id", resolvedRow.id)
      .single(),
    "Could not verify duplicate warning resolution"
  );

  requireCondition(
    resolution.duplicate_player_id_resolved_at &&
      resolution.duplicate_player_id_resolution_reason,
    "FAIL: Resolution timestamp or reason was not saved."
  );

  console.log("PASS: Explicit duplicate warning resolution was recorded.");

  const committedId = requireSuccess(
    await client.rpc("commit_sports_connect_import_row", {
      p_row_id: resolvedRow.id,
      p_reason: "Local regression test: commit after explicit warning resolution",
    }),
    "Commit failed after explicit warning resolution"
  );

  requireCondition(
    committedId !== null && committedId !== undefined,
    "FAIL: Commit did not return a registration ID."
  );

  const committedRow = requireSuccess(
    await client
      .from("sports_connect_import_rows")
      .select("review_state, committed_player_season_id, duplicate_player_id_resolved_at")
      .eq("id", resolvedRow.id)
      .single(),
    "Could not verify the resolved row after commit"
  );

  requireCondition(
    committedRow.review_state === "committed" &&
      Number(committedRow.committed_player_season_id) === Number(committedId) &&
      committedRow.duplicate_player_id_resolved_at,
    "FAIL: Resolved row did not reach the expected committed state."
  );

  console.log("PASS: Resolved row committed successfully.");
  console.log("");
  console.log("OVERALL RESULT: PASS");
  console.log(`Local season: ${seasonId}`);
  console.log(`Test batch: ${batchId}`);
  console.log(`Unresolved row (not committed): ${unresolvedRow.id}`);
  console.log(`Resolved row (committed): ${resolvedRow.id}`);
  console.log("Synthetic test records were retained for inspection.");
}

main().catch((error) => {
  console.error("");
  console.error("OVERALL RESULT: FAIL");
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
