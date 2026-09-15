import {
  downloadMimePdf,
  getMimePdfLaunch,
  getMimePdfSourceUrl,
  getPdfHandlingEnabled,
  returnToNativePdf,
  setPdfHandlingEnabled,
  supportsPdfMimeHandler,
} from "./pdfMimeHandler";

let mockIsExt = true;
jest.mock("./client", () => ({
  get isExt() {
    return mockIsExt;
  },
  isGm: false,
}));
const originalChrome = globalThis.chrome;
const originalFetch = globalThis.fetch;
const streamUrl =
  "chrome-extension://example-id/00000000-0000-4000-a000-000000000001";
const originalUrl = "file:///Users/reader/paper.pdf#page=3";
const bytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]);
let api;
let reader;
let response;
beforeEach(() => {
  mockIsExt = true;
  api = {
    getStreamInfo: jest.fn().mockResolvedValue({
      mimeType: "application/pdf",
      embedded: false,
      originalUrl,
      streamUrl,
    }),
    getMimeHandlerOptions: jest.fn().mockResolvedValue({ enabled: true }),
    setMimeHandlerOptions: jest.fn().mockResolvedValue(undefined),
    abortAndFallbackToNativeHandler: jest.fn().mockResolvedValue(undefined),
  };
  globalThis.chrome = { runtime: { id: "example-id" }, mimeHandler: api };
  reader = {
    read: jest
      .fn()
      .mockResolvedValueOnce({ value: bytes, done: false })
      .mockResolvedValue({ done: true }),
    cancel: jest.fn().mockResolvedValue(undefined),
  };
  response = {
    ok: true,
    headers: { get: jest.fn().mockReturnValue(null) },
    body: { getReader: () => reader },
  };
  globalThis.fetch = jest.fn().mockResolvedValue(response);
});
afterEach(() => {
  globalThis.chrome = originalChrome;
  globalThis.fetch = originalFetch;
  jest.useRealTimers();
});

test("browser-created PDF opens read-only and reads its already-received stream once", async () => {
  const launch = await getMimePdfLaunch();
  expect(launch).toMatchObject({ sourceUrl: originalUrl, quick: false });
  expect(globalThis.fetch).not.toHaveBeenCalled();
  await expect(downloadMimePdf(launch.mimeStream)).resolves.toEqual(bytes);
  expect(globalThis.fetch).toHaveBeenCalledWith(
    streamUrl,
    expect.objectContaining({
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      cache: "no-store",
    })
  );
  expect(globalThis.fetch).not.toHaveBeenCalledWith(
    originalUrl,
    expect.anything()
  );
  await expect(downloadMimePdf(launch.mimeStream)).rejects.toThrow(
    "已使用或无效"
  );
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
});

