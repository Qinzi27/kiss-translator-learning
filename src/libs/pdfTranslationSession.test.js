let mockBrowser;
let mockIsExt = true;
let mockIsGm = false;
jest.mock("./browser", () => ({
  get browser() {
    return mockBrowser;
  },
}));
jest.mock("./client", () => ({
  get isExt() {
    return mockIsExt;
  },
  get isGm() {
    return mockIsGm;
  },
}));

const originalLocation = window.location;
const originalCrypto = globalThis.crypto;
const originalLocks = navigator.locks;
const readerUrl = "chrome-extension://test-extension/pdf.html";
const contextId = "c".repeat(64);
const documentId = "d".repeat(64);
const paragraph = { id: "p1", text: "CONFIDENTIAL_SOURCE_ONLY" };
let records;
let api;
let lockTail;
let critical;
let peakCritical;

function loadModule() {
  let module;
  jest.isolateModules(() => {
    module = require("./pdfTranslationSession");
  });
  return module;
}

function at(url) {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: new URL(url),
  });
}

function snapshot() {
  return Object.values(records).length
    ? JSON.parse(Object.values(records)[0])
    : null;
}

beforeEach(() => {
  records = {};
  mockIsExt = true;
  mockIsGm = false;
  lockTail = Promise.resolve();
  critical = 0;
  peakCritical = 0;
  mockBrowser = {
    runtime: { getURL: jest.fn(() => readerUrl) },
    tabs: { getCurrent: jest.fn(async () => ({ id: 7 })) },
    storage: {
      session: {
        get: jest.fn(async (key) => ({ [key]: records[key] })),
        set: jest.fn(async (values) => {
          Object.assign(records, values);
        }),
        remove: jest.fn(async (key) => {
          delete records[key];
        }),
      },
      local: { set: jest.fn() },
      sync: { set: jest.fn() },
    },
  };
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: require("crypto").webcrypto,
  });
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: jest.fn((_name, operation) => {
        const run = async () => {
          critical++;
          peakCritical = Math.max(peakCritical, critical);
          try {
            return await operation();
          } finally {
            critical--;
          }
        };
        const task = lockTail.then(run, run);
        lockTail = task.catch(() => {});
        return task;
      }),
    },
  });
  window.sessionStorage.clear();
  at(readerUrl);
  api = loadModule();
});

afterEach(() => {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: originalCrypto,
  });
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: originalLocks,
  });
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
  window.sessionStorage.clear();
  jest.restoreAllMocks();
});

function write(
  pageNumber,
  translation = "译文",
  item = paragraph,
  module = api,
  context = contextId
) {
  return module.writePdfTranslation({
    contextId: context,
    pageNumber,
    paragraph: item,
    translation,
  });
}

function read(
  pageNumber,
  paragraphs = [paragraph],
  module = api,
  context = contextId
) {
  return module.readPdfTranslationPage({
    contextId: context,
    pageNumber,
    paragraphs,
  });
}

test("document identity hashes every byte and respects typed-array offsets", async () => {
  const abc = new TextEncoder().encode("abc");
  const known =
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
  await expect(api.hashPdfDocument(abc)).resolves.toBe(known);
  await expect(api.hashPdfDocument(abc.buffer)).resolves.toBe(known);
  const padded = new Uint8Array([0, ...abc, 0]);
  await expect(api.hashPdfDocument(padded.subarray(1, 4))).resolves.toBe(known);
  const first = new Uint8Array(200000).fill(1);
  const second = first.slice();
  second[second.length - 1] = 2;
  expect(await api.hashPdfDocument(first)).not.toBe(
    await api.hashPdfDocument(second)
  );
  await expect(api.hashPdfDocument(new Uint8Array())).resolves.toBeNull();
});

