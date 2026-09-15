/** @jest-environment jsdom */
// Local byte/stream fixtures only. No PDF engine, browser, file, or network is
// exercised. JSDOM supplies browser AbortController/DOMException globals.
// These cover the boundary before the UI can call openPdf().
import { policyFetch } from "./networkPolicy";
import { extractPdfParagraphs } from "./pdfText";
import { browser } from "./browser";
import {
  PDF_LIMITS,
  downloadPdf,
  readPdfFile,
  validatePdfBytes,
} from "./pdfDocument";

jest.mock("./networkPolicy", () => ({ policyFetch: jest.fn() }));
jest.mock("./pdfText", () => ({ extractPdfParagraphs: jest.fn() }));
jest.mock("./browser", () => ({
  browser: { extension: { isAllowedFileSchemeAccess: jest.fn() } },
}));
jest.mock("./client", () => ({ isExt: true }));

const client = jest.requireMock("./client");
const originalByteLimit = PDF_LIMITS.bytes;
const originalFetch = Object.getOwnPropertyDescriptor(global, "fetch");
const bytes = (str) => Uint8Array.from(Buffer.from(str, "utf8"));
const pdfBytes = bytes("%PDF-1.7\nsynthetic test fixture\n%%EOF");
const file = (data, size = data.byteLength) => ({
  size,
  arrayBuffer: jest.fn().mockResolvedValue(data.buffer),
});
const response = (chunks, { contentLength = null, status = 200 } = {}) => {
  const remaining = [...chunks];
  const reader = {
    read: jest.fn(async () =>
      remaining.length
        ? { value: remaining.shift(), done: false }
        : { done: true }
    ),
    cancel: jest.fn().mockResolvedValue(undefined),
  };
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: jest.fn().mockReturnValue(contentLength) },
    body: { getReader: jest.fn(() => reader) },
    reader,
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  // Exercise exactly the same bound checks without allocating 50 MB per case.
  PDF_LIMITS.bytes = 64;
  client.isExt = true;
  browser.extension.isAllowedFileSchemeAccess
    .mockReset()
    .mockResolvedValue(true);
  global.fetch = jest.fn();
});

afterEach(() => {
  PDF_LIMITS.bytes = originalByteLimit;
  if (originalFetch) Object.defineProperty(global, "fetch", originalFetch);
  else delete global.fetch;
  jest.useRealTimers();
});

test("the production input cap is 50 MiB", () => {
  expect(originalByteLimit).toBe(50 * 1024 * 1024);
});

test.each([null, { size: 0 }, { size: 65 }])(
  "missing, empty, or oversized local files are rejected before arrayBuffer: %j",
  async (candidate) => {
    const arrayBuffer = jest.fn();
    if (candidate) candidate.arrayBuffer = arrayBuffer;
    await expect(readPdfFile(candidate)).rejects.toThrow(/非空.*50 MB/);
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(policyFetch).not.toHaveBeenCalled();
    expect(extractPdfParagraphs).not.toHaveBeenCalled();
  }
);

test("accepts valid local bytes without fetching, parsing, or depending on the filename/MIME", async () => {
  const candidate = {
    ...file(pdfBytes),
    name: "paper.bin",
    type: "text/plain",
  };
  const result = await readPdfFile(candidate);
  expect(result).toEqual(pdfBytes);
  expect(result).toBeInstanceOf(Uint8Array);
  expect(candidate.arrayBuffer).toHaveBeenCalledTimes(1);
  expect(policyFetch).not.toHaveBeenCalled();
  expect(extractPdfParagraphs).not.toHaveBeenCalled();
});

test("a misleading PDF name/MIME cannot make an HTML login response pass validation", async () => {
  const candidate = {
    ...file(bytes("<html>Please sign in</html>")),
    name: "paper.pdf",
    type: "application/pdf",
  };
  await expect(readPdfFile(candidate)).rejects.toThrow(/不是 PDF/);
  expect(policyFetch).not.toHaveBeenCalled();
  expect(extractPdfParagraphs).not.toHaveBeenCalled();
});

test.each([new Uint8Array(0), new Uint8Array(65)])(
  "the actual file bytes are rechecked even when the declared file size was small",
  async (data) => {
    await expect(readPdfFile(file(data, 1))).rejects.toThrow(/非空.*50 MB/);
  }
);

test("an already cancelled local read never calls arrayBuffer", async () => {
  const controller = new AbortController();
  controller.abort();
  const candidate = file(pdfBytes);
  await expect(readPdfFile(candidate, controller.signal)).rejects.toMatchObject(
    { name: "AbortError" }
  );
  expect(candidate.arrayBuffer).not.toHaveBeenCalled();
});

