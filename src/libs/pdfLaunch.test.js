import { browser } from "./browser";
import { consumePdfLaunch, getPdfSourceUrl, launchPdfInTab } from "./pdfLaunch";

let mockIsExt = true;
let mockIsGm = false;
jest.mock("./client", () => ({
  get isExt() {
    return mockIsExt;
  },
  get isGm() {
    return mockIsGm;
  },
}));
jest.mock("./browser", () => ({
  browser: {
    runtime: { getURL: jest.fn() },
    tabs: { update: jest.fn(), getCurrent: jest.fn() },
    storage: {
      session: { get: jest.fn(), set: jest.fn(), remove: jest.fn() },
      local: { set: jest.fn() },
      sync: { set: jest.fn() },
    },
  },
}));

const originalLocation = window.location;
const originalCrypto = globalThis.crypto;
const session = browser.storage.session;
const reader = "chrome-extension://test-extension/pdf.html";
const source = "https://arxiv.org/pdf/2402.17764v1";
let records;

function at(url) {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: new URL(url),
  });
}

beforeEach(() => {
  mockIsExt = true;
  mockIsGm = false;
  records = {};
  browser.storage.session = session;
  jest.clearAllMocks();
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: require("crypto").webcrypto,
  });
  jest.spyOn(Date, "now").mockReturnValue(1000000);
  browser.runtime.getURL.mockReturnValue(reader);
  browser.tabs.update.mockReset().mockResolvedValue({ id: 7 });
  browser.tabs.getCurrent.mockReset().mockResolvedValue({ id: 7 });
  session.set
    .mockReset()
    .mockImplementation(async (values) => Object.assign(records, values));
  session.get
    .mockReset()
    .mockImplementation(async (key) => ({ [key]: records[key] }));
  session.remove.mockReset().mockImplementation(async (key) => {
    delete records[key];
  });
  at(reader);
});

afterEach(() => {
  jest.restoreAllMocks();
  browser.storage.session = session;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: originalCrypto,
  });
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
});

test.each([
  [
    "HTTPS://EXAMPLE.COM/a/../paper.PDF?download=1#page=2",
    "https://example.com/paper.PDF?download=1#page=2",
  ],
  ["http://127.0.0.1:8765/paper.pdf", "http://127.0.0.1:8765/paper.pdf"],
  [source, source],
  [
    "https://www.arxiv.org/pdf/2402.17764v1",
    "https://www.arxiv.org/pdf/2402.17764v1",
  ],
  [
    "https://export.arxiv.org/pdf/2402.17764v1",
    "https://export.arxiv.org/pdf/2402.17764v1",
  ],
  [
    "file:///Users/reader/paper%20one.pdf#page=3",
    "file:///Users/reader/paper%20one.pdf#page=3",
  ],
  ["file:///C:/Papers/one.pdf", "file:///C:/Papers/one.pdf"],
])("normalizes supported PDF source %s", (input, expected) => {
  expect(getPdfSourceUrl(input)).toBe(expected);
});

test.each([
  "https://user:password@example.com/paper.pdf",
  "https://arxiv.org.evil.test/pdf/2402.17764v1",
  "https://arxiv.org/abs/2402.17764v1",
  "https://arxiv.org/pdf/",
  "https://example.com/download?id=paper.pdf",
  "https://example.com/pdf/1234",
  "file://server/share/paper.pdf",
  "file:////server/share/paper.pdf",
  "file:///%2fserver/share/paper.pdf",
  "file:///%5cserver/share/paper.pdf",
  "file:///tmp/paper.pdf?token=synthetic",
  "file:///tmp/article.html",
  "file://user:password@localhost/paper.pdf",
  "blob:https://example.com/id",
  "chrome-extension://viewer/https://example.com/paper.pdf",
  "javascript:alert(1)",
  "not a URL",
  undefined,
])("rejects unsupported or nonlocal source %s", (input) => {
  expect(getPdfSourceUrl(input)).toBe("");
});

async function prepare() {
  expect(await launchPdfInTab({ id: 7, url: source })).toBe(true);
  at(browser.tabs.update.mock.calls[0][1].url);
  return Object.values(records)[0];
}