test("provider fingerprints ignore object key ordering but separate secrets, model, URL, prompt and language changes", async () => {
  const settings = {
    apiSlug: "a",
    key: "SYNTHETIC_KEY_A",
    url: "https://api.example.test/v1",
    model: "m1",
    prompt: "brief",
    headers: { "X-A": "1", "X-B": "2" },
  };
  const create = (changes) =>
    api.createPdfTranslationContext({
      documentId,
      apiSetting: settings,
      fromLang: "en",
      toLang: "zh-CN",
      ...changes,
    });
  const base = await create();
  expect(base).toMatch(/^[a-f0-9]{64}$/);
  await expect(
    create({
      apiSetting: {
        headers: { "X-B": "2", "X-A": "1" },
        prompt: "brief",
        model: "m1",
        url: settings.url,
        key: settings.key,
        apiSlug: "a",
      },
    })
  ).resolves.toBe(base);
  for (const changed of [
    { key: "SYNTHETIC_KEY_B" },
    { url: "https://other.test/v1" },
    { model: "m2" },
    { prompt: "formal" },
    { headers: { Authorization: "SYNTHETIC_AUTH" } },
  ])
    expect(await create({ apiSetting: { ...settings, ...changed } })).not.toBe(
      base
    );
  expect(await create({ documentId: "a".repeat(64) })).not.toBe(base);
  expect(await create({ fromLang: "zh-CN", toLang: "en" })).not.toBe(base);
});

test("refreshing the module restores translations, without storing source paragraphs, file bytes or provider secrets", async () => {
  const sourceBytes = new TextEncoder().encode(
    "%PDF-SYNTHETIC_FILE_CONTENT_ONLY"
  );
  const doc = await api.hashPdfDocument(sourceBytes);
  const context = await api.createPdfTranslationContext({
    documentId: doc,
    apiSetting: {
      key: "SYNTHETIC_KEY_ONLY",
      customHeader: { Authorization: "SYNTHETIC_HEADER_ONLY" },
      customBody: { secret: "SYNTHETIC_BODY_ONLY" },
    },
    fromLang: "en",
    toLang: "zh-CN",
  });
  await expect(
    write(1, "仅有译文被保存", paragraph, api, context)
  ).resolves.toBe(true);
  const restored = loadModule();
  await expect(read(1, [paragraph], restored, context)).resolves.toEqual({
    p1: "仅有译文被保存",
  });
  const persisted = JSON.stringify(records);
  for (const secret of [
    "SYNTHETIC_KEY_ONLY",
    "SYNTHETIC_HEADER_ONLY",
    "SYNTHETIC_BODY_ONLY",
    paragraph.text,
    "SYNTHETIC_FILE_CONTENT_ONLY",
  ])
    expect(persisted).not.toContain(secret);
  expect(persisted).toContain("仅有译文被保存");
  expect(mockBrowser.storage.local.set).not.toHaveBeenCalled();
  expect(mockBrowser.storage.sync.set).not.toHaveBeenCalled();
});

test("paragraph id reuse, changed content, another page and another provider context cannot reuse the wrong translation", async () => {
  await write(1);
  await expect(
    read(1, [{ ...paragraph, text: "Changed source" }])
  ).resolves.toEqual({});
  await expect(read(1, [{ ...paragraph, id: "p2" }])).resolves.toEqual({});
  await expect(read(2)).resolves.toEqual({});
  await expect(read(1, [paragraph], api, "f".repeat(64))).resolves.toEqual({});
  await expect(read(1)).resolves.toEqual({ p1: "译文" });
});

test("separate extension contexts use a shared lock and merge concurrent paragraph writes", async () => {
  const other = loadModule();
  // A delayed get makes a lost-update race deterministic without shared locks.
  mockBrowser.storage.session.get.mockImplementation(async (key) => {
    const value = records[key];
    await new Promise((resolve) => setTimeout(resolve, 1));
    return { [key]: value };
  });
  const paragraphs = Array.from({ length: 12 }, (_, i) => ({
    id: `p${i}`,
    text: `Original ${i}`,
  }));
  const written = await Promise.all(
    paragraphs.map((item, i) =>
      write(1, `译文 ${i}`, item, i % 2 ? other : api)
    )
  );
  expect(written.every(Boolean)).toBe(true);
  const result = await read(1, paragraphs, other);
  expect(Object.keys(result)).toHaveLength(12);
  paragraphs.forEach((item, i) => expect(result[item.id]).toBe(`译文 ${i}`));
  expect(peakCritical).toBe(1);
});

test("the 80-page LRU retains a recently read page and evicts the oldest unused page", async () => {
  for (let page = 1; page <= 80; page++)
    expect(await write(page, `译文 ${page}`)).toBe(true);
  await read(1);
  await write(81, "新页");
  expect(Object.keys(snapshot().pages)).toHaveLength(80);
  await expect(read(2)).resolves.toEqual({});
  await expect(read(1)).resolves.toEqual({ p1: "译文 1" });
  await expect(read(81)).resolves.toEqual({ p1: "新页" });
});

