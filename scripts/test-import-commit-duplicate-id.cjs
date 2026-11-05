
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { createClient } = require("@supabase/supabase-js");

function readEnvFile(filePath) {
  const values = {};
  if (!fs.existsSync(filePath)) return values;

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
    if (match) {
      values[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
  return values;
}

function askEmail() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question("Administrator email: ", (email) => {
      rl.close();
      resolve(email.trim());
    });
  });
}

function readHiddenPassword() {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;

    if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
      reject(new Error("Run this test in an interactive PowerShell terminal."));
      return;
    }

    process.stdout.write("Password for local admin account (input hidden): ");
    let password = "";
    const previousRawMode = stdin.isRaw;
    const previousEncoding = stdin.readableEncoding;

    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();

    function cleanup() {
      stdin.removeListener("data", onData);
      stdin.setRawMode(previousRawMode || false);
      stdin.pause();
      if (previousEncoding) stdin.setEncoding(previousEncoding);
    }

    function onData(char) {
      if (char === "\u0003") {
        cleanup();
        process.stdout.write("\nCancelled.\n");
        reject(new Error("Cancelled by user."));
      } else if (char === "\r" || char === "\n") {
        cleanup();
        process.stdout.write("\n");
        resolve(password);
      } else if (char === "\u007f" || char === "\b") {
        password = password.slice(0, -1);
      } else {
        password += char;
      }
    }

    stdin.on("data", onData);
  });
}

async function requireData(result, label) {
  if (result.error) {
    throw new Error(`${label}: ${result.error.message}`);
  }
  return result;
}

async function exactCount(query, label) {
  const result = await requireData(await query, label);
  if (result.count === null) {
    throw new Error(`${label}: database did not return an exact count.`);
  }
  return result.count;
}

async function main() {
  const env = {
    ...readEnvFile(path.join(process.cwd(), ".env")),
    ...readEnvFile(path.join(process.cwd(), ".env.local")),
  };

  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error("Missing local Supabase URL or publishable/anon key.");
  }

  const configuredUrl = new URL(url);

if (
  configuredUrl.protocol !== "https:" ||
  configuredUrl.hostname !== "szklvgrecvrxcgmkopso.supabase.co"
) {
  throw new Error(
    `Safety stop: unexpected Supabase project URL: ${url}`
  );
}

