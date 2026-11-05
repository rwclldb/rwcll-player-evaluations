
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { createClient } = require("@supabase/supabase-js");

const EXPECTED_HOST = "szklvgrecvrxcgmkopso.supabase.co";
const SEASON_ID = 1;

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

function readHiddenPassword() {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;

    if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
      reject(
        new Error("Run this test in an interactive VS Code PowerShell terminal.")
      );
      return;
    }

    process.stdout.write(
      "Password for remote test administrator (input hidden): "
    );

    let password = "";
    const wasRaw = stdin.isRaw;

    function cleanup() {
      stdin.removeListener("data", onData);
      stdin.setRawMode(wasRaw || false);
      stdin.pause();
    }

    function onData(chunk) {
      for (const char of chunk.toString("utf8")) {
        if (char === "\u0003") {
          cleanup();
          process.stdout.write("\nCancelled.\n");
          reject(new Error("Cancelled by user."));
          return;
        }

        if (char === "\r" || char === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolve(password);
          return;
        }

        if (char === "\u007f" || char === "\b") {
          password = password.slice(0, -1);
        } else {
          password += char;
        }
      }
    }

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    stdin.on("data", onData);
  });
}

async function exactCount(supabase, table, configure = (query) => query) {
  const query = configure(
    supabase.from(table).select("id", { count: "exact", head: true })
  );

  const { count, error } = await query;

  if (error) {
    throw new Error(`Could not count ${table}: ${error.message}`);
  }

  if (count === null) {
    throw new Error(`The exact count for ${table} was not returned.`);
  }

  return count;
}