test("the byte budget evicts entire old pages and bounds every successful persisted envelope", async () => {
  const payload = "x".repeat(1800000);
  const writes = [];
  mockBrowser.storage.session.set.mockImplementation(async (values) => {
    writes.push(values);
    Object.assign(records, values);
  });
  await write(1, payload);
  await write(2, payload);
  await write(3, payload);
  for (const values of writes) {
    const [key, value] = Object.entries(values)[0];
    const measured = Math.max(
      new TextEncoder().encode(key + value).byteLength,
      2 * (key.length + value.length)
    );
    expect(measured).toBeLessThanOrEqual(
      api.PDF_TRANSLATION_SESSION_LIMITS.maxBytes
    );
  }
  await expect(read(1)).resolves.toEqual({});
  expect(Object.keys(snapshot().pages)).toHaveLength(2);
  await expect(write(4, "x".repeat(5 * 1024 * 1024))).resolves.toBe(false);
});

test("quota pressure evicts old entries and never falls back to durable storage", async () => {
  await write(1, "旧页");
  mockBrowser.storage.session.set.mockRejectedValueOnce(
    new Error("QUOTA_BYTES quota exceeded")
  );
  await expect(write(2, "新页")).resolves.toBe(true);
  await expect(read(1)).resolves.toEqual({});
  await expect(read(2)).resolves.toEqual({ p1: "新页" });
  mockBrowser.storage.session.set.mockRejectedValue(
    new Error("storage unavailable")
  );
  await expect(write(3, "无法保存的译文")).resolves.toBe(false);
  expect(mockBrowser.storage.local.set).not.toHaveBeenCalled();
  expect(mockBrowser.storage.sync.set).not.toHaveBeenCalled();
});

test("corrupted and unsupported cache data is discarded without exposing unknown fields", async () => {
  await write(1);
  const key = Object.keys(records)[0];
  records[key] = "{malformed";
  await expect(read(1)).resolves.toEqual({});
  records[key] = JSON.stringify({
    version: 1,
    pages: { wrong: { touched: 1, entries: { malicious: { text: "bad" } } } },
    privateKey: "UNEXPECTED_SECRET",
  });
  await expect(read(1)).resolves.toEqual({});
  expect(JSON.stringify(records)).not.toContain("UNEXPECTED_SECRET");
  await expect(write(1, "恢复保存")).resolves.toBe(true);
  await expect(read(1)).resolves.toEqual({ p1: "恢复保存" });
});

test("unavailable session storage, cross-tab locks or crypto degrades to cache misses", async () => {
  const savedSession = mockBrowser.storage.session;
  mockBrowser.storage.session = undefined;
  expect(api.getPdfTranslationSessionInfo().mode).toBe("disabled");
  await expect(write(1)).resolves.toBe(false);
  await expect(read(1)).resolves.toEqual({});
  expect(window.sessionStorage.length).toBe(0);
  mockBrowser.storage.session = savedSession;
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: undefined,
  });
  expect(api.getPdfTranslationSessionInfo().mode).toBe("disabled");
  await expect(write(1)).resolves.toBe(false);
  await expect(read(1)).resolves.toEqual({});
  expect(mockBrowser.storage.session.set).not.toHaveBeenCalled();
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {},
  });
  await expect(api.hashPdfDocument(new Uint8Array([1]))).resolves.toBeNull();
  await expect(
    api.createPdfTranslationContext({
      documentId,
      apiSetting: {},
      fromLang: "en",
      toLang: "zh",
    })
  ).resolves.toBeNull();
  await expect(write(1)).resolves.toBe(false);
});

test("resume metadata has a separate 80-tab LRU bound while preserving a recently refreshed reader", async () => {
  const nonces = [];
  for (let tabId = 0; tabId < 80; tabId++) {
    mockBrowser.tabs.getCurrent.mockResolvedValue({ id: tabId });
    at(readerUrl);
    const saved = await api.savePdfReadingState({
      documentId,
      sourceUrl: `https://example.test/paper-${tabId}.pdf`,
      pageNumber: 1,
    });
    nonces.push(saved.resumeNonce);
  }
  mockBrowser.tabs.getCurrent.mockResolvedValue({ id: 0 });
  at(`${readerUrl}#resume=${nonces[0]}`);
  await expect(api.loadPdfReadingState()).resolves.toMatchObject({
    sourceUrl: "https://example.test/paper-0.pdf",
  });
  mockBrowser.tabs.getCurrent.mockResolvedValue({ id: 80 });
  at(readerUrl);
  await api.savePdfReadingState({
    documentId,
    sourceUrl: "https://example.test/paper-80.pdf",
    pageNumber: 1,
  });
  expect(Object.keys(snapshot().readers)).toHaveLength(80);
  expect(snapshot().readers["tab:0"]).toBeDefined();
  expect(snapshot().readers["tab:1"]).toBeUndefined();
  expect(snapshot().readers["tab:80"]).toBeDefined();
});