if (process.env.ALLOW_REMOTE_IMPORT_TESTS !== "YES") {
  throw new Error(
    "Safety stop: set ALLOW_REMOTE_IMPORT_TESTS=YES in PowerShell to authorize this remote test."
  );
}

  const email = await askEmail();
  const password = await readHiddenPassword();

  if (!password) {
    throw new Error("Password cannot be empty.");
  }

  const supabase = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data: signIn, error: signInError } =
    await supabase.auth.signInWithPassword({ email, password });

  if (signInError || !signIn?.user) {
    throw new Error("Could not sign in to the configured Supabase project.");
  }
  console.log("PASS: Signed in to the configured Supabase.");

  const { data: isAdmin, error: adminError } =
    await supabase.rpc("is_admin");

  if (adminError || isAdmin !== true) {
    throw new Error("Signed-in account is not a local administrator.");
  }
  console.log("PASS: Administrator authorization verified.");

  const seasonId = 1;
  const duplicatePlayerId = "TEST-1003";
  const uniqueRegistrationNumber =
    `DUPLICATE-ID-TEST-${Date.now()}`;

  // Establish a baseline before creating any test records.
  const playerCountBefore = await exactCount(
    supabase.from("players").select("id", { count: "exact", head: true }),
    "Count players before test"
  );

  const registrationsBefore = await exactCount(
    supabase
      .from("player_seasons")
      .select("id", { count: "exact", head: true }),
    "Count player-season registrations before test"
  );

  const existingDuplicateCount = await exactCount(
    supabase
      .from("player_seasons")
      .select("id", { count: "exact", head: true })
      .eq("season_id", seasonId)
      .eq("external_player_id", duplicatePlayerId),
    "Count existing registrations for duplicate external player ID"
  );

  if (existingDuplicateCount !== 1) {
    throw new Error(
      `Expected exactly one existing ${duplicatePlayerId} registration; found ${existingDuplicateCount}. No test batch was created.`
    );
  }

  console.log("PASS: Existing duplicate ID is present exactly once.");

  // Create a separate, disposable staging batch.
  const { data: batchId, error: stageError } = await supabase.rpc(
    "stage_sports_connect_import",
    {
      p_season_id: seasonId,
      p_source_file_name: `duplicate-id-regression-${Date.now()}.csv`,
      p_rows: [
        {
          line: 2,
          playerId: duplicatePlayerId,
          firstName: "Disposable",
          lastName: "Duplicate Test",
          birthDate: "2017-01-01",
          program: "Baseball",
          division: "AAA",
          registrationNumber: uniqueRegistrationNumber,
          paymentStatus: "Paid",
          leagueAge: 9,
          issues: [],
        },
      ],
    }
  );

  if (stageError || !batchId) {
    throw new Error(
      `Could not stage the test row: ${stageError?.message || "No batch ID returned"}`
    );
  }

  const { data: stagedRows, error: rowError } = await supabase
    .from("sports_connect_import_rows")
    .select("id, review_state, committed_player_season_id")
    .eq("import_batch_id", batchId);

  if (rowError) {
    throw new Error(`Could not read staged test row: ${rowError.message}`);
  }

  if (!stagedRows || stagedRows.length !== 1) {
    throw new Error(`Expected one staged row in batch ${batchId}.`);
  }

  const rowId = stagedRows[0].id;
  console.log(`PASS: Created isolated test batch ${batchId}, row ${rowId}.`);

  // Explicitly approve the row to test the database constraint itself.
  const { error: reviewError } = await supabase.rpc(
    "review_sports_connect_import_row",
    {
      p_row_id: rowId,
      p_decision: "approved_new",
      p_matched_player_id: null,
      p_reason:
        "Regression test: verify duplicate external player ID is rejected",
    }
  );

  if (reviewError) {
    throw new Error(
      `Could not approve isolated test row: ${reviewError.message}`
    );
  }

  console.log("PASS: Test row explicitly approved as approved_new.");

  // Attempt the commit. The existing TEST-1003 should violate the
  // season-scoped unique index, and the commit transaction should roll back.
  const { data: commitResult, error: commitError } = await supabase.rpc(
    "commit_sports_connect_import_row",
    {
      p_row_id: rowId,
      p_reason:
        "Regression test: expected rejection of duplicate external player ID",
    }
  );

  if (!commitError) {
    throw new Error(
      `FAIL: Duplicate ID was accepted; commit returned ${JSON.stringify(commitResult)}. Stop and investigate.`
    );
  }

  if (commitError.code !== "23505") {
    throw new Error(
      `Expected unique-constraint SQLSTATE 23505, received ${commitError.code || "no SQLSTATE"}: ${commitError.message}`
    );
  }

  console.log("PASS: Database rejected duplicate ID with SQLSTATE 23505.");

  // Verify the failed commit did not create or change player records.
  const playerCountAfter = await exactCount(
    supabase.from("players").select("id", { count: "exact", head: true }),
    "Count players after rejected commit"
  );

  const registrationsAfter = await exactCount(
    supabase
      .from("player_seasons")
      .select("id", { count: "exact", head: true }),
    "Count player-season registrations after rejected commit"
  );

  if (playerCountAfter !== playerCountBefore) {
    throw new Error(
      `Player count changed: ${playerCountBefore} before, ${playerCountAfter} after.`
    );
  }
  console.log("PASS: Failed commit created no player.");

  if (registrationsAfter !== registrationsBefore) {
    throw new Error(
      `Registration count changed: ${registrationsBefore} before, ${registrationsAfter} after.`
    );
  }
  console.log("PASS: Failed commit created no player-season registration.");

  const { data: existingRows, error: existingError } = await supabase
    .from("player_seasons")
    .select("id")
    .eq("season_id", seasonId)
    .eq("external_player_id", duplicatePlayerId);

  if (existingError) {
    throw new Error(
      `Could not verify original registration: ${existingError.message}`
    );
  }

  if (
    !existingRows ||
    existingRows.length !== 1 ||
    Number(existingRows[0].id) !== 1
  ) {
    throw new Error(
      "The original TEST-1003 registration was not preserved as expected."
    );
  }
  console.log("PASS: Original TEST-1003 registration remains intact.");

  const { data: finalRows, error: finalRowError } = await supabase
    .from("sports_connect_import_rows")
    .select("review_state, committed_player_season_id")
    .eq("id", rowId)
    .single();

  if (finalRowError) {
    throw new Error(
      `Could not verify staged row after failure: ${finalRowError.message}`
    );
  }

  if (
    finalRows.review_state !== "approved_new" ||
    finalRows.committed_player_season_id !== null
  ) {
    throw new Error(
      `Unexpected staged row state after failure: ${JSON.stringify(finalRows)}`
    );
  }
  console.log("PASS: Test row remains approved_new and uncommitted.");

  const commitAuditCount = await exactCount(
    supabase
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("action", "sports_connect_import_row_committed")
      .eq("target_table", "sports_connect_import_rows")
      .eq("target_id", String(rowId)),
    "Check commit audit events for test row"
  );

  if (commitAuditCount !== 0) {
    throw new Error(
      `Expected no commit audit event for failed row; found ${commitAuditCount}.`
    );
  }
  console.log("PASS: Failed commit produced no commit audit event.");

  console.log("\nALL DUPLICATE-ID REGRESSION CHECKS PASSED.");
  console.log(`Test batch ID: ${batchId}`);
  console.log(`Test row ID: ${rowId}`);
  console.log(
    "The test batch and approved, uncommitted staging row were intentionally left for inspection."
  );
}

main().catch((error) => {
  console.error("FAIL:", error.message);
  process.exitCode = 1;
});
