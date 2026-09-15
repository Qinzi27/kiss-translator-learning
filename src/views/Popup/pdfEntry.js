import { browser } from "../../libs/browser";
import { isExt, isGm } from "../../libs/client";
import { getPdfSourceUrl, launchPdfInTab } from "../../libs/pdfLaunch";

export const PDF_USERSCRIPT_HINT =
  "PDF 双语阅读请使用 Chrome / Edge 扩展或网页预览；油猴版本暂不支持。";

export const getPdfPrefillUrl = getPdfSourceUrl;

// Only an explicit click on the current-PDF action creates an automatic launch
// grant. The ordinary settings reader entry always opens empty.
export async function openPdfReader({ prefillCurrentTab = false } = {}) {
  if (isGm) throw new Error(PDF_USERSCRIPT_HINT);
  if (isExt) {
    if (!browser?.runtime?.getURL || !browser?.tabs?.create) {
      throw new Error("无法打开 PDF 阅读器，请重新加载扩展后重试。");
    }
    let currentTab;
    if (prefillCurrentTab && browser.tabs.query) {
      try {
        [currentTab] = await browser.tabs.query({
          active: true,
          lastFocusedWindow: true,
        });
      } catch {
        // Inaccessible/internal tabs still get a useful empty local reader.
      }
    }
    if (currentTab && (await launchPdfInTab(currentTab))) return true;
    const url = browser.runtime.getURL("pdf.html");
    return browser.tabs.create({ url });
  }
  const url = new URL("/pdf.html", window.location.href).href;
  window.open(url, "_blank", "noopener,noreferrer");
}
