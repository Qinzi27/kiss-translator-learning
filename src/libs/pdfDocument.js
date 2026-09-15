import { policyFetch } from "./networkPolicy";
import { extractPdfParagraphs } from "./pdfText";
import { loadPdfEngine, pdfAssetUrl } from "./pdfEngine";
import { browser } from "./browser";
import { isExt } from "./client";
import { getPdfSourceUrl } from "./pdfLaunch";

export const PDF_LIMITS = {
  bytes: 50 * 1024 * 1024,
  pages: 200,
  chars: 2000000,
  pageItems: 20000,
  items: 300000,
};
const aborted = () => new DOMException("已停止读取 PDF", "AbortError");
const checkAbort = (signal) => {
  if (signal?.aborted) throw aborted();
};

export function validatePdfBytes(data) {
  if (!data?.byteLength || data.byteLength > PDF_LIMITS.bytes)
    throw new Error("请选择非空且不超过 50 MB 的 PDF。");
  // Some valid PDFs have a short prefix before their header. HTML login pages
  // and JSON errors must never reach the PDF parser or the translation service.
  const header = String.fromCharCode(
    ...new Uint8Array(
      data.buffer || data,
      data.byteOffset || 0,
      Math.min(data.byteLength, 1024)
    )
  );
  if (!header.includes("%PDF-"))
    throw new Error(
      "内容不是 PDF，可能是登录或下载跳转页。请下载文件后在此打开。"
    );
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

export async function readPdfFile(file, signal) {
  if (!file || file.size > PDF_LIMITS.bytes || !file.size)
    throw new Error("请选择非空且不超过 50 MB 的 PDF。");
  checkAbort(signal);
  const bytes = await file.arrayBuffer();
  checkAbort(signal);
  return validatePdfBytes(bytes);
}

export async function downloadPdf(url, signal) {
  checkAbort(signal);
  const controller = new AbortController();
  const stop = () => controller.abort();
  signal?.addEventListener("abort", stop, { once: true });
  if (signal?.aborted) stop();
  const timeout = setTimeout(stop, 45000);
  let reader;
  try {
    const source = url.trim();
    const init = {
      signal: controller.signal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
    };
    let response;
    if (/^file:/i.test(source)) {
      const localSource = getPdfSourceUrl(source);
      const fileHelp = "请在扩展详情允许访问文件网址，或选择本地文件。";
      if (
        !isExt ||
        !localSource ||
        !localSource.startsWith("file:") ||
        typeof browser?.extension?.isAllowedFileSchemeAccess !== "function"
      ) {
        throw new Error(fileHelp);
      }
      let allowed = false;
      try {
        allowed = await waitFor(
          browser.extension.isAllowedFileSchemeAccess(),
          controller.signal
        );
      } catch {}
      checkAbort(controller.signal);
      if (!allowed) throw new Error(fileHelp);
      // File access is separately granted by the browser. Keep local PDF reads
      // out of the HTTP network policy without permitting other local paths,
      // UNC hosts, redirects, credentials, or a remote fetch fallback.
      try {
        response = await fetch(localSource, { ...init, redirect: "error" });
      } catch (error) {
        checkAbort(controller.signal);
        throw new Error(`无法读取本地 PDF。${fileHelp}`);
      }
    } else {
      // HTTP(S) downloads still use the live translation network policy.
      response = await policyFetch(source, init);
    }
    if (!response.ok)
      throw new Error(
        `PDF 下载失败（HTTP ${response.status}），可改为打开本地文件。`
      );
    if (Number(response.headers.get("content-length")) > PDF_LIMITS.bytes)
      throw new Error("PDF 超过 50 MB，请使用较小的文件。");
    if (!response.body?.getReader)
      throw new Error("浏览器不支持安全流式下载，请下载后选择本地文件。");
    reader = response.body.getReader();
    const parts = [];
    let length = 0;
    for (;;) {
      checkAbort(controller.signal);
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > PDF_LIMITS.bytes)
        throw new Error("PDF 超过 50 MB，请使用较小的文件。");
      parts.push(value);
    }
    checkAbort(controller.signal);
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    return validatePdfBytes(bytes);
  } catch (error) {
    if (signal?.aborted) throw aborted();
    if (controller.signal.aborted)
      throw new Error("PDF 下载超时，请稍后重试或打开本地文件。");
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", stop);
    await reader?.cancel().catch(() => {});
    controller.abort();
  }
}

function waitFor(operation, signal) {
  return new Promise((resolve, reject) => {
    const stop = () => reject(aborted());
    signal?.addEventListener("abort", stop, { once: true });
    Promise.resolve(operation)
      .then(resolve, reject)
      .finally(() => signal?.removeEventListener("abort", stop));
    if (signal?.aborted) stop();
  });
}

