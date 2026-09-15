#!/usr/bin/env node
// Opt-in public download check. No installation, browser profile, login or keys.
// Runs the actual release/policy/ZIP modules; only browser settings are replaced
// by explicit offline/no-google test policies. Requires Node 24 and dev deps.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { compileFunction } = require("node:vm");
const { transformFileSync } = require("@babel/core");
const project = path.resolve(__dirname, "../..");
const modules = new Map();
let policy = "offline";
function load(name) {
  if (name === "./storage")
    return { getSettingWithDefault: async () => ({ networkPolicy: policy }) };
  if (
    ![
      "./browserUpdateRelease",
      "./browserUpdateZip",
      "./networkPolicy",
    ].includes(name)
  )
    throw new Error("Unexpected module: " + name);
  if (modules.has(name)) return modules.get(name).exports;
  const module = { exports: {} };
  modules.set(name, module);
  const filename = path.join(project, "src/libs", name + ".js");
  const { code } = transformFileSync(filename, {
    babelrc: false,
    configFile: false,
    presets: [
      [
        require.resolve("@babel/preset-env"),
        { targets: { node: "24" }, modules: "commonjs" },
      ],
    ],
  });
  compileFunction(code, ["module", "exports", "require"])(
    module,
    module.exports,
    load
  );
  return module.exports;
}
async function main() {
  if (!globalThis.fetch || !globalThis.DecompressionStream)
    throw new Error("Use Node 24 or later.");
  const actualFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(init.credentials, "omit");
    assert.equal(init.referrerPolicy, "no-referrer");
    const response = await actualFetch(url, init);
    requests.push({
      host: new URL(url).hostname,
      final_host: new URL(response.url).hostname,
      status: response.status,
    });
    return response;
  };
  try {
    const { checkBrowserRelease, downloadBrowserRelease } = load(
      "./browserUpdateRelease"
    );
    await assert.rejects(checkBrowserRelease(), /离线/);
    assert.equal(requests.length, 0);
    policy = "no-google";
    const release = await checkBrowserRelease();
    const result = await downloadBrowserRelease(release);
    assert.equal(result.manifest.version_name, release.version);
    const report = {
      checked_at: new Date().toISOString(),
      version_name: release.version,
      policy,
      offline_rejected_before_fetch: true,
      installation_writes: 0,
      file_count: result.files.size,
      expanded_bytes: [...result.files.values()].reduce(
        (sum, bytes) => sum + bytes.length,
        0
      ),
      requests,
      scope:
        "Actual public GitHub download, SHA-256 receipts and ZIP parser; Node runtime, not Chrome FSA installation.",
    };
    const output = process.argv[2];
    if (output)
      fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } finally {
    globalThis.fetch = actualFetch;
  }
}
main().catch((error) => {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
});