test("cancellation while awaiting local bytes rejects before returning them", async () => {
  const controller = new AbortController();
  let resolve;
  const candidate = {
    size: pdfBytes.length,
    arrayBuffer: jest.fn(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    ),
  };
  const pending = readPdfFile(candidate, controller.signal);
  controller.abort();
  resolve(pdfBytes.buffer);
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(extractPdfParagraphs).not.toHaveBeenCalled();
});

test("byte validation respects typed-array offsets and accepts a short PDF prefix", () => {
  const parent = bytes("junk-before%PDF-1.7\n%%EOFjunk-after");
  const view = parent.subarray(11, parent.length - 10);
  expect(validatePdfBytes(view)).toBe(view);
  expect(validatePdfBytes(bytes("short-prefix\n%PDF-1.7\n%%EOF"))).toEqual(
    bytes("short-prefix\n%PDF-1.7\n%%EOF")
  );
  // The marker outside this view must not make its bytes pass validation.
  expect(() => validatePdfBytes(parent.subarray(0, 11))).toThrow(/不是 PDF/);
});

test("remote download delegates to policyFetch with explicit privacy options and a cancellable signal", async () => {
  const controller = new AbortController();
  const result = response([pdfBytes.subarray(0, 5), pdfBytes.subarray(5)]);
  let duringFetch;
  policyFetch.mockImplementation(async (url, init) => {
    duringFetch = init.signal.aborted;
    return result;
  });
  expect(
    await downloadPdf("  https://papers.example/paper.pdf  ", controller.signal)
  ).toEqual(pdfBytes);
  expect(policyFetch).toHaveBeenCalledTimes(1);
  expect(policyFetch).toHaveBeenCalledWith("https://papers.example/paper.pdf", {
    credentials: "omit",
    referrerPolicy: "no-referrer",
    cache: "no-store",
    signal: expect.any(AbortSignal),
  });
  const requestSignal = policyFetch.mock.calls[0][1].signal;
  expect(requestSignal).not.toBe(controller.signal);
  expect(duringFetch).toBe(false);
  expect(requestSignal.aborted).toBe(true); // finally closes the request.
  expect(controller.signal.aborted).toBe(false);
  expect(result.reader.cancel).toHaveBeenCalledTimes(1);
  expect(extractPdfParagraphs).not.toHaveBeenCalled();
});

test("network policy rejection is surfaced without a retry or alternate fetch", async () => {
  const blocked = new Error("当前离线网络策略禁止该地址");
  policyFetch.mockRejectedValue(blocked);
  await expect(downloadPdf("https://papers.example/paper.pdf")).rejects.toBe(
    blocked
  );
  expect(policyFetch).toHaveBeenCalledTimes(1);
});

test("Content-Length above the limit rejects before reading the body", async () => {
  const result = response([pdfBytes], { contentLength: "65" });
  policyFetch.mockResolvedValue(result);
  await expect(downloadPdf("https://papers.example/paper.pdf")).rejects.toThrow(
    /超过 50 MB/
  );
  expect(result.headers.get).toHaveBeenCalledWith("content-length");
  expect(result.body.getReader).not.toHaveBeenCalled();
  expect(result.reader.read).not.toHaveBeenCalled();
  expect(policyFetch.mock.calls[0][1].signal.aborted).toBe(true);
});

test.each([null, "1", "not-a-number"])(
  "stream byte totals enforce the cap despite missing/misleading Content-Length: %s",
  async (contentLength) => {
    const result = response(
      [pdfBytes, new Uint8Array(40), bytes("never read")],
      { contentLength }
    );
    policyFetch.mockResolvedValue(result);
    await expect(
      downloadPdf("https://papers.example/paper.pdf")
    ).rejects.toThrow(/超过 50 MB/);
    expect(result.reader.read).toHaveBeenCalledTimes(2);
    expect(result.reader.cancel).toHaveBeenCalledTimes(1);
    expect(extractPdfParagraphs).not.toHaveBeenCalled();
  }
);

test("exactly the byte cap is accepted without an off-by-one rejection", async () => {
  const exact = new Uint8Array(64);
  exact.set(pdfBytes);
  const result = response([exact], { contentLength: "64" });
  policyFetch.mockResolvedValue(result);
  expect(await downloadPdf("https://papers.example/paper.pdf")).toEqual(exact);
  expect(result.reader.cancel).toHaveBeenCalledTimes(1);
});

