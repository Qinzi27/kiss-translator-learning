#!/usr/bin/env node
// Opt-in only: two synthetic sentences, no keys/accounts, real public HTTPS API.
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const result = spawnSync(
  process.execPath,
  [
    require.resolve("react-scripts/bin/react-scripts.js"),
    "test",
    "--watchAll=false",
    "--runInBand",
    `--env=${require.resolve("./test-network-live.cjs")}`,
    "--testMatch=**/src/scripts/test-free-api-live.js",
    "--runTestsByPath",
    "src/scripts/test-free-api-live.js",
  ],
  {
    cwd: path.resolve(__dirname, "../.."),
    env: { ...process.env, KISS_FREE_API_LIVE: "1" },
    stdio: "inherit",
  }
);
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