test("the plain URL cannot create a stream capability", async () => {
  await expect(downloadMimePdf({ streamUrl })).rejects.toThrow("无效");
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

test("MIME-confirmed download URLs retain their page fragment without a .pdf suffix", async () => {
  const originalUrl = "https://example.test/download?id=1#page=3";
  api.getStreamInfo.mockResolvedValue({
    mimeType: "application/pdf",
    originalUrl,
    streamUrl,
  });
  await expect(getMimePdfLaunch()).resolves.toMatchObject({
    sourceUrl: originalUrl,
    quick: false,
  });
  expect(
    getMimePdfSourceUrl("blob:https://example.test/synthetic-id#page=2")
  ).toBe("blob:https://example.test/synthetic-id#page=2");
  for (const value of [
    "javascript:alert(1)",
    "data:text/html,test",
    "https://user:pass@example.test/document",
    "file://server/share/document",
  ])
    expect(getMimePdfSourceUrl(value)).toBe("");
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

test.each([
  "https://example.com/paper.pdf",
  "file:///tmp/paper.pdf",
  "chrome-extension://other-id/00000000-0000-4000-a000-000000000001",
  `${streamUrl}?q=1`,
  `${streamUrl}#fragment`,
  "chrome-extension://example-id/pdf.html",
])(
  "rejects a stream outside the native extension capability space: %s",
  async (url) => {
    api.getStreamInfo.mockResolvedValue({
      mimeType: "application/pdf",
      originalUrl,
      streamUrl: url,
    });
    await expect(getMimePdfLaunch()).rejects.toThrow();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  }
);

test("ordinary extension pages and older browsers keep the manual reader flow", async () => {
  api.getStreamInfo.mockRejectedValue(new Error("No stream"));
  await expect(getMimePdfLaunch()).resolves.toBeNull();
  globalThis.chrome = undefined;
  expect(supportsPdfMimeHandler()).toBe(false);
  await expect(getMimePdfLaunch()).resolves.toBeNull();
  await expect(getPdfHandlingEnabled()).resolves.toBeNull();
});

test("web preview cannot use a page-supplied fake Chrome API", async () => {
  mockIsExt = false;
  await expect(getMimePdfLaunch()).resolves.toBeNull();
  expect(api.getStreamInfo).not.toHaveBeenCalled();
});

test.each([
  { mimeType: "text/html" },
  { mimeType: "application/pdf", embedded: true },
])("does not take over unsupported or embedded documents", async (info) => {
  api.getStreamInfo.mockResolvedValue({ ...info, originalUrl, streamUrl });
  await expect(getMimePdfLaunch()).resolves.toBeNull();
});

test("oversized advertised PDF is rejected before reading", async () => {
  response.headers.get.mockReturnValue(50 * 1024 * 1024 + 1);
  const launch = await getMimePdfLaunch();
  await expect(downloadMimePdf(launch.mimeStream)).rejects.toThrow("50 MB");
  expect(reader.read).not.toHaveBeenCalled();
});

test("a lying/missing size header does not bypass the streamed byte cap", async () => {
  reader.read.mockReset().mockResolvedValue({
    value: new Uint8Array(26 * 1024 * 1024),
    done: false,
  });
  const launch = await getMimePdfLaunch();
  await expect(downloadMimePdf(launch.mimeStream)).rejects.toThrow("50 MB");
  expect(reader.read).toHaveBeenCalledTimes(2);
  expect(reader.cancel).toHaveBeenCalled();
});

test("HTML cannot reach the PDF parser", async () => {
  reader.read
    .mockReset()
    .mockResolvedValueOnce({
      value: new Uint8Array([60, 104, 116, 109, 108]),
      done: false,
    })
    .mockResolvedValue({ done: true });
  const launch = await getMimePdfLaunch();
  await expect(downloadMimePdf(launch.mimeStream)).rejects.toThrow("不是 PDF");
});

test("Stop aborts a stalled stream without waiting for cancellation", async () => {
  reader.read.mockReset().mockImplementation(() => new Promise(() => {}));
  reader.cancel.mockImplementation(() => new Promise(() => {}));
  const launch = await getMimePdfLaunch();
  const controller = new AbortController();
  const pending = downloadMimePdf(launch.mimeStream, controller.signal);
  await Promise.resolve();
  await Promise.resolve();
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});

test("a stalled response has a 45-second deadline", async () => {
  jest.useFakeTimers();
  globalThis.fetch.mockImplementation(() => new Promise(() => {}));
  const launch = await getMimePdfLaunch();
  const pending = downloadMimePdf(launch.mimeStream);
  const check = expect(pending).rejects.toThrow("超时");
  jest.advanceTimersByTime(45000);
  await check;
});

test("native opt-out and fallback use the official API without re-requesting the source", async () => {
  await getMimePdfLaunch();
  await expect(getPdfHandlingEnabled()).resolves.toBe(true);
  await setPdfHandlingEnabled(false);
  expect(api.setMimeHandlerOptions).toHaveBeenCalledWith("application/pdf", {
    enabled: false,
  });
  await returnToNativePdf();
  expect(api.abortAndFallbackToNativeHandler).toHaveBeenCalledTimes(1);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