test.each([
  { chunks: [] },
  { chunks: [bytes("<html>Sign in</html>")] },
  { chunks: [bytes('{"error":"forbidden"}')] },
])(
  "empty or non-PDF downloads fail before reaching extraction: %j",
  async ({ chunks }) => {
    const result = response(chunks);
    policyFetch.mockResolvedValue(result);
    await expect(
      downloadPdf("https://papers.example/paper.pdf")
    ).rejects.toThrow(/非空|不是 PDF/);
    expect(result.reader.cancel).toHaveBeenCalledTimes(1);
    expect(extractPdfParagraphs).not.toHaveBeenCalled();
  }
);

test("HTTP failures are surfaced without consuming the response body", async () => {
  const result = response([pdfBytes], { status: 403 });
  policyFetch.mockResolvedValue(result);
  await expect(downloadPdf("https://papers.example/paper.pdf")).rejects.toThrow(
    /HTTP 403/
  );
  expect(result.body.getReader).not.toHaveBeenCalled();
});

test("a response without streaming support is rejected without an unbounded fallback", async () => {
  const result = response([pdfBytes]);
  result.body = null;
  result.arrayBuffer = jest.fn();
  policyFetch.mockResolvedValue(result);
  await expect(downloadPdf("https://papers.example/paper.pdf")).rejects.toThrow(
    /流式下载/
  );
  expect(result.arrayBuffer).not.toHaveBeenCalled();
});

test("an already aborted caller never enters the network policy layer or reads a stream", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = response([pdfBytes]);
  policyFetch.mockResolvedValue(result);
  await expect(
    downloadPdf("https://papers.example/paper.pdf", controller.signal)
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(policyFetch).not.toHaveBeenCalled();
  expect(result.reader.read).not.toHaveBeenCalled();
  expect(result.reader.cancel).not.toHaveBeenCalled();
});

