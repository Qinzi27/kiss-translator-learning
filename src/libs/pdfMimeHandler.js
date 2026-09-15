import { isExt, isGm } from "./client";
import { PDF_LIMITS, validatePdfBytes } from "./pdfDocument";

// Native Chrome streams are capabilities, not caller-supplied download URLs.
// Only getStreamInfo in a browser-created handler frame can issue one.
const streams = new WeakMap();
let activeHandler = false;
const nativeApi = () =>
  isExt && !isGm ? globalThis.chrome?.mimeHandler : undefined;
const aborted = () => new DOMException("已停止读取 PDF", "AbortError");

export const supportsPdfMimeHandler = () =>
  typeof nativeApi()?.getStreamInfo === "function";
export const hasActiveMimePdf = () => activeHandler;

// Display-only URL supplied by Chrome. MIME-confirmed downloads need not end
// in .pdf; this value must never be used as a replacement for the native stream.
export function getMimePdfSourceUrl(value) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    if (url.username || url.password) return "";
    if (["http:", "https:"].includes(url.protocol)) return url.href;
    if (url.protocol === "file:" && !url.hostname) {
      const path = decodeURIComponent(url.pathname);
      if (
        path.startsWith("/") &&
        !path.startsWith("//") &&
        !path.includes("\\")
      )
        return url.href;
    }
    if (
      url.protocol === "blob:" &&
      ["http:", "https:"].includes(new URL(url.pathname).protocol)
    )
      return url.href;
  } catch {}
  return "";
}

export async function getMimePdfLaunch() {
  const api = nativeApi();
  if (!api?.getStreamInfo) return null;
  let info;
  try {
    info = await api.getStreamInfo();
  } catch {
    // The API is present in ordinary extension pages too; no associated
    // stream means the toolbar/file-picker flow should continue as usual.
    return null;
  }
  if (info?.mimeType !== "application/pdf" || info.embedded) return null;
  if (typeof info.streamUrl !== "string" || !info.streamUrl) return null;
  activeHandler = true;
  const url = new URL(info.streamUrl);
  if (
    url.protocol !== "chrome-extension:" ||
    url.hostname !== globalThis.chrome?.runtime?.id ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(url.pathname)
  )
    throw new Error("浏览器返回的 PDF 流无效，请返回 Chrome 原生阅读器。");
  const capability = {};
  streams.set(capability, info.streamUrl);
  return {
    sourceUrl: getMimePdfSourceUrl(info.originalUrl),
    mimeStream: capability,
    quick: false,
  };
}

function wait(operation, signal) {
  return new Promise((resolve, reject) => {
    const stop = () => reject(aborted());
    signal.addEventListener("abort", stop, { once: true });
    Promise.resolve(operation)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", stop));
    if (signal.aborted) stop();
  });
}

export async function downloadMimePdf(capability, signal) {
  const streamUrl = streams.get(capability);
  if (!streamUrl) throw new Error("PDF 流已使用或无效，请刷新 PDF 页面。");
  streams.delete(capability);
  if (signal?.aborted) throw aborted();
  const controller = new AbortController();
  const stop = () => controller.abort();
  signal?.addEventListener("abort", stop, { once: true });
  const timeout = setTimeout(stop, 45000);
  let reader;
  try {
    // This reads the response Chrome already received. Never re-fetch the
    // original URL, add cookies, or route a native stream through an API.
    const response = await wait(
      fetch(streamUrl, {
        signal: controller.signal,
        credentials: "omit",
        referrerPolicy: "no-referrer",
        redirect: "error",
        cache: "no-store",
      }),
      controller.signal
    );
    if (!response.ok) throw new Error("浏览器未能提供 PDF，请返回原生阅读器。");
    if (Number(response.headers.get("content-length")) > PDF_LIMITS.bytes)
      throw new Error("PDF 超过 50 MB，请使用较小的文件。");
    if (!response.body?.getReader)
      throw new Error("浏览器不支持流式读取，请返回原生阅读器。");
    reader = response.body.getReader();
    const parts = [];
    let length = 0;
    for (;;) {
      const { done, value } = await wait(reader.read(), controller.signal);
      if (done) break;
      length += value.byteLength;
      if (length > PDF_LIMITS.bytes)
        throw new Error("PDF 超过 50 MB，请使用较小的文件。");
      parts.push(value);
    }
    if (controller.signal.aborted) throw aborted();
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
      throw new Error("PDF 读取超时，请刷新页面或返回 Chrome 原生阅读器。");
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", stop);
    controller.abort();
    try {
      void reader?.cancel().catch(() => {});
    } catch {}
  }
}

export async function getPdfHandlingEnabled() {
  const api = nativeApi();
  if (!api?.getMimeHandlerOptions) return null;
  return (await api.getMimeHandlerOptions("application/pdf")).enabled !== false;
}

export async function setPdfHandlingEnabled(enabled) {
  const api = nativeApi();
  if (!api?.setMimeHandlerOptions)
    throw new Error(
      "当前浏览器不支持 PDF 自动接管，请使用 Chrome 151 或更新版本。"
    );
  await api.setMimeHandlerOptions("application/pdf", { enabled: !!enabled });
}

export async function returnToNativePdf() {
  const api = nativeApi();
  if (!activeHandler || !api?.abortAndFallbackToNativeHandler)
    throw new Error("当前页面不是 Chrome 接管的 PDF，请从原文件重新打开。");
  await api.abortAndFallbackToNativeHandler();
}