test("preview storage restores only from sessionStorage and describes its different lifetime", async () => {
  mockIsExt = false;
  at("http://localhost:4318/pdf.html");
  await expect(write(1, "网页预览译文")).resolves.toBe(true);
  const fresh = loadModule();
  await expect(read(1, [paragraph], fresh)).resolves.toEqual({
    p1: "网页预览译文",
  });
  expect(Object.keys(records)).toHaveLength(0);
  expect(window.sessionStorage.length).toBe(1);
  expect(api.getPdfTranslationSessionInfo()).toMatchObject({
    mode: "preview-session",
    maxPages: 80,
    maxBytes: 8 * 1024 * 1024,
  });
  expect(api.getPdfTranslationSessionInfo().notice).toContain(
    "恢复会话可能保留"
  );
  window.sessionStorage.clear();
  await expect(read(1)).resolves.toEqual({});
});

test("clearing browser session data removes translations without relying on local storage", async () => {
  await write(1);
  records = {};
  await expect(read(1, [paragraph], loadModule())).resolves.toEqual({});
});

test("reading-state resume is bound to the reader tab and an explicit nonce, without auto-translation flags", async () => {
  const sourceUrl = "https://example.test/paper.pdf";
  const saved = await api.savePdfReadingState({
    documentId,
    sourceUrl,
    pageNumber: 3,
  });
  expect(saved.resumeNonce).toMatch(/^[a-f0-9]{64}$/);
  await expect(api.loadPdfReadingState()).resolves.toBeNull();
  at(`${readerUrl}#resume=${saved.resumeNonce}`);
  await expect(loadModule().loadPdfReadingState()).resolves.toEqual({
    documentId,
    sourceUrl,
    pageNumber: 3,
  });
  const next = await api.savePdfReadingState({
    documentId,
    sourceUrl,
    pageNumber: 4,
  });
  expect(next.resumeNonce).toBe(saved.resumeNonce);
  mockBrowser.tabs.getCurrent.mockResolvedValue({ id: 8 });
  await expect(api.loadPdfReadingState()).resolves.toBeNull();
  mockBrowser.tabs.getCurrent.mockResolvedValue({ id: 7 });
  at(`${readerUrl}#url=${encodeURIComponent(sourceUrl)}`);
  await expect(api.loadPdfReadingState()).resolves.toBeNull();
  at(`${readerUrl}#launch=${saved.resumeNonce}`);
  await expect(api.loadPdfReadingState()).resolves.toBeNull();
  expect(JSON.stringify(records)).not.toContain("autoPages");
});

test("another source creates a new resume nonce; local picker data and unsafe URLs cannot be saved", async () => {
  const first = await api.savePdfReadingState({
    documentId,
    sourceUrl: "file:///tmp/one.pdf",
    pageNumber: 1,
  });
  at(`${readerUrl}#resume=${first.resumeNonce}`);
  const next = await api.savePdfReadingState({
    documentId,
    sourceUrl: "file:///tmp/two.pdf",
    pageNumber: 1,
  });
  expect(next.resumeNonce).not.toBe(first.resumeNonce);
  await expect(api.loadPdfReadingState()).resolves.toBeNull();
  for (const sourceUrl of [
    "",
    "file://remote/share/private.pdf",
    "https://user:password@example.test/private.pdf",
    "blob:https://example.test/private-pdf",
  ])
    await expect(
      api.savePdfReadingState({ documentId, sourceUrl, pageNumber: 1 })
    ).resolves.toBeNull();
});

test("other extension pages and non-extension origins cannot read or write the extension session cache", async () => {
  await write(1);
  const originalWrites = mockBrowser.storage.session.set.mock.calls.length;
  for (const url of [
    "chrome-extension://test-extension/options.html",
    "https://test-extension/pdf.html",
    "chrome-extension://other-extension/pdf.html",
  ]) {
    at(url);
    await expect(read(1)).resolves.toEqual({});
    await expect(write(2)).resolves.toBe(false);
  }
  expect(mockBrowser.storage.session.set).toHaveBeenCalledTimes(originalWrites);
});
