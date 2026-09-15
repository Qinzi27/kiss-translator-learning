const fs = require("node:fs");
const path = require("node:path");

// Emit into webpack's output (also the in-memory development server). Keep the
// pinned ESM files intact; the reader never imports sandbox/QuickJS scripting.
class PdfAssetsPlugin {
  apply(compiler) {
    compiler.hooks.thisCompilation.tap("PdfAssetsPlugin", (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: "PdfAssetsPlugin",
          stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT,
        },
        () => {
          const root = path.dirname(require.resolve("pdfjs-dist/package.json"));
          const emit = (source, dest) =>
            compilation.emitAsset(
              `pdfjs/${dest}`,
              new compiler.webpack.sources.RawSource(
                fs.readFileSync(path.join(root, source))
              ),
              // Terser also watches assets emitted after its normal stage.
              // Treat upstream distribution files as final to preserve bytes.
              { minimized: true }
            );
          const directory = (name) => {
            for (const file of fs.readdirSync(path.join(root, name))) {
              if (/quickjs|sandbox/i.test(file)) continue;
              emit(`${name}/${file}`, `${name}/${file}`);
            }
          };
          // Official compatibility build supplies missing modern JS primitives
          // in older Chromium/embedded browsers, without downgrading PDF.js.
          emit("legacy/build/pdf.mjs", "pdf.mjs");
          emit("legacy/build/pdf.worker.mjs", "pdf.worker.mjs");
          emit("LICENSE", "LICENSE");
          for (const name of ["cmaps", "standard_fonts", "wasm", "iccs"])
            directory(name);
        }
      );
    });
  }
}
module.exports = PdfAssetsPlugin;
