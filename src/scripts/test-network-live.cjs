#!/usr/bin/env node
/* Opt-in live smoke test. Run: node src/scripts/test-network-live.cjs
 * Ordinary pnpm test does not discover test-network-live.js.
 * This file also supplies Jest's DOM environment with Node's real fetch and
 * the actual ESM query-string package; neither responses nor translations are mocked.
 */
const path = require("node:path");
const { pathToFileURL } = require("node:url");

if (require.main === module) {
  const { spawnSync } = require("node:child_process");
  const projectRoot = path.resolve(__dirname, "../..");
  const result = spawnSync(
    process.execPath,
    [
      require.resolve("react-scripts/bin/react-scripts.js"),
      "test",
      "--watchAll=false",
      "--runInBand",
      `--env=${__filename}`,
      "--testMatch=**/src/scripts/test-network-live.js",
      "--runTestsByPath",
      "src/scripts/test-network-live.js",
    ],
    {
      cwd: projectRoot,
      env: { ...process.env, KISS_NETWORK_LIVE: "1" },
      stdio: "inherit",
    }
  );
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? 1);
} else {
  const Environment = require(
    require.resolve("jest-environment-jsdom", {
      paths: [require.resolve("react-scripts/package.json")],
    })
  );
  module.exports = class LiveNetworkEnvironment extends Environment {
    async setup() {
      await super.setup();
      if (typeof globalThis.fetch !== "function") {
        throw new Error("This opt-in smoke test requires Node 20 or newer.");
      }
      this.global.fetch = globalThis.fetch.bind(globalThis);
      this.global.AbortController = globalThis.AbortController;
      this.global.__LIVE_QUERY_STRING__ = (
        await import(pathToFileURL(require.resolve("query-string")).href)
      ).default;
    }
  };
}
