import { browser } from "./browser";
import { isExt, isGm } from "./client";
import { getPdfSourceUrl } from "./pdfLaunch";

export const PDF_TRANSLATION_SESSION_LIMITS = Object.freeze({
  maxPages: 80,
  maxBytes: 8 * 1024 * 1024,
});

const KEY = "pdfTranslationSession:v1";
const LOCK = "kiss-pdf-translation-session-v1";
const DIGEST = /^[a-f0-9]{64}$/;
const PAGE_KEY = /^[a-f0-9]{64}:(?:[1-9]\d?|1\d\d|200)$/;
const empty = () => ({ version: 1, pages: {}, readers: {} });
let queued = Promise.resolve();

function isReaderPage() {
  try {
    const current = new URL(window.location.href);
    const reader = new URL(browser.runtime.getURL("pdf.html"));
    return (
      current.protocol === reader.protocol &&
      current.host === reader.host &&
      current.pathname === reader.pathname
    );
  } catch {
    return false;
  }
}

function backend() {
  if (isGm) return null;
  try {
    if (isExt) {
      const session = browser?.storage?.session;
      // One global envelope enforces a global bound. Web Locks serialize its
      // read/modify/write across extension tabs; a per-module queue alone cannot.
      if (
        !isReaderPage() ||
        !session?.get ||
        !session?.set ||
        !session?.remove ||
        !globalThis.navigator?.locks?.request
      )
        return null;
      return {
        mode: "extension-session",
        read: async () => (await session.get(KEY))?.[KEY],
        write: async (text) => session.set({ [KEY]: text }),
        remove: async () => session.remove(KEY),
      };
    }
    const session = window.sessionStorage;
    return {
      mode: "preview-session",
      read: async () => session.getItem(KEY),
      write: async (text) => session.setItem(KEY, text),
      remove: async () => session.removeItem(KEY),
    };
  } catch {
    return null;
  }
}

export function getPdfTranslationSessionInfo() {
  const mode = backend()?.mode || "disabled";
  return {
    mode,
    ...PDF_TRANSLATION_SESSION_LIMITS,
    notice:
      mode === "extension-session"
        ? "译文临时保存在扩展会话内存中；浏览器会话结束后清除。"
        : mode === "preview-session"
          ? "网页预览使用当前标签的 sessionStorage；复制标签或恢复会话可能保留，不等同扩展内存缓存。"
          : "当前环境不支持安全会话缓存；翻译继续，刷新后不恢复译文。",
  };
}

