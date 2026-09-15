export function pdfAssetUrl(path) {
  return new URL(`pdfjs/${path}`, document.baseURI).href;
}

export async function loadPdfEngine() {
  // Load the exact pinned ESM module emitted into the extension, never a CDN.
  return import(/* webpackIgnore: true */ pdfAssetUrl("pdf.mjs"));
}
