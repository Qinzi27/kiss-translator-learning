import { browser } from "./browser";
import { isExt, isGm } from "./client";
import { getMimePdfLaunch } from "./pdfMimeHandler";

const LAUNCH_TTL = 2 * 60 * 1000;
const storageKey = (tabId) => `pdfLaunch:${tabId}`;
const consuming = new Set();

export function getPdfSourceUrl(value) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    if (url.username || url.password) return "";
    if (url.protocol === "file:") {
      const path = decodeURIComponent(url.pathname);
      if (
        url.hostname ||
        url.search ||
        !/^file:\/\/\//i.test(value.trim()) ||
        !path.startsWith("/") ||
        path.startsWith("//") ||
        path.includes("\\") ||
        !/\.pdf$/i.test(path)
      )
        return "";
      return url.href;
    }
    if (!["http:", "https:"].includes(url.protocol)) return "";
    const arxiv =
      ["arxiv.org", "www.arxiv.org", "export.arxiv.org"].includes(
        url.hostname
      ) &&
      url.pathname.startsWith("/pdf/") &&
      url.pathname.length > 5;
    return /\.pdf$/i.test(url.pathname) || arxiv ? url.href : "";
  } catch {
    return "";
  }
}

function sessionStorage() {
  const session = browser?.storage?.session;
  return session?.set && session?.get && session?.remove ? session : null;
}

function randomNonce() {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}

// Called only by extension UI/native extension commands, never a page message.
export async function launchPdfInTab(tab) {
  const sourceUrl = getPdfSourceUrl(tab?.url);
  if (!isExt || isGm || !sourceUrl || !Number.isInteger(tab?.id) || tab.id < 0)
    return false;
  if (!browser?.runtime?.getURL || !browser?.tabs?.update) {
    throw new Error("无法打开 PDF 阅读器，请重新加载扩展后重试。");
  }
  const reader = browser.runtime.getURL("pdf.html");
  const session = sessionStorage();
  if (!session) {
    // Without session-scoped authorization this is a prefill only. The reader
    // must still require a manual load/translate action for a plain #url.
    await browser.tabs.update(tab.id, {
      url: `${reader}#url=${encodeURIComponent(sourceUrl)}`,
    });
    return true;
  }
  const nonce = randomNonce();
  const key = storageKey(tab.id);
  await session.set({ [key]: { nonce, sourceUrl, issuedAt: Date.now() } });
  try {
    await browser.tabs.update(tab.id, { url: `${reader}#launch=${nonce}` });
  } catch {
    await session.remove(key).catch(() => {});
    throw new Error("无法在当前标签打开 PDF 阅读器，请重试。");
  }
  return true;
}

export async function consumePdfLaunch() {
  const nativeLaunch = await getMimePdfLaunch();
  if (nativeLaunch) return nativeLaunch;
  if (!isExt || isGm || !browser?.runtime?.getURL || !browser?.tabs?.getCurrent)
    return null;
  const session = sessionStorage();
  if (!session) return null;
  let nonce;
  let ownsConsumption = false;
  try {
    const current = new URL(window.location.href);
    const reader = new URL(browser.runtime.getURL("pdf.html"));
    if (
      current.protocol !== reader.protocol ||
      current.host !== reader.host ||
      current.pathname !== reader.pathname ||
      current.search
    )
      return null;
    const params = new URLSearchParams(current.hash.slice(1));
    nonce = params.get("launch");
    if (
      !/^[a-f0-9]{64}$/.test(nonce || "") ||
      params.getAll("launch").length !== 1 ||
      params.has("url") ||
      consuming.has(nonce)
    )
      return null;
    consuming.add(nonce);
    ownsConsumption = true;
    const tab = await browser.tabs.getCurrent();
    if (!Number.isInteger(tab?.id) || tab.id < 0) return null;
    const key = storageKey(tab.id);
    const stored = (await session.get(key))?.[key];
    const sourceUrl = getPdfSourceUrl(stored?.sourceUrl);
    const elapsed = Date.now() - stored?.issuedAt;
    if (
      !stored ||
      stored.nonce !== nonce ||
      !sourceUrl ||
      !Number.isFinite(stored.issuedAt) ||
      elapsed < 0 ||
      elapsed >= LAUNCH_TTL
    )
      return null;
    // Remove before returning permission to load/send. If removal fails, fail
    // closed rather than handing out a reusable automatic-translation grant.
    await session.remove(key);
    return { sourceUrl };
  } catch {
    return null;
  } finally {
    if (ownsConsumption) consuming.delete(nonce);
  }
}
