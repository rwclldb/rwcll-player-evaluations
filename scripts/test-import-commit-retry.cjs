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
    throw new Error("Missing configured Supabase URL or publishable/anon key.");
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question, hidden = false) =>
    new Promise((resolve) => {
      if (!hidden || !process.stdin.isTTY) {
        rl.question(question, resolve);
        return;
      }

      const stdin = process.stdin;
      const wasRaw = stdin.isRaw;
      process.stdout.write(question);
      stdin.setRawMode(true);
      stdin.resume();
      let answer = "";

      const onData = (chunk) => {
        const value = chunk.toString("utf8");
        if (value === "\r" || value === "\n") {
          stdin.removeListener("data", onData);
          stdin.setRawMode(wasRaw || false);
          process.stdout.write("\n");
          resolve(answer);
        } else if (value === "\u0003") {
          process.stdout.write("\n");
          process.exit(130);
        } else if (value === "\u007f" || value === "\b") {
          answer = answer.slice(0, -1);
        } else {
          answer += value;
        }
      };

      stdin.on("data", onData);
    });

  try {
    const email = await ask("Administrator email: ");
    //const password = process.env.LOCAL_TEST_PASSWORD;
     const password = await readHiddenPassword();
    if (!password) {
      throw new Error("Missing LOCAL_TEST_PASSWORD. Run this test through the secure PowerShell prompt.");
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

    console.log("PASS: Signed in to configured Supabase.");

    const { data, error } = await supabase.rpc(
      "commit_sports_connect_import_row",
      {
        p_row_id: 3,
        p_reason: "Safe retry idempotency test",
      }
    );

    if (error) {
      throw new Error(`Retry RPC failed: ${error.message}`);
    }

    if (Number(data) !== 1) {
      throw new Error(
        `Expected existing registration ID 1, received ${JSON.stringify(data)}`
      );
    }

    console.log("PASS: Retry returned existing registration ID 1.");
    console.log("Next: verify audit count and batch state in local Studio.");
  } finally {
    rl.close();
  }
}

function readHiddenPassword() {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
      reject(new Error("Run this script in an interactive PowerShell terminal."));
      return;
    }

    process.stdout.write("Password for local admin account (input hidden): ");
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