function canonical(value, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (!value || typeof value !== "object" || seen.has(value))
    throw new Error("Unsupported fingerprint data");
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    result = `[${value.map((item) => canonical(item === undefined ? null : item, seen)).join(",")}]`;
  } else {
    if (
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      throw new Error("Unsupported fingerprint object");
    result = `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key], seen)}`)
      .join(",")}}`;
  }
  seen.delete(value);
  return result;
}

async function digest(bytes) {
  if (!globalThis.crypto?.subtle?.digest) return null;
  try {
    const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(hash), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
  } catch {
    return null;
  }
}

const hashText = (text) => digest(new TextEncoder().encode(text));

// Call before PDF.js transfers the buffer to its worker. Never use a URL, file
// name, prefix, or weak fallback hash as the document identity.
export async function hashPdfDocument(bytes) {
  try {
    let view;
    if (ArrayBuffer.isView(bytes)) {
      view = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    } else {
      // The native getter checks the ArrayBuffer brand across realms, unlike
      // instanceof (File/TextEncoder can supply a buffer from another realm).
      Object.getOwnPropertyDescriptor(
        ArrayBuffer.prototype,
        "byteLength"
      ).get.call(bytes);
      view = new Uint8Array(bytes);
    }
    if (!view?.byteLength) return null;
    return await digest(view);
  } catch {
    return null;
  }
}

export async function createPdfTranslationContext({
  documentId,
  apiSetting,
  fromLang,
  toLang,
} = {}) {
  if (
    !DIGEST.test(documentId || "") ||
    !apiSetting ||
    typeof apiSetting !== "object" ||
    typeof fromLang !== "string" ||
    !fromLang ||
    typeof toLang !== "string" ||
    !toLang
  )
    return null;
  try {
    // Hash the complete resolved provider configuration, including credentials,
    // endpoint, model and prompt. Only the digest reaches storage, never the key.
    return await hashText(
      canonical({ version: 1, documentId, apiSetting, fromLang, toLang })
    );
  } catch {
    return null;
  }
}

async function paragraphDigest(paragraph) {
  if (
    !paragraph ||
    !["string", "number"].includes(typeof paragraph.id) ||
    typeof paragraph.text !== "string" ||
    !paragraph.text
  )
    return null;
  return hashText(JSON.stringify([String(paragraph.id), paragraph.text]));
}

function pageKey(contextId, pageNumber) {
  return DIGEST.test(contextId || "") &&
    Number.isInteger(pageNumber) &&
    pageNumber > 0 &&
    pageNumber <= 200
    ? `${contextId}:${pageNumber}`
    : null;
}

// A conservative payload budget: charge the larger UTF-8 or UTF-16 serialized
// representation, including our key. Browser-internal overhead/other session
// keys can still produce a quota error, handled by eviction below.
function byteSize(text) {
  return Math.max(
    new TextEncoder().encode(KEY + text).byteLength,
    2 * (KEY.length + text.length)
  );
}

const validTouch = (value) => Number.isSafeInteger(value) && value >= 0;

function decode(raw) {
  const result = empty();
  if (
    typeof raw !== "string" ||
    byteSize(raw) > PDF_TRANSLATION_SESSION_LIMITS.maxBytes
  )
    return result;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1) return result;
    for (const [key, page] of Object.entries(parsed.pages || {})) {
      if (!PAGE_KEY.test(key) || !validTouch(page?.touched)) continue;
      const entries = Object.fromEntries(
        Object.entries(page.entries || {}).filter(
          ([id, text]) =>
            DIGEST.test(id) && typeof text === "string" && !!text.trim()
        )
      );
      if (Object.keys(entries).length)
        result.pages[key] = { touched: page.touched, entries };
    }
    for (const [key, state] of Object.entries(parsed.readers || {})) {
      const sourceUrl = getPdfSourceUrl(state?.sourceUrl);
      if (
        !/^(?:tab:\d+|preview)$/.test(key) ||
        !sourceUrl ||
        !DIGEST.test(state?.documentId || "") ||
        !DIGEST.test(state?.resumeNonce || "") ||
        !validTouch(state?.touched) ||
        !Number.isInteger(state?.pageNumber) ||
        state.pageNumber < 1 ||
        state.pageNumber > 200
      )
        continue;
      result.readers[key] = {
        documentId: state.documentId,
        sourceUrl,
        pageNumber: state.pageNumber,
        resumeNonce: state.resumeNonce,
        touched: state.touched,
      };
    }
  } catch {
    return empty();
  }
  return result;
}

function touch(store) {
  return Math.max(
    Date.now(),
    ...Object.values(store.pages).map((page) => page.touched + 1),
    ...Object.values(store.readers).map((state) => state.touched + 1)
  );
}

function oldest(collection) {
  return Object.keys(collection).sort(
    (a, b) =>
      collection[a].touched - collection[b].touched || a.localeCompare(b)
  )[0];
}

function evict(store) {
  const page = oldest(store.pages);
  const reader = oldest(store.readers);
  if (!page && !reader) return false;
  // Keep the small navigation hints while evicting bulky translation pages;
  // each collection still has its own LRU and hard entry limit.
  if (page) delete store.pages[page];
  else delete store.readers[reader];
  return true;
}

function trim(store) {
  const { maxPages, maxBytes } = PDF_TRANSLATION_SESSION_LIMITS;
  while (Object.keys(store.pages).length > maxPages)
    delete store.pages[oldest(store.pages)];
  while (Object.keys(store.readers).length > maxPages)
    delete store.readers[oldest(store.readers)];
  while (byteSize(JSON.stringify(store)) > maxBytes && evict(store)) {
    /* LRU eviction */
  }
}

async function persist(target, store) {
  trim(store);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await target.write(JSON.stringify(store));
      return true;
    } catch {
      // Web preview quota is commonly smaller than our extension budget. Retry
      // with fewer entries, but never move sensitive text to local/sync storage.
      const count =
        Object.keys(store.pages).length + Object.keys(store.readers).length;
      if (!count) return false;
      for (let n = 0; n < Math.ceil(count / 2); n++) evict(store);
    }
  }
  return false;
}

function serialized(operation, fallback) {
  const target = backend();
  if (!target) return Promise.resolve(fallback);
  const run = async () => {
    try {
      const raw = await target.read();
      const store = decode(raw);
      trim(store);
      const { value, changed, confirm } = operation(store);
      if (changed || raw !== JSON.stringify(store)) {
        const saved = await persist(target, store);
        if (confirm) return saved && confirm(store) ? value : fallback;
      }
      return value;
    } catch {
      return fallback;
    }
  };
  const execute = () =>
    globalThis.navigator?.locks?.request
      ? globalThis.navigator.locks.request(LOCK, run)
      : run();
  const task = queued.then(execute, execute).catch(() => fallback);
  queued = task.then(
    () => undefined,
    () => undefined
  );
  return task;
}

export async function readPdfTranslationPage({
  contextId,
  pageNumber,
  paragraphs,
} = {}) {
  const key = pageKey(contextId, pageNumber);
  if (!key || !Array.isArray(paragraphs) || paragraphs.length > 20000)
    return {};
  const ids = await Promise.all(paragraphs.map(paragraphDigest));
  return serialized((store) => {
    const page = store.pages[key];
    if (!page) return { value: {}, changed: false };
    const value = Object.fromEntries(
      paragraphs.flatMap((paragraph, i) =>
        ids[i] && typeof page.entries[ids[i]] === "string"
          ? [[String(paragraph.id), page.entries[ids[i]]]]
          : []
      )
    );
    page.touched = touch(store);
    return { value, changed: true };
  }, {});
}

export async function writePdfTranslation({
  contextId,
  pageNumber,
  paragraph,
  translation,
} = {}) {
  const key = pageKey(contextId, pageNumber);
  if (
    !key ||
    typeof translation !== "string" ||
    !translation.trim() ||
    byteSize(JSON.stringify(translation)) >
      PDF_TRANSLATION_SESSION_LIMITS.maxBytes
  )
    return false;
  const id = await paragraphDigest(paragraph);
  if (!id) return false;
  return serialized((store) => {
    const touched = touch(store);
    const page = store.pages[key] || { entries: {} };
    page.entries[id] = translation;
    page.touched = touched;
    store.pages[key] = page;
    return {
      value: true,
      changed: true,
      confirm: (current) => current.pages[key]?.entries[id] === translation,
    };
  }, false);
}

async function readerKey() {
  if (!isExt) return "preview";
  if (!isReaderPage()) return null;
  try {
    const tab = await browser.tabs.getCurrent();
    return Number.isInteger(tab?.id) && tab.id >= 0 ? `tab:${tab.id}` : null;
  } catch {
    return null;
  }
}

function resumeFromUrl() {
  try {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const nonce = params.get("resume");
    return DIGEST.test(nonce || "") &&
      params.getAll("resume").length === 1 &&
      !params.has("url") &&
      !params.has("launch")
      ? nonce
      : null;
  } catch {
    return null;
  }
}

export async function savePdfReadingState({
  documentId,
  sourceUrl,
  pageNumber,
} = {}) {
  const source = getPdfSourceUrl(sourceUrl);
  if (
    !source ||
    !DIGEST.test(documentId || "") ||
    !Number.isInteger(pageNumber) ||
    pageNumber < 1 ||
    pageNumber > 200
  )
    return null;
  const key = await readerKey();
  if (!key) return null;
  let nonce;
  try {
    const random = globalThis.crypto.getRandomValues(new Uint8Array(32));
    nonce = Array.from(random, (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
  } catch {
    return null;
  }
  const currentNonce = resumeFromUrl();
  return serialized((store) => {
    const previous = store.readers[key];
    if (
      previous?.resumeNonce === currentNonce &&
      previous.documentId === documentId &&
      previous.sourceUrl === source
    )
      nonce = previous.resumeNonce;
    store.readers[key] = {
      documentId,
      sourceUrl: source,
      pageNumber,
      resumeNonce: nonce,
      touched: touch(store),
    };
    return {
      value: { resumeNonce: nonce },
      changed: true,
      confirm: (current) => current.readers[key]?.resumeNonce === nonce,
    };
  }, null);
}

// Resume metadata is a read-only navigation hint, never an automatic-translation
// grant. A fresh empty reader, #url or #launch cannot inherit an older source.
// Extension resumes additionally require the same tab id. Preview sessionStorage
// may be cloned when the browser duplicates a tab. File-picker bytes never persist.
export async function loadPdfReadingState() {
  const nonce = resumeFromUrl();
  if (!nonce) return null;
  const key = await readerKey();
  if (!key) return null;
  return serialized((store) => {
    const state = store.readers[key];
    if (state?.resumeNonce !== nonce) return { value: null, changed: false };
    state.touched = touch(store);
    return {
      value: {
        documentId: state.documentId,
        sourceUrl: state.sourceUrl,
        pageNumber: state.pageNumber,
      },
      changed: true,
    };
  }, null);
}
