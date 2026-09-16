#!/usr/bin/env node
// Offline, read-only inspection of build bytes. Never evaluates bundled code.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { gzipSync } = require("node:zlib");

class BuildMeasurementError extends Error {}

function fail(message) {
  throw new BuildMeasurementError(message);
}

function measureBuild(buildDirectory) {
  const root = path.resolve(buildDirectory);
  const inventory = new Map();
  function visit(directory, prefix = "") {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isSymbolicLink()) fail("Build contains a symbolic link.");
      if (entry.isDirectory()) {
        visit(path.join(directory, entry.name), relative + "/");
      } else if (entry.isFile()) {
        const bytes = fs.readFileSync(path.join(directory, entry.name));
        inventory.set(relative, {
          path: relative,
          rawBytes: bytes.length,
          gzipBytes: gzipSync(bytes, { level: 9 }).length,
          sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
        });
      } else {
        fail("Build contains an unsupported filesystem entry.");
      }
    }
  }
  try {
    if (fs.lstatSync(root).isSymbolicLink())
      fail("Build root is a symbolic link.");
    visit(root);
  } catch (error) {
    if (error instanceof BuildMeasurementError) throw error;
    fail("Cannot read the build directory.");
  }

  function requireFile(relative) {
    const item = inventory.get(relative);
    if (!item)
      fail(`Missing required build asset: ${JSON.stringify(relative)}.`);
    if (item.rawBytes === 0) {
      fail(`Empty required build asset: ${JSON.stringify(relative)}.`);
    }
    return item;
  }
  function readJson(relative) {
    requireFile(relative);
    try {
      return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
    } catch {
      fail(`Invalid build JSON: ${JSON.stringify(relative)}.`);
    }
  }
  function localReference(reference, parent = "") {
    if (
      typeof reference !== "string" ||
      !reference ||
      /^[a-z][a-z\d+.-]*:/i.test(reference) ||
      reference.startsWith("//") ||
      reference.includes("\\") ||
      reference.includes("\u0000")
    ) {
      fail("A required asset reference is not a local build path.");
    }
    let file;
    try {
      file = decodeURIComponent(reference.split(/[?#]/, 1)[0]);
    } catch {
      fail("A required asset reference has invalid URL encoding.");
    }
    if (file.includes("\\") || file.includes("\u0000")) {
      fail("Unsafe required asset path.");
    }
    const relative = path.posix.normalize(
      file.startsWith("/")
        ? file.slice(1)
        : path.posix.join(path.posix.dirname(parent || "."), file)
    );
    if (
      relative === ".." ||
      relative.startsWith("../") ||
      relative.startsWith("/") ||
      relative === "."
    ) {
      fail("A required asset reference escapes the build directory.");
    }
    requireFile(relative);
    return relative;
  }
  function htmlDependencies(htmlPath) {
    const dependencies = [htmlPath];
    const html = fs.readFileSync(path.join(root, htmlPath), "utf8");
    let scripts = 0;
    // Generated HTML uses ordinary script/link tags; no HTML or JS is executed.
    for (const match of html.matchAll(/<(script|link)\b([^>]*)>/gi)) {
      const attributes = {};
      for (const attribute of match[2].matchAll(
        /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g
      )) {
        attributes[attribute[1].toLowerCase()] =
          attribute[2] ?? attribute[3] ?? attribute[4];
      }
      if (match[1].toLowerCase() === "script" && attributes.src) {
        scripts += 1;
        dependencies.push(localReference(attributes.src, htmlPath));
      } else if (
        match[1].toLowerCase() === "link" &&
        /(?:^|\s)(?:stylesheet|modulepreload)(?:\s|$)/i.test(
          attributes.rel || ""
        )
      ) {
        dependencies.push(localReference(attributes.href, htmlPath));
      }
    }
    if (!scripts) fail("An HTML entry has no external JavaScript entry.");
    return dependencies;
  }

  const manifest = readJson("manifest.json");
  if (
    !manifest ||
    !Number.isInteger(manifest.manifest_version) ||
    !manifest.version
  ) {
    fail("Extension manifest has no valid version metadata.");
  }
  const assetManifest = readJson("asset-manifest.json");
  const assetFiles = assetManifest?.files ?? assetManifest;
  if (
    !assetFiles ||
    typeof assetFiles !== "object" ||
    Array.isArray(assetFiles)
  ) {
    fail("Asset manifest has no valid file inventory.");
  }
  const declaredAssets = new Set();
  for (const reference of Object.values(assetFiles)) {
    declaredAssets.add(localReference(reference));
  }
  if (!declaredAssets.size) fail("Asset manifest is empty.");
  if (assetManifest.entrypoints !== undefined) {
    if (!Array.isArray(assetManifest.entrypoints))
      fail("Invalid asset entrypoints.");
    for (const reference of assetManifest.entrypoints) {
      declaredAssets.add(localReference(reference));
    }
  }

  const content = [];
  for (const entry of manifest.content_scripts || []) {
    for (const reference of [...(entry.js || []), ...(entry.css || [])]) {
      content.push(localReference(reference));
    }
  }
  if (!content.some((file) => /\.[cm]?js$/i.test(file))) {
    fail("Manifest has no JavaScript content entry.");
  }
  const background = [];
  if (manifest.background?.service_worker) {
    background.push(localReference(manifest.background.service_worker));
  } else if (manifest.background?.page) {
    background.push(
      ...htmlDependencies(localReference(manifest.background.page))
    );
  } else {
    for (const reference of manifest.background?.scripts || []) {
      background.push(localReference(reference));
    }
  }
  if (!background.length) fail("Manifest has no background entry.");
  const options = htmlDependencies(
    localReference(manifest.options_ui?.page || manifest.options_page)
  );
  const pdfPath =
    manifest.mime_types_handler?.["application/pdf"]?.handler_url || "pdf.html";
  const pdf = htmlDependencies(localReference(pdfPath));
  // Also check the popup, even though it is outside the four measured groups.
  const popup =
    manifest.action?.default_popup || manifest.browser_action?.default_popup;
  if (popup) htmlDependencies(localReference(popup));

  function summarize(items) {
    return {
      fileCount: items.length,
      rawBytes: items.reduce((total, item) => total + item.rawBytes, 0),
      gzipBytes: items.reduce((total, item) => total + item.gzipBytes, 0),
    };
  }
  const entries = {};
  for (const [name, references] of Object.entries({
    content,
    background,
    options,
    pdf,
  })) {
    const files = [...new Set(references)].sort().map(requireFile);
    entries[name] = {
      ...summarize(files),
      declaredDependenciesComplete: true,
      files,
    };
  }
  const files = [...inventory.values()].sort((a, b) =>
    a.path.localeCompare(b.path, "en")
  );
  return {
    schemaVersion: 1,
    measurement: "static-build-artifact-size-not-startup-time",
    method: {
      gzip: "sum of individually compressed files, gzip level 9",
      dependencyScope:
        "manifest entries, HTML script/stylesheet/modulepreload references, and every asset-manifest file",
      limitations:
        "Does not execute bundles, inspect dynamically constructed URLs, measure browser startup, or prove runtime behavior.",
    },
    manifest: {
      manifestVersion: manifest.manifest_version,
      version: manifest.version,
      versionName: manifest.version_name || null,
    },
    integrity: {
      declaredDependenciesComplete: true,
      assetManifestFileCount: declaredAssets.size,
    },
    entries,
    totals: {
      javascript: summarize(
        files.filter((file) => /\.[cm]?js$/i.test(file.path))
      ),
      build: summarize(files),
    },
    files,
  };
}

function main(argv) {
  let directory = "build/chrome";
  let output;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      process.stdout.write(
        "Usage: node src/scripts/measure-build.cjs [--build-dir DIRECTORY] [--output JSON_FILE]\nMeasures static artifact bytes, not startup time. No network or bundle execution.\n"
      );
      return;
    }
    if (!["--build-dir", "--output"].includes(argument) || !argv[index + 1]) {
      fail("Expected --build-dir DIRECTORY or --output JSON_FILE.");
    }
    const value = argv[++index];
    if (argument === "--build-dir") directory = value;
    else output = value;
  }
  if (output) {
    let buildRoot;
    let reportDestination;
    try {
      buildRoot = fs.realpathSync(directory);
      // Resolve the parent too: an output directory symlink must not let a
      // seemingly external report overwrite a file inside the measured build.
      reportDestination = path.join(
        fs.realpathSync(path.dirname(path.resolve(output))),
        path.basename(output)
      );
    } catch {
      fail("Cannot access the build or report directory.");
    }
    const relative = path.relative(buildRoot, reportDestination);
    if (
      !relative.startsWith(".." + path.sep) &&
      relative !== ".." &&
      !path.isAbsolute(relative)
    ) {
      fail(
        "Write the report outside the build directory to keep measurement read-only."
      );
    }
  }
  const report = JSON.stringify(measureBuild(directory), null, 2) + "\n";
  if (output) {
    try {
      if (fs.existsSync(output) && fs.lstatSync(output).isSymbolicLink()) {
        fail("Report destination is a symbolic link.");
      }
      fs.writeFileSync(output, report);
    } catch (error) {
      if (error instanceof BuildMeasurementError) throw error;
      fail("Cannot write the measurement report.");
    }
    process.stdout.write(
      "Static build artifact report written; no startup timing was measured.\n"
    );
  } else {
    process.stdout.write(report);
  }
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    const message =
      error instanceof BuildMeasurementError
        ? error.message
        : "Cannot measure the build; the artifact is invalid or unreadable.";
    process.stderr.write(`Build measurement failed: ${message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { measureBuild, main };
