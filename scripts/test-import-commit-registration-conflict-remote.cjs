
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { createClient } = require("@supabase/supabase-js");

const EXPECTED_REMOTE_HOST = "szklvgrecvrxcgmkopso.supabase.co";
const REQUIRED_CONFIRMATION = "YES";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const values = {};
  const contents = fs.readFileSync(filePath, "utf8");

  for (const rawLine of contents.split(/\r?\n/)) {
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

function readLine(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function readHiddenPassword(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    stdout.write(question);

    if (!stdin.isTTY) {
      readLine("").then(resolve);
      return;
    }

    let password = "";

    function onData(character) {
      const char = character.toString();

      if (char === "\u0003") {
        stdout.write("\n");
        cleanup();
        process.exit(1);
      }

      if (char === "\r" || char === "\n") {
        stdout.write("\n");
        cleanup();
        resolve(password);
        return;
      }

      if (char === "\u007f" || char === "\b") {
        password = password.slice(0, -1);
        return;
      }

      password += char;
    }

    function cleanup() {
      stdin.removeListener("data", onData);
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
    }

    stdin.resume();
    stdin.setRawMode(true);
    stdin.on("data", onData);
  });
}

function requireSuccess(result, description) {
  if (result.error) {
    throw new Error(`${description}: ${result.error.message}`);
  }

  return result.data;
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function countResult(result, description) {
  if (result.error) {
    throw new Error(`${description}: ${result.error.message}`);
  }

  requireCondition(
    typeof result.count === "number",
    `${description}: the database did not return a count.`
  );

  return result.count;
}

function getBatchId(data) {
  if (typeof data === "number" || typeof data === "string") {
    return Number(data);
  }

  if (Array.isArray(data) && data.length === 1) {
    return getBatchId(data[0]);
  }

  if (data && typeof data === "object") {
    const candidate = data.id ?? data.batch_id ?? data.import_batch_id;
    if (candidate !== undefined) return Number(candidate);
  }

  throw new Error(
    `Could not interpret the staging RPC result as a batch ID: ${JSON.stringify(data)}`
  );
}

async function countRows(client, table, configure, description) {
  let query = client.from(table).select("id", {
    count: "exact",
    head: true,
  });

  if (configure) query = configure(query);

  return countResult(await query, description);
}

async function stageOneRow(client, seasonId, fileName, row) {
  const data = requireSuccess(
    await client.rpc("stage_sports_connect_import", {
      p_season_id: seasonId,
      p_source_file_name: fileName,
      p_rows: [row],
    }),
    `Could not stage ${fileName}`
  );

  const batchId = getBatchId(data);

  const stagedRows = requireSuccess(
    await client
      .from("sports_connect_import_rows")
      .select("id")
      .eq("import_batch_id", batchId),
    `Could not retrieve staged rows for batch ${batchId}`
  );

  requireCondition(
    Array.isArray(stagedRows) && stagedRows.length === 1,
    `Expected exactly one staged row in batch ${batchId}; found ${
      Array.isArray(stagedRows) ? stagedRows.length : "an unexpected result"
    }.`
  );

  return { batchId, rowId: stagedRows[0].id };
}

async function reviewRow(client, rowId, decision, matchedPlayerId, reason) {
  requireSuccess(
    await client.rpc("review_sports_connect_import_row", {
      p_row_id: rowId,
      p_decision: decision,
      p_matched_player_id: matchedPlayerId,
      p_reason: reason,
    }),
    `Could not mark staged row ${rowId} as ${decision}`
  );
}

async function main() {
  if (process.env.ALLOW_REMOTE_IMPORT_TESTS !== REQUIRED_CONFIRMATION) {
  throw new Error(
    "Safety stop: set ALLOW_REMOTE_IMPORT_TESTS=YES to authorize this remote-only test."
  );
}

  const repoRoot = path.resolve(__dirname, "..");
  const env = {
    ...loadEnvFile(path.join(repoRoot, ".env")),
    ...loadEnvFile(path.join(repoRoot, ".env.local")),
    ...process.env,
  };

  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  requireCondition(
    supabaseUrl,
    "NEXT_PUBLIC_SUPABASE_URL is missing from .env or .env.local."
  );
  requireCondition(
    supabaseKey,
    "Set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env or .env.local."
  );

  const parsedUrl = new URL(supabaseUrl);

  requireCondition(
  parsedUrl.protocol === "https:" &&
    parsedUrl.hostname === EXPECTED_REMOTE_HOST &&
    parsedUrl.port === "",
  `Safety stop: this script only permits the expected remote Supabase project at https://${EXPECTED_REMOTE_HOST}. Configured URL: ${supabaseUrl}`
);

console.log(`Remote-only URL verified: ${parsedUrl.origin}`);

  const email = await readLine("Remote Supabase administrator email: ");
  requireCondition(email, "Administrator email is required.");

  const password = await readHiddenPassword(
    "Local Supabase administrator password: "
  );
  requireCondition(password, "Administrator password is required.");

  const client = createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  const signIn = requireSuccess(
    await client.auth.signInWithPassword({ email, password }),
    "Could not sign in to local Supabase"
  );

  requireCondition(signIn.user, "Sign-in did not return a user.");

  console.log("PASS: Signed in to local Supabase.");

  const adminResult = await client.rpc("is_admin");
  requireSuccess(adminResult, "Could not verify administrator authorization");

  requireCondition(
    adminResult.data === true,
    "Safety stop: the signed-in remote account is not an administrator."
  );

  console.log("PASS: Administrator authorization verified.");

  const seasonId = 1;

  const season = requireSuccess(
    await client.from("seasons").select("id").eq("id", seasonId).maybeSingle(),
    `Could not verify remote season ${seasonId}`
  );

  requireCondition(
    season,
    `Remote season ID ${seasonId} does not exist. No test records were created. Create or select a remote test season, then update seasonId in this script if necessary.`
  );

  console.log(`PASS: Remote season ${seasonId} exists.`);

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const externalPlayerId = `LOCAL-CONFLICT-${suffix}`;
  const externalRegistrationId = `LOCAL-CONFLICT-REG-${suffix}`;
  const secondExternalPlayerId = `LOCAL-CONFLICT-MATCH-${suffix}`;
  const secondExternalRegistrationId = `LOCAL-CONFLICT-MATCH-REG-${suffix}`;

  const firstRow = {
    line: 2,
    playerId: externalPlayerId,
    firstName: "LocalConflict",
    lastName: "SyntheticPlayer",
    birthDate: "2016-01-01",
    program: "Baseball",
    division: "AAA",
    registrationNumber: externalRegistrationId,
    paymentStatus: "Paid",
    leagueAge: 10,
    issues: [],
  };

  const firstBatch = await stageOneRow(
    client,
    seasonId,
    `local-conflict-first-${suffix}.csv`,
    firstRow
  );

  console.log(`PASS: Created first staging batch ${firstBatch.batchId}.`);

  await reviewRow(
    client,
    firstBatch.rowId,
    "approved_new",
    null,
    "Local integration test: create synthetic player and registration"
  );

  const firstCommitResult = await client.rpc(
    "commit_sports_connect_import_row",
    {
      p_row_id: firstBatch.rowId,
      p_reason: "Local integration test: create synthetic player and registration",
    }
  );

  const playerSeasonId = requireSuccess(
    firstCommitResult,
    "First synthetic commit failed"
  );

  requireCondition(
    playerSeasonId !== null && playerSeasonId !== undefined,
    "First commit did not return a player-season registration ID."
  );

  const committedRegistration = requireSuccess(
    await client
      .from("player_seasons")
      .select("id, player_id, season_id")
      .eq("id", playerSeasonId)
      .single(),
    "Could not verify the first synthetic registration"
  );

  requireCondition(
    Number(committedRegistration.season_id) === seasonId,
    "First synthetic registration has the wrong season."
  );

  const playerId = committedRegistration.player_id;

  console.log(
    `PASS: Created synthetic player ${playerId} and registration ${playerSeasonId}.`
  );

  const originalPlayer = requireSuccess(
    await client
      .from("players")
      .select("*")
      .eq("id", playerId)
      .single(),
    "Could not capture the synthetic player's original values"
  );

  const secondRow = {
    line: 2,
    playerId: secondExternalPlayerId,
    firstName: "DifferentImportName",
    lastName: "MustNotOverwrite",
    birthDate: "2015-02-03",
    program: "Baseball",
    division: "AAA",
    registrationNumber: secondExternalRegistrationId,
    paymentStatus: "Paid",
    leagueAge: 11,
    issues: [],
  };

  const secondBatch = await stageOneRow(
    client,
    seasonId,
    `local-conflict-match-${suffix}.csv`,
    secondRow
  );

  console.log(`PASS: Created second staging batch ${secondBatch.batchId}.`);

  await reviewRow(
    client,
    secondBatch.rowId,
    "approved_match",
    playerId,
    "Local integration test: match an already registered synthetic player"
  );

  console.log(`PASS: Staged row ${secondBatch.rowId} is approved_match.`);

  const playerRegistrationsBefore = await countRows(
    client,
    "player_seasons",
    (query) => query.eq("player_id", playerId).eq("season_id", seasonId),
    "Could not count the player's registrations before the expected conflict"
  );

  const playerCountBefore = await countRows(
    client,
    "players",
    null,
    "Could not count players before the expected conflict"
  );

  const registrationCountBefore = await countRows(
    client,
    "player_seasons",
    null,
    "Could not count registrations before the expected conflict"
  );

  const batchBefore = requireSuccess(
    await client
      .from("import_batches")
      .select("rows_processed")
      .eq("id", secondBatch.batchId)
      .single(),
    "Could not read the second batch's processing count before commit"
  );

  const auditCountBefore = await countRows(
    client,
    "audit_log",
    (query) =>
      query
        .eq("target_table", "sports_connect_import_rows")
        .eq("target_id", String(secondBatch.rowId))
        .eq("action", "sports_connect_import_row_committed"),
    "Could not count commit audit events before the expected conflict"
  );

  requireCondition(
    playerRegistrationsBefore === 1,
    `Expected one existing registration for the synthetic player; found ${playerRegistrationsBefore}.`
  );

  const attemptedCommit = await client.rpc(
    "commit_sports_connect_import_row",
    {
      p_row_id: secondBatch.rowId,
      p_reason: "Local integration test: expect duplicate-season registration conflict",
    }
  );

  requireCondition(
    attemptedCommit.error,
    "FAIL: The second commit unexpectedly succeeded instead of rejecting the duplicate-season registration."
  );

  const errorMessage = attemptedCommit.error.message || "";

  requireCondition(
    /already has a registration for this season/i.test(errorMessage),
    `The commit failed, but not with the expected conflict message. Actual error: ${errorMessage}`
  );

  console.log("PASS: Second commit rejected with the expected conflict message.");

  const playerCountAfter = await countRows(
    client,
    "players",
    null,
    "Could not count players after the expected conflict"
  );

  const registrationCountAfter = await countRows(
    client,
    "player_seasons",
    null,
    "Could not count registrations after the expected conflict"
  );

  const playerRegistrationsAfter = await countRows(
    client,
    "player_seasons",
    (query) => query.eq("player_id", playerId).eq("season_id", seasonId),
    "Could not count the player's registrations after the expected conflict"
  );

  requireCondition(
    playerCountAfter === playerCountBefore,
    `FAIL: Player count changed after the rejected commit (${playerCountBefore} -> ${playerCountAfter}).`
  );

  requireCondition(
    registrationCountAfter === registrationCountBefore,
    `FAIL: Registration count changed after the rejected commit (${registrationCountBefore} -> ${registrationCountAfter}).`
  );

  requireCondition(
    playerRegistrationsAfter === 1,
    `FAIL: Expected exactly one registration for the matched player after rejection; found ${playerRegistrationsAfter}.`
  );

  console.log("PASS: No extra player or registration was created.");

  const playerAfter = requireSuccess(
    await client.from("players").select("*").eq("id", playerId).single(),
    "Could not verify the synthetic player's values after the rejected commit"
  );

  requireCondition(
    JSON.stringify(playerAfter) === JSON.stringify(originalPlayer),
    "FAIL: The matched player's stored values changed during the rejected commit."
  );

  console.log("PASS: Existing player details were not changed.");

  const stagedAfter = requireSuccess(
    await client
      .from("sports_connect_import_rows")
      .select("review_state, matched_player_id, committed_player_season_id")
      .eq("id", secondBatch.rowId)
      .single(),
    "Could not verify the second staged row after the rejected commit"
  );

  requireCondition(
    stagedAfter.review_state === "approved_match",
    `FAIL: Expected review_state approved_match; found ${stagedAfter.review_state}.`
  );

  requireCondition(
    Number(stagedAfter.matched_player_id) === Number(playerId),
    "FAIL: The staged row's matched player ID changed."
  );

  requireCondition(
    stagedAfter.committed_player_season_id === null,
    "FAIL: The rejected staged row has a committed registration ID."
  );

  console.log("PASS: Staged row remains approved_match and uncommitted.");

  const batchAfter = requireSuccess(
    await client
      .from("import_batches")
      .select("rows_processed")
      .eq("id", secondBatch.batchId)
      .single(),
    "Could not read the second batch's processing count after commit"
  );

  requireCondition(
    Number(batchAfter.rows_processed) === Number(batchBefore.rows_processed),
    `FAIL: Batch rows_processed changed (${batchBefore.rows_processed} -> ${batchAfter.rows_processed}).`
  );

  console.log("PASS: Batch processing count did not increase.");

  const auditCountAfter = await countRows(
    client,
    "audit_log",
    (query) =>
      query
        .eq("target_table", "sports_connect_import_rows")
        .eq("target_id", String(secondBatch.rowId))
        .eq("action", "sports_connect_import_row_committed"),
    "Could not count commit audit events after the expected conflict"
  );

  requireCondition(
    auditCountAfter === auditCountBefore,
    `FAIL: A commit audit event was added for the rejected row (${auditCountBefore} -> ${auditCountAfter}).`
  );

  console.log("PASS: No commit audit event was created for the rejected row.");
  console.log("");
  console.log("OVERALL RESULT: PASS");
  console.log(`Season ID: ${seasonId}`);
  console.log(`Synthetic player ID: ${playerId}`);
  console.log(`First registration ID: ${playerSeasonId}`);
  console.log(`First staging batch / row: ${firstBatch.batchId} / ${firstBatch.rowId}`);
  console.log(`Rejected staging batch / row: ${secondBatch.batchId} / ${secondBatch.rowId}`);
  console.log("Synthetic records were retained for inspection.");
}

main().catch((error) => {
  console.error("");
  console.error("OVERALL RESULT: FAIL");
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