test("launch uses the same tab and a random session grant without putting the source in the URL", async () => {
  const record = await prepare();
  expect(record).toEqual({
    sourceUrl: source,
    issuedAt: 1000000,
    nonce: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(browser.tabs.update).toHaveBeenCalledWith(7, {
    url: `${reader}#launch=${record.nonce}`,
  });
  expect(browser.storage.local.set).not.toHaveBeenCalled();
  expect(browser.storage.sync.set).not.toHaveBeenCalled();
  await launchPdfInTab({ id: 8, url: source });
  expect(Object.values(records)[1].nonce).not.toBe(record.nonce);
});

test("an unrecognized source is left in place", async () => {
  await expect(
    launchPdfInTab({ id: 7, url: "https://example.test/article" })
  ).resolves.toBe(false);
  expect(browser.tabs.update).not.toHaveBeenCalled();
  expect(session.set).not.toHaveBeenCalled();
});

test("successful consumption removes the grant before it can be reused", async () => {
  await prepare();
  await expect(consumePdfLaunch()).resolves.toEqual({ sourceUrl: source });
  expect(records).toEqual({});
  await expect(consumePdfLaunch()).resolves.toBeNull();
});

test("copying the launch URL into a different tab grants nothing", async () => {
  await prepare();
  browser.tabs.getCurrent.mockResolvedValue({ id: 8 });
  await expect(consumePdfLaunch()).resolves.toBeNull();
  expect(session.remove).not.toHaveBeenCalled();
  browser.tabs.getCurrent.mockResolvedValue({ id: 7 });
  await expect(consumePdfLaunch()).resolves.toEqual({ sourceUrl: source });
});

test.each([-1, 120000, 120001])(
  "rejects a future or expired grant (elapsed %s ms)",
  async (elapsed) => {
    await prepare();
    Date.now.mockReturnValue(1000000 + elapsed);
    await expect(consumePdfLaunch()).resolves.toBeNull();
  }
);

test.each([
  "https://test-extension/pdf.html",
  "chrome-extension://different-extension/pdf.html",
  "chrome-extension://test-extension/options.html",
])("a non-reader document cannot consume a launch: %s", async (url) => {
  const record = await prepare();
  at(`${url}#launch=${record.nonce}`);
  await expect(consumePdfLaunch()).resolves.toBeNull();
  expect(session.get).not.toHaveBeenCalled();
});

test("ordinary source-prefill URLs never authorize automatic sending", async () => {
  await prepare();
  at(`${reader}#url=${encodeURIComponent(source)}`);
  await expect(consumePdfLaunch()).resolves.toBeNull();
  expect(session.get).not.toHaveBeenCalled();
});

test("wrong nonces and unsafe stored sources fail closed", async () => {
  const record = await prepare();
  at(`${reader}#launch=${"0".repeat(64)}`);
  await expect(consumePdfLaunch()).resolves.toBeNull();
  at(`${reader}#launch=${record.nonce}`);
  record.sourceUrl = "file://remote-host/shared/paper.pdf";
  await expect(consumePdfLaunch()).resolves.toBeNull();
  expect(session.remove).not.toHaveBeenCalled();
});

test("failed navigation deletes the pending authorization", async () => {
  browser.tabs.update.mockRejectedValueOnce(new Error("tab closed"));
  await expect(launchPdfInTab({ id: 7, url: source })).rejects.toThrow(
    "无法在当前标签"
  );
  expect(session.remove).toHaveBeenCalledTimes(1);
  expect(records).toEqual({});
});

test("unsupported session storage falls back to prefill only", async () => {
  browser.storage.session = undefined;
  await expect(launchPdfInTab({ id: 7, url: source })).resolves.toBe(true);
  expect(browser.tabs.update).toHaveBeenCalledWith(7, {
    url: `${reader}#url=${encodeURIComponent(source)}`,
  });
  expect(session.set).not.toHaveBeenCalled();
  await expect(consumePdfLaunch()).resolves.toBeNull();
});

test("failure to remove session authorization does not authorize translation", async () => {
  await prepare();
  session.remove.mockRejectedValueOnce(new Error("storage failed"));
  await expect(consumePdfLaunch()).resolves.toBeNull();
});

test("simultaneous consumption attempts cannot both receive the same authorization", async () => {
  await prepare();
  let finishRead;
  session.get.mockImplementationOnce(
    (key) =>
      new Promise((resolve) => {
        finishRead = () => resolve({ [key]: records[key] });
      })
  );
  const first = consumePdfLaunch();
  await Promise.resolve();
  const second = consumePdfLaunch();
  const third = consumePdfLaunch();
  await expect(second).resolves.toBeNull();
  await expect(third).resolves.toBeNull();
  finishRead();
  await expect(first).resolves.toEqual({ sourceUrl: source });
  expect(session.remove).toHaveBeenCalledTimes(1);
});

test("web and userscript contexts cannot create or consume extension grants", async () => {
  mockIsExt = false;
  await expect(launchPdfInTab({ id: 7, url: source })).resolves.toBe(false);
  await expect(consumePdfLaunch()).resolves.toBeNull();
  mockIsExt = true;
  mockIsGm = true;
  await expect(launchPdfInTab({ id: 7, url: source })).resolves.toBe(false);
  await expect(consumePdfLaunch()).resolves.toBeNull();
  expect(session.set).not.toHaveBeenCalled();
});
