const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");

function loadEnvFile(filePath) {
  const contents = fs.readFileSync(filePath, "utf8");
  const values = {};

  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*(NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)\s*=\s*(.*?)\s*$/);
    if (match) {
      values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  }

  return values;
}

async function main() {
  const env = loadEnvFile(path.join(process.cwd(), ".env.local"));
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error("Local Supabase URL or publishable key is missing from .env.local.");
  }

  const email = "sungod@duck.com";
  const password = await readHiddenPassword();

  const supabase = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError) {
    console.error("FAIL: Could not sign in to the local non-admin account.");
    console.error("Check the local account credentials; the password was not printed.");
    process.exitCode = 1;
    return;
  }

  console.log("PASS: Signed in as the local non-admin account.");

  const { data, error } = await supabase.rpc(
    "commit_sports_connect_import_row",
    {
      p_row_id: 3,
      p_reason: "Authorization rejection test",
    }
  );

  if (
    error &&
    error.code === "42501" &&
    /administrator access required/i.test(error.message)
  ) {
    console.log("PASS: Non-admin RPC call rejected with SQLSTATE 42501.");
    return;
  }

  if (error) {
    console.error(`FAIL: RPC returned an unexpected error (${error.code || "no code"}).`);
    console.error(error.message);
  } else {
    console.error("FAIL: The non-admin RPC unexpectedly succeeded.");
    console.error("Returned data:", JSON.stringify(data));
    console.error("Do not run further commit tests until this is investigated.");
  }

  process.exitCode = 1;
}

function readHiddenPassword() {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
      reject(new Error("Run this script in an interactive PowerShell terminal."));
      return;
    }

    process.stdout.write("Password for local non-admin account (input hidden): ");
    let password = "";

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    function cleanup() {
      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
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

    process.stdin.on("data", onData);
  });
}

main().catch((error) => {
  console.error("FAIL:", error.message);
  process.exitCode = 1;
});