test("cancellation during a stream read prevents every subsequent read", async () => {
  const controller = new AbortController();
  const result = response([bytes("should not be read")]);
  result.reader.read.mockImplementationOnce(async () => {
    controller.abort();
    return { value: pdfBytes, done: false };
  });
  policyFetch.mockResolvedValue(result);
  await expect(
    downloadPdf("https://papers.example/paper.pdf", controller.signal)
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(result.reader.read).toHaveBeenCalledTimes(1);
  expect(result.reader.cancel).toHaveBeenCalledTimes(1);
});

test("cancellation coinciding with the final done chunk cannot return a completed PDF", async () => {
  const controller = new AbortController();
  const result = response([]);
  result.reader.read
    .mockResolvedValueOnce({ value: pdfBytes, done: false })
    .mockImplementationOnce(async () => {
      controller.abort();
      return { done: true };
    });
  policyFetch.mockResolvedValue(result);
  await expect(
    downloadPdf("https://papers.example/paper.pdf", controller.signal)
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(result.reader.cancel).toHaveBeenCalledTimes(1);
});

test("a timeout aborts a pending stream, cancels its reader, and clears the timer", async () => {
  jest.useFakeTimers();
  const result = response([]);
  policyFetch.mockImplementation(async (url, init) => {
    result.reader.read.mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          init.signal.addEventListener(
            "abort",
            () => reject(new DOMException("test abort", "AbortError")),
            { once: true }
          );
        })
    );
    return result;
  });
  const pending = downloadPdf("https://papers.example/paper.pdf");
  const outcome = pending.catch((error) => error);
  await Promise.resolve();
  expect(result.reader.read).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(45000);
  const error = await outcome;
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toMatch(/下载超时/);
  expect(result.reader.cancel).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test("reader cancellation failures do not mask the original download failure", async () => {
  const result = response([bytes("not PDF")]);
  result.reader.cancel.mockRejectedValue(new Error("cancel failed"));
  policyFetch.mockResolvedValue(result);
  await expect(downloadPdf("https://papers.example/paper.pdf")).rejects.toThrow(
    /不是 PDF/
  );
});

test("the caller abort listener is removed after success", async () => {
  const controller = new AbortController();
  const add = jest.spyOn(controller.signal, "addEventListener");
  const remove = jest.spyOn(controller.signal, "removeEventListener");
  policyFetch.mockResolvedValue(response([pdfBytes]));
  await downloadPdf("https://papers.example/paper.pdf", controller.signal);
  const [, listener] = add.mock.calls.find(([event]) => event === "abort");
  expect(remove).toHaveBeenCalledWith("abort", listener);
});

test("an authorized local PDF uses a private file fetch and never enters the HTTP policy layer", async () => {
  const local = response([pdfBytes]);
  global.fetch.mockResolvedValue(local);
  expect(await downloadPdf("file:///papers/my%20paper.pdf")).toEqual(pdfBytes);
  expect(browser.extension.isAllowedFileSchemeAccess).toHaveBeenCalledTimes(1);
  expect(global.fetch).toHaveBeenCalledWith("file:///papers/my%20paper.pdf", {
    credentials: "omit",
    referrerPolicy: "no-referrer",
    cache: "no-store",
    redirect: "error",
    signal: expect.any(AbortSignal),
  });
  expect(local.reader.cancel).toHaveBeenCalledTimes(1);
  expect(policyFetch).not.toHaveBeenCalled();
});

test.each([false, "permission API failed"])(
  "file URL access requires an affirmative browser permission: %s",
  async (permission) => {
    if (permission === false)
      browser.extension.isAllowedFileSchemeAccess.mockResolvedValue(false);
    else
      browser.extension.isAllowedFileSchemeAccess.mockRejectedValue(
        new Error(permission)
      );
    await expect(downloadPdf("file:///papers/paper.pdf")).rejects.toThrow(
      /允许访问文件网址.*选择本地文件/
    );
    expect(global.fetch).not.toHaveBeenCalled();
    expect(policyFetch).not.toHaveBeenCalled();
  }
);

test("the web preview cannot fetch a local path even when a permission mock says yes", async () => {
  client.isExt = false;
  await expect(downloadPdf("file:///papers/paper.pdf")).rejects.toThrow(
    /允许访问文件网址/
  );
  expect(browser.extension.isAllowedFileSchemeAccess).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
  expect(policyFetch).not.toHaveBeenCalled();
});

test.each([
  "file://server/share/paper.pdf",
  "file:////server/share/paper.pdf",
  "file:///%2fserver/paper.pdf",
  "file:///papers/config.json",
  "file:///papers/paper.pdf?other=/private/config",
  "file://user:pass@host/paper.pdf",
])(
  "invalid/UNC/non-PDF local sources cannot reach permission checks or file fetch: %s",
  async (url) => {
    await expect(downloadPdf(url)).rejects.toThrow(
      /允许访问文件网址.*选择本地文件/
    );
    expect(browser.extension.isAllowedFileSchemeAccess).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(policyFetch).not.toHaveBeenCalled();
  }
);

test("cancellation while file access permission is pending rejects before fetching", async () => {
  browser.extension.isAllowedFileSchemeAccess.mockImplementation(
    () => new Promise(() => {})
  );
  const controller = new AbortController();
  const outcome = downloadPdf(
    "file:///papers/paper.pdf",
    controller.signal
  ).catch((error) => error);
  await Promise.resolve();
  controller.abort();
  expect(await outcome).toMatchObject({ name: "AbortError" });
  expect(global.fetch).not.toHaveBeenCalled();
  expect(policyFetch).not.toHaveBeenCalled();
});

test("local file fetch failure gives manual-file guidance without an HTTP fallback", async () => {
  global.fetch.mockRejectedValue(new TypeError("Failed to fetch"));
  await expect(downloadPdf("file:///papers/paper.pdf")).rejects.toThrow(
    /无法读取本地 PDF.*允许访问文件网址/
  );
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(policyFetch).not.toHaveBeenCalled();
});

test.each(["declared", "stream"])(
  "local files share the %s byte cap with remote downloads",
  async (mode) => {
    const local =
      mode === "declared"
        ? response([pdfBytes], { contentLength: "65" })
        : response([pdfBytes, new Uint8Array(40), bytes("must not be read")]);
    global.fetch.mockResolvedValue(local);
    await expect(downloadPdf("file:///papers/paper.pdf")).rejects.toThrow(
      /超过 50 MB/
    );
    expect(local.reader.read).toHaveBeenCalledTimes(
      mode === "declared" ? 0 : 2
    );
    expect(local.reader.cancel).toHaveBeenCalledTimes(
      mode === "declared" ? 0 : 1
    );
    expect(policyFetch).not.toHaveBeenCalled();
  }
);

test("a local .pdf path still requires PDF bytes", async () => {
  const local = response([bytes("<html>not PDF</html>")]);
  global.fetch.mockResolvedValue(local);
  await expect(downloadPdf("file:///papers/paper.pdf")).rejects.toThrow(
    /不是 PDF/
  );
  expect(local.reader.cancel).toHaveBeenCalledTimes(1);
  expect(policyFetch).not.toHaveBeenCalled();
});