async function main() {
  if (process.env.ALLOW_REMOTE_IMPORT_TESTS !== "YES") {
    throw new Error(
      "Safety stop: set ALLOW_REMOTE_IMPORT_TESTS=YES in PowerShell to authorize this remote test."
    );
  }

  const env = {
    ...readEnvFile(path.join(process.cwd(), ".env")),
    ...readEnvFile(path.join(process.cwd(), ".env.local")),
  };

  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing configured Supabase URL or publishable/anon key."
    );
  }

  let configuredUrl;

  try {
    configuredUrl = new URL(url);
  } catch {
    throw new Error("The configured Supabase URL is invalid.");
  }

  if (
    configuredUrl.protocol !== "https:" ||
    configuredUrl.hostname !== EXPECTED_HOST
  ) {
    throw new Error(
      `Safety stop: expected HTTPS project ${EXPECTED_HOST}; refusing to run against ${configuredUrl.hostname}.`
    );
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question) =>
    new Promise((resolve) => rl.question(question, resolve));

  let supabase;

  try {
    const email = (await ask("Remote test administrator email: ")).trim();
    const password = await readHiddenPassword();

    if (!email || !password) {
      throw new Error("Administrator email and password are required.");
    }

    supabase = createClient(url, key, {
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

    console.log("PASS: Signed in to the expected remote Supabase project.");

    const { data: isAdmin, error: adminError } =
      await supabase.rpc("is_admin");

    if (adminError || isAdmin !== true) {
      throw new Error(
        "Safety stop: signed-in account is not a remote-project administrator."
      );
    }

    console.log("PASS: Administrator authorization verified.");

    const uniqueSuffix = `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    const externalPlayerId = `RETRY-TEST-${uniqueSuffix}`;
    const externalRegistrationId = `RETRY-REG-${uniqueSuffix}`;
    const sourceFileName = `retry-idempotency-${uniqueSuffix}.csv`;

    const playerCountBefore = await exactCount(supabase, "players");
    const registrationCountBefore = await exactCount(
      supabase,
      "player_seasons"
    );

    const stagedRow = {
      line: 2,
      playerId: externalPlayerId,
      registrationNumber: externalRegistrationId,
      firstName: "Retry",
      lastName: "RegressionTest",
      birthDate: "2017-01-01",
      program: "Baseball",
      division: "AAA",
      paymentStatus: "Paid",
      leagueAge: 9,
      issues: [],
    };

    const { data: batchData, error: stageError } = await supabase.rpc(
      "stage_sports_connect_import",
      {
        p_season_id: SEASON_ID,
        p_source_file_name: sourceFileName,
        p_rows: [stagedRow],
      }
    );

    if (stageError) {
      throw new Error(`Could not stage test row: ${stageError.message}`);
    }

    const batchId = Number(batchData);

    if (!Number.isSafeInteger(batchId) || batchId <= 0) {
      throw new Error(
        `Unexpected staging batch response: ${JSON.stringify(batchData)}`
      );
    }

    console.log(`PASS: Created isolated staging batch ${batchId}.`);

    const { data: stagedRows, error: stagedRowsError } = await supabase
      .from("sports_connect_import_rows")
      .select("id")
      .eq("import_batch_id", batchId);

    if (stagedRowsError) {
      throw new Error(
        `Could not find staged test row: ${stagedRowsError.message}`
      );
    }

    if (!stagedRows || stagedRows.length !== 1) {
      throw new Error(
        `Expected exactly one row in batch ${batchId}; found ${stagedRows?.length ?? 0}.`
      );
    }

    const rowId = Number(stagedRows[0].id);

    console.log(`PASS: Located isolated staged row ${rowId}.`);

    const { error: reviewError } = await supabase.rpc(
      "review_sports_connect_import_row",
      {
        p_row_id: rowId,
        p_decision: "approved_new",
        p_matched_player_id: null,
        p_reason: "Regression test: approve synthetic row for retry idempotency",
      }
    );

    if (reviewError) {
      throw new Error(
        `Could not approve synthetic row ${rowId}: ${reviewError.message}`
      );
    }

    console.log("PASS: Synthetic row explicitly approved as approved_new.");

    async function commitRow(reason) {
      const { data, error } = await supabase.rpc(
        "commit_sports_connect_import_row",
        {
          p_row_id: rowId,
          p_reason: reason,
        }
      );

      if (error) {
        throw new Error(
          `Commit RPC failed for row ${rowId}: ${error.message} (SQLSTATE ${error.code || "unknown"})`
        );
      }

      const registrationId = Number(data);

      if (!Number.isSafeInteger(registrationId) || registrationId <= 0) {
        throw new Error(
          `Unexpected commit result for row ${rowId}: ${JSON.stringify(data)}`
        );
      }

      return registrationId;
    }

    const firstRegistrationId = await commitRow(
      "Regression test: initial idempotency commit"
    );

    console.log(
      `PASS: First commit returned registration ID ${firstRegistrationId}.`
    );

    const playerCountAfterFirst = await exactCount(supabase, "players");
    const registrationCountAfterFirst = await exactCount(
      supabase,
      "player_seasons"
    );

    if (playerCountAfterFirst !== playerCountBefore + 1) {
      throw new Error(
        `Expected first commit to add one player: before=${playerCountBefore}, after=${playerCountAfterFirst}.`
      );
    }

    console.log("PASS: First commit created exactly one player.");

    if (registrationCountAfterFirst !== registrationCountBefore + 1) {
      throw new Error(
        `Expected first commit to add one registration: before=${registrationCountBefore}, after=${registrationCountAfterFirst}.`
      );
    }

    console.log("PASS: First commit created exactly one registration.");

    async function getCommitAuditCount() {
      return exactCount(supabase, "audit_log", (query) =>
        query
          .eq("action", "sports_connect_import_row_committed")
          .eq("target_table", "sports_connect_import_rows")
          .eq("target_id", String(rowId))
      );
    }

    const auditCountAfterFirst = await getCommitAuditCount();

    if (auditCountAfterFirst !== 1) {
      throw new Error(
        `Expected exactly one commit audit event after first commit; found ${auditCountAfterFirst}.`
      );
    }

    console.log("PASS: First commit created exactly one commit-audit event.");

    const retryRegistrationId = await commitRow(
      "Regression test: retry the same already-committed row"
    );

    if (retryRegistrationId !== firstRegistrationId) {
      throw new Error(
        `Retry returned registration ID ${retryRegistrationId}; expected original ID ${firstRegistrationId}.`
      );
    }

    console.log(
      "PASS: Retry returned the same player-season registration ID."
    );

    const playerCountAfterRetry = await exactCount(supabase, "players");
    const registrationCountAfterRetry = await exactCount(
      supabase,
      "player_seasons"
    );

    if (playerCountAfterRetry !== playerCountAfterFirst) {
      throw new Error(
        `Player count changed during retry: before retry=${playerCountAfterFirst}, after retry=${playerCountAfterRetry}.`
      );
    }

    console.log("PASS: Retry created no additional player.");

    if (registrationCountAfterRetry !== registrationCountAfterFirst) {
      throw new Error(
        `Registration count changed during retry: before retry=${registrationCountAfterFirst}, after retry=${registrationCountAfterRetry}.`
      );
    }

    console.log("PASS: Retry created no additional registration.");

    const auditCountAfterRetry = await getCommitAuditCount();

    if (auditCountAfterRetry !== auditCountAfterFirst) {
      throw new Error(
        `Commit-audit count changed during retry: before retry=${auditCountAfterFirst}, after retry=${auditCountAfterRetry}.`
      );
    }

    console.log("PASS: Retry created no duplicate commit-audit event.");

    const { data: finalRows, error: finalRowError } = await supabase
      .from("sports_connect_import_rows")
      .select("review_state, committed_player_season_id")
      .eq("id", rowId)
      .eq("import_batch_id", batchId)
      .maybeSingle();

    if (finalRowError) {
      throw new Error(
        `Could not verify final staged row: ${finalRowError.message}`
      );
    }

    if (
      !finalRows ||
      finalRows.review_state !== "committed" ||
      Number(finalRows.committed_player_season_id) !== firstRegistrationId
    ) {
      throw new Error(
        `Final staged row does not point to the original committed registration: ${JSON.stringify(finalRows)}`
      );
    }

    console.log(
      "PASS: Staged row remains committed and references the original registration."
    );

    const { data: registration, error: registrationError } = await supabase
      .from("player_seasons")
      .select("id, season_id, external_player_id, external_registration_id")
      .eq("id", firstRegistrationId)
      .maybeSingle();

    if (registrationError) {
      throw new Error(
        `Could not verify committed registration: ${registrationError.message}`
      );
    }

    if (
      !registration ||
      Number(registration.season_id) !== SEASON_ID ||
      registration.external_player_id !== externalPlayerId ||
      registration.external_registration_id !== externalRegistrationId
    ) {
      throw new Error(
        `Committed registration did not match the synthetic test identifiers: ${JSON.stringify(registration)}`
      );
    }

    console.log("PASS: Original committed registration remains intact.");
    console.log("\nALL IMPORT-COMMIT RETRY REGRESSION CHECKS PASSED.");
    console.log(`Test batch ID: ${batchId}`);
    console.log(`Test row ID: ${rowId}`);
    console.log(`Player-season registration ID: ${firstRegistrationId}`);
    console.log(
      "The synthetic player, registration, batch, row, and audit event were intentionally retained for inspection."
    );
  } finally {
    rl.close();
    if (supabase) {
      await supabase.auth.signOut().catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error("FAIL:", error.message);
  process.exitCode = 1;
});
