/** @jest-environment node */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { gzipSync } = require("node:zlib");
const { spawnSync } = require("node:child_process");
const { measureBuild } = require("./measure-build.cjs");

let temporary;
let build;
let manifest;
let assets;

function write(relative, value) {
  const destination = path.join(build, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, value);
}

function writeManifests() {
  write("manifest.json", JSON.stringify(manifest));
  write("asset-manifest.json", JSON.stringify(assets));
}

beforeEach(() => {
  temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "kiss-build-measure-test-")
  );
  build = path.join(temporary, "build");
  manifest = {
    manifest_version: 3,
    version: "1.2.3",
    version_name: "1.2.3-test",
    content_scripts: [{ js: ["content.js"] }],
    background: { service_worker: "background.js" },
    options_ui: { page: "options.html" },
    mime_types_handler: { "application/pdf": { handler_url: "pdf.html" } },
  };
  assets = {
    "content.js": "/content.js",
    "background.js": "/background.js",
    "options.js": "/options.js",
    "options.css": "/css/options.css",
    "pdf.js": "/pdf.js",
    "pdf-worker.mjs": "/pdf-worker.mjs",
  };
  for (const file of Object.keys(assets)) {
    write(file === "options.css" ? "css/options.css" : file, "/* fixture */\n");
  }
  write(
    "options.html",
    '<script src="options.js"></script><link rel="stylesheet" href="css/options.css">'
  );
  write("pdf.html", '<script src="./pdf.js"></script>');
  writeManifests();
});

afterEach(() => {
  fs.rmSync(temporary, { recursive: true, force: true });
});

test("measures deterministic bytes and hashes without evaluating bundled code", () => {
  const code = Buffer.from(
    'throw new Error("This bundle must never execute");\n'
  );
  write("content.js", code);
  const before = fs.statSync(path.join(build, "content.js")).mtimeMs;
  const report = measureBuild(build);
  expect(report.measurement).toBe(
    "static-build-artifact-size-not-startup-time"
  );
  expect(report.entries.content.files).toEqual([
    {
      path: "content.js",
      rawBytes: code.length,
      gzipBytes: gzipSync(code, { level: 9 }).length,
      sha256: createHash("sha256").update(code).digest("hex"),
    },
  ]);
  expect(report.entries.options.files.map((file) => file.path)).toEqual([
    "css/options.css",
    "options.html",
    "options.js",
  ]);
  expect(report.totals.javascript.fileCount).toBe(5);
  expect(report.totals.build.rawBytes).toBe(
    report.files.reduce((sum, file) => sum + file.rawBytes, 0)
  );
  expect(report.integrity.declaredDependenciesComplete).toBe(true);
  expect(report.manifest.versionName).toBe("1.2.3-test");
  expect(JSON.stringify(report)).not.toContain(temporary);
  expect(measureBuild(build)).toEqual(report);
  expect(fs.statSync(path.join(build, "content.js")).mtimeMs).toBe(before);
});

test.each(["content.js", "pdf-worker.mjs", "css/options.css"])(
  "rejects a missing declared dependency: %s",
  (file) => {
    fs.unlinkSync(path.join(build, file));
    expect(() => measureBuild(build)).toThrow("Missing required build asset");
  }
);

test("rejects an unlisted missing HTML dependency", () => {
  write("options.html", '<script src="runtime.js"></script>');
  expect(() => measureBuild(build)).toThrow("Missing required build asset");
});

test("rejects incomplete HTML, empty required files, and invalid manifests", () => {
  write("pdf.html", "<div>Incomplete</div>");
  expect(() => measureBuild(build)).toThrow("no external JavaScript");
  write("pdf.html", '<script src="pdf.js"></script>');
  write("content.js", "");
  expect(() => measureBuild(build)).toThrow("Empty required build asset");
  write("manifest.json", "{");
  expect(() => measureBuild(build)).toThrow("Invalid build JSON");
});

test.each([
  "../../private.js",
  "/%2e%2e/private.js",
  "//example.com/code.js",
  "https://example.com/code.js",
  "file:///private/code.js",
  "..\\private.js",
])("rejects external or escaping dependency reference %s", (reference) => {
  assets["hostile.js"] = reference;
  writeManifests();
  expect(() => measureBuild(build)).toThrow(/local build path|escapes|Unsafe/);
});

test("rejects remote script tags without making a network request", () => {
  write(
    "options.html",
    '<script src="https://example.com/script.js"></script>'
  );
  expect(() => measureBuild(build)).toThrow("not a local build path");
});

test("handles nested HTML relative dependencies and CRA asset inventories", () => {
  manifest.options_ui.page = "pages/options.html";
  write(
    "pages/options.html",
    "<script src='../options.js?cache=1'></script><link href='../css/options.css' rel='stylesheet'>"
  );
  assets = { files: assets, entrypoints: ["content.js", "background.js"] };
  writeManifests();
  expect(measureBuild(build).entries.options.fileCount).toBe(3);
});

test("rejects symlinked files rather than reading outside the build", () => {
  fs.symlinkSync(path.join(build, "content.js"), path.join(build, "linked.js"));
  expect(() => measureBuild(build)).toThrow("symbolic link");
});

test("CLI writes reports only outside the build and failures contain no absolute path", () => {
  const script = path.join(__dirname, "measure-build.cjs");
  const output = path.join(temporary, "report.json");
  const success = spawnSync(
    process.execPath,
    [script, "--build-dir", build, "--output", output],
    { encoding: "utf8" }
  );
  expect(success.status).toBe(0);
  expect(JSON.parse(fs.readFileSync(output, "utf8"))).toEqual(
    measureBuild(build)
  );
  expect(success.stdout).not.toContain(temporary);
  const inBuild = spawnSync(
    process.execPath,
    [script, "--build-dir", build, "--output", path.join(build, "report.json")],
    { encoding: "utf8" }
  );
  expect(inBuild.status).toBe(1);
  expect(fs.existsSync(path.join(build, "report.json"))).toBe(false);
  const alias = path.join(temporary, "build-alias");
  fs.symlinkSync(build, alias);
  const throughAlias = spawnSync(
    process.execPath,
    [script, "--build-dir", build, "--output", path.join(alias, "report.json")],
    { encoding: "utf8" }
  );
  expect(throughAlias.status).toBe(1);
  expect(fs.existsSync(path.join(build, "report.json"))).toBe(false);
  const missing = spawnSync(
    process.execPath,
    [script, "--build-dir", path.join(temporary, "nonexistent")],
    { encoding: "utf8" }
  );
  expect(missing.status).toBe(1);
  expect(missing.stderr).not.toContain(temporary);
  expect(missing.stdout).toBe("");
});