async function parsePdf(data, { signal, onProgress }) {
  checkAbort(signal);
  const engine = await waitFor(loadPdfEngine(), signal);
  checkAbort(signal);
  // Supplying the module worker explicitly avoids PDF.js creating a blob
  // wrapper for chrome-extension:// URLs. MV3 keeps its default self-only CSP.
  const port = new Worker(pdfAssetUrl("pdf.worker.mjs"), { type: "module" });
  const worker = new engine.PDFWorker({ port });
  const workerFailure = new Promise((_, reject) => {
    port.onerror = (event) =>
      reject(
        new Error(
          `PDF 解析组件无法运行：${event.message || "请刷新页面或更新浏览器。"}`
        )
      );
  });
  void workerFailure.catch(() => {});
  const wait = (operation) =>
    waitFor(Promise.race([operation, workerFailure]), signal);
  let task;
  let destroyed = false;
  let extractionComplete = false;
  let destruction;
  const destroy = () => {
    if (destroyed) return destruction;
    destroyed = true;
    let cleanup;
    try {
      cleanup = Promise.resolve(task?.destroy());
    } catch {
      cleanup = Promise.resolve();
    }
    destruction = new Promise((resolve) => {
      let released = false;
      let deadline;
      const release = () => {
        if (released) return;
        released = true;
        clearTimeout(deadline);
        // A failed library cleanup must never prevent the native worker from
        // being terminated or leave the caller waiting for this promise.
        try {
          worker.destroy();
        } catch {}
        port.onerror = null;
        try {
          port.terminate();
        } catch {}
        resolve();
      };
      if (extractionComplete) {
        // PDF.js clears document fonts and filters after its worker's Terminate
        // acknowledgement. Give a normally closed document time to finish that
        // handshake, while bounding an unresponsive cleanup to one second.
        deadline = setTimeout(release, 1000);
        cleanup.then(release, release);
      } else {
        // Cancellation, timeout, or failure during parsing must stop work now.
        void cleanup.catch(() => {});
        release();
      }
    });
    return destruction;
  };
  signal?.addEventListener("abort", destroy, { once: true });
  try {
    task = engine.getDocument({
      data: validatePdfBytes(data),
      worker,
      enableXfa: false,
      useWasm: false,
      useSystemFonts: false,
      isOffscreenCanvasSupported: false,
      cMapUrl: pdfAssetUrl("cmaps/"),
      cMapPacked: true,
      standardFontDataUrl: pdfAssetUrl("standard_fonts/"),
      wasmUrl: pdfAssetUrl("wasm/"),
      iccUrl: pdfAssetUrl("iccs/"),
      maxImageSize: 16000000,
    });
    const pdf = await wait(task.promise);
    checkAbort(signal);
    if (pdf.numPages > PDF_LIMITS.pages)
      throw new Error("此版本支持最多 200 页，请先拆分较长的 PDF。");
    const pages = [];
    let chars = 0;
    let count = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
      checkAbort(signal);
      const page = await wait(pdf.getPage(number));
      const reader = page.streamTextContent().getReader();
      const items = [];
      try {
        for (;;) {
          const { value, done } = await wait(reader.read());
          checkAbort(signal);
          if (done) break;
          for (const item of value.items) {
            chars += item.str?.length || 0;
            count++;
            if (
              chars > PDF_LIMITS.chars ||
              count > PDF_LIMITS.items ||
              items.length >= PDF_LIMITS.pageItems
            )
              throw new Error("PDF 文字量或页面复杂度过大，请先拆分文件。");
            items.push(item);
          }
        }
      } finally {
        void reader.cancel().catch(() => {});
      }
      pages.push({
        number,
        paragraphs: extractPdfParagraphs(items, {
          pageWidth: page.view[2] - page.view[0],
        }),
      });
      page.cleanup();
      onProgress(number, pdf.numPages);
    }
    extractionComplete = true;
    return { pdf, pages, destroy };
  } catch (error) {
    destroy();
    if (signal?.aborted) throw aborted();
    if (error?.name === "PasswordException")
      throw new Error(
        "此 PDF 需要密码，请先用你有权访问的阅读器解锁并另存副本。"
      );
    throw error;
  } finally {
    signal?.removeEventListener("abort", destroy);
  }
}

export async function openPdf(data, { signal, onProgress = () => {} } = {}) {
  checkAbort(signal);
  const controller = new AbortController();
  const stop = () => controller.abort();
  signal?.addEventListener("abort", stop, { once: true });
  const timeout = setTimeout(stop, 90000);
  try {
    return await parsePdf(data, { signal: controller.signal, onProgress });
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted)
      throw new Error("PDF 解析超时，请尝试较小的文件。");
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", stop);
  }
}
