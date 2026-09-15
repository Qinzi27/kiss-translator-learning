/** @jest-environment jsdom */
// Synthetic parser/worker streams only: no PDF engine, model, file, or network.
import { policyFetch } from "./networkPolicy";
import { extractPdfParagraphs } from "./pdfText";
import { loadPdfEngine } from "./pdfEngine";
import { openPdf, PDF_LIMITS } from "./pdfDocument";

jest.mock("./networkPolicy", () => ({ policyFetch: jest.fn() }));
jest.mock("./pdfText", () => ({ extractPdfParagraphs: jest.fn() }));
jest.mock("./pdfEngine", () => ({
  ...jest.requireActual("./pdfEngine"),
  loadPdfEngine: jest.fn(),
}));

const limits = { ...PDF_LIMITS };
const workerDescriptor = Object.getOwnPropertyDescriptor(global, "Worker");
const fixture = () =>
  Uint8Array.from(Buffer.from("%PDF-1.7\nsynthetic\n%%EOF"));
const never = () => new Promise(() => {});
const item = (str) => ({ str });
let base;

async function until(predicate) {
  for (let turn = 0; turn < 60; turn++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("Expected parser stage was not reached within microtasks");
}

function harness(chunksByPage = [[[item("synthetic paragraph")]]]) {
  const readers = chunksByPage.map((chunks) => {
    const remaining = [...chunks];
    return {
      read: jest.fn(async () =>
        remaining.length
          ? { done: false, value: { items: remaining.shift() } }
          : { done: true }
      ),
      cancel: jest.fn().mockResolvedValue(undefined),
    };
  });
  const pages = readers.map((reader) => ({
    view: [0, 0, 612, 792],
    streamTextContent: jest.fn(() => ({ getReader: () => reader })),
    getTextContent: jest.fn(),
    cleanup: jest.fn(),
  }));
  const pdf = {
    numPages: pages.length,
    getPage: jest.fn(async (number) => pages[number - 1]),
  };
  const task = {
    promise: Promise.resolve(pdf),
    destroy: jest.fn().mockResolvedValue(undefined),
  };
  const worker = { destroy: jest.fn() };
  const port = { terminate: jest.fn() };
  global.Worker = jest.fn(() => port);
  const engine = {
    PDFWorker: jest.fn(() => worker),
    getDocument: jest.fn(() => task),
  };
  loadPdfEngine.mockResolvedValue(engine);
  return { readers, pages, pdf, task, worker, port, engine };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  loadPdfEngine.mockReset();
  extractPdfParagraphs
    .mockReset()
    .mockImplementation((items) =>
      items.length
        ? [{ id: "p1", text: items.map(({ str }) => str || "").join("") }]
        : []
    );
  policyFetch.mockImplementation(() => {
    throw new Error("Local PDF parsing must not make policy requests");
  });
  base = document.createElement("base");
  base.href = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/pdf.html";
  document.head.appendChild(base);
});

afterEach(() => {
  Object.assign(PDF_LIMITS, limits);
  base.remove();
  if (workerDescriptor)
    Object.defineProperty(global, "Worker", workerDescriptor);
  else delete global.Worker;
  jest.clearAllTimers();
  jest.useRealTimers();
});

test("a successful local parse streams pages, releases readers, and exposes idempotent destruction", async () => {
  const state = harness([
    [[item("first ")], [item("page")]],
    [[item("second")]],
  ]);
  const onProgress = jest.fn();
  const controller = new AbortController();
  const remove = jest.spyOn(controller.signal, "removeEventListener");
  const result = await openPdf(fixture(), {
    signal: controller.signal,
    onProgress,
  });

  expect(result.pdf).toBe(state.pdf);
  expect(result.pages).toEqual([
    { number: 1, paragraphs: [{ id: "p1", text: "first page" }] },
    { number: 2, paragraphs: [{ id: "p1", text: "second" }] },
  ]);
  expect(onProgress.mock.calls).toEqual([
    [1, 2],
    [2, 2],
  ]);
  expect(extractPdfParagraphs).toHaveBeenCalledWith(
    [item("first "), item("page")],
    { pageWidth: 612 }
  );
  for (let index = 0; index < state.pages.length; index++) {
    expect(state.pages[index].getTextContent).not.toHaveBeenCalled();
    expect(state.pages[index].cleanup).toHaveBeenCalledTimes(1);
    expect(state.readers[index].cancel).toHaveBeenCalledTimes(1);
  }
  expect(policyFetch).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  controller.abort(); // A completed document is now owned by its caller.
  expect(state.port.terminate).not.toHaveBeenCalled();
  const destruction = result.destroy();
  expect(result.destroy()).toBe(destruction);
  expect(state.task.destroy).toHaveBeenCalledTimes(1);
  expect(state.port.terminate).not.toHaveBeenCalled();
  await destruction;
  expect(state.worker.destroy).toHaveBeenCalledTimes(1);
  expect(state.port.terminate).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test("normal document disposal leaves the worker alive until PDF.js has cleared its resources", async () => {
  const state = harness();
  const events = [];
  let acknowledge;
  state.task.destroy.mockImplementation(
    () =>
      new Promise((resolve) => {
        events.push("destroy requested");
        acknowledge = () => {
          events.push("fonts and filters cleared");
          resolve();
        };
      })
  );
  state.worker.destroy.mockImplementation(() => events.push("worker disposed"));
  state.port.terminate.mockImplementation(() => events.push("port terminated"));
  const result = await openPdf(fixture());
  const pending = result.destroy();
  expect(events).toEqual(["destroy requested"]);
  expect(jest.getTimerCount()).toBe(1);
  acknowledge();
  await pending;
  expect(events).toEqual([
    "destroy requested",
    "fonts and filters cleared",
    "worker disposed",
    "port terminated",
  ]);
  expect(jest.getTimerCount()).toBe(0);
});

test("a completed document with unresponsive cleanup is forcibly released after one second", async () => {
  const state = harness();
  let acknowledge;
  state.task.destroy.mockImplementation(
    () =>
      new Promise((resolve) => {
        acknowledge = resolve;
      })
  );
  const result = await openPdf(fixture());
  const pending = result.destroy();
  expect(result.destroy()).toBe(pending);
  jest.advanceTimersByTime(999);
  expect(state.port.terminate).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1);
  await pending;
  expect(state.worker.destroy).toHaveBeenCalledTimes(1);
  expect(state.port.terminate).toHaveBeenCalledTimes(1);
  expect(state.task.destroy).toHaveBeenCalledTimes(1);
  expect(state.port.onerror).toBeNull();
  expect(jest.getTimerCount()).toBe(0);
  // A late acknowledgement cannot dispose resources again or recreate timers.
  acknowledge();
  await Promise.resolve();
  expect(result.destroy()).toBe(pending);
  expect(state.port.terminate).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test.each(["synchronous", "asynchronous"])(
  "a %s library cleanup failure still releases the worker",
  async (mode) => {
    const state = harness();
    state.task.destroy.mockImplementation(() => {
      if (mode === "synchronous") throw new Error("cleanup failed");
      return Promise.reject(new Error("cleanup failed"));
    });
    const result = await openPdf(fixture());
    await result.destroy();
    expect(state.port.terminate).toHaveBeenCalledTimes(1);
    expect(state.worker.destroy).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  }
);

test("a worker wrapper cleanup exception cannot prevent native worker termination", async () => {
  const state = harness();
  state.worker.destroy.mockImplementation(() => {
    throw new Error("wrapper failed");
  });
  const result = await openPdf(fixture());
  await result.destroy();
  expect(state.port.terminate).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test("a worker startup failure promptly reports the error and terminates the parser", async () => {
  const state = harness();
  state.task.promise = never();
  const outcome = openPdf(fixture()).catch((error) => error);
  await until(() => typeof state.port.onerror === "function");
  state.port.onerror({ message: "worker unavailable" });
  expect((await outcome).message).toBe(
    "PDF 解析组件无法运行：worker unavailable"
  );
  expect(state.port.terminate).toHaveBeenCalledTimes(1);
  expect(state.worker.destroy).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test("the module worker and every parser asset use bundled extension URLs and real PDF.js safety options", async () => {
  const state = harness();
  const bytes = fixture();
  const result = await openPdf(bytes);
  const prefix = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/pdfjs/";
  expect(global.Worker).toHaveBeenCalledWith(`${prefix}pdf.worker.mjs`, {
    type: "module",
  });
  expect(state.engine.PDFWorker).toHaveBeenCalledWith({ port: state.port });
  expect(state.engine.getDocument).toHaveBeenCalledWith(
    expect.objectContaining({
      data: bytes,
      worker: state.worker,
      enableXfa: false,
      useWasm: false,
      useSystemFonts: false,
      isOffscreenCanvasSupported: false,
      cMapUrl: `${prefix}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${prefix}standard_fonts/`,
      wasmUrl: `${prefix}wasm/`,
      iccUrl: `${prefix}iccs/`,
      maxImageSize: 16000000,
    })
  );
  const options = state.engine.getDocument.mock.calls[0][0];
  expect(options).not.toHaveProperty("url");
  expect(options).not.toHaveProperty("isEvalSupported"); // Removed in PDF.js 6.
  expect(options).not.toHaveProperty("enableScripting"); // A viewer-only option.
  result.destroy();
});

test.each(["document", "page", "stream"])(
  "aborting an unresponsive %s stage rejects and terminates without a destroy acknowledgement",
  async (stage) => {
    const state = harness();
    state.task.destroy.mockImplementation(never);
    const controller = new AbortController();
    if (stage === "document") state.task.promise = never();
    if (stage === "page") state.pdf.getPage.mockImplementation(never);
    if (stage === "stream") {
      state.readers[0].read.mockImplementation(never);
      state.readers[0].cancel.mockImplementation(never);
    }
    let settled = false;
    const pending = openPdf(fixture(), { signal: controller.signal }).catch(
      (error) => {
        settled = true;
        return error;
      }
    );
    await until(() =>
      stage === "document"
        ? state.engine.getDocument.mock.calls.length > 0
        : stage === "page"
          ? state.pdf.getPage.mock.calls.length > 0
          : state.readers[0].read.mock.calls.length > 0
    );
    controller.abort();
    await until(() => settled);
    expect(await pending).toMatchObject({ name: "AbortError" });
    expect(state.task.destroy).toHaveBeenCalledTimes(1);
    expect(state.worker.destroy).toHaveBeenCalledTimes(1);
    expect(state.port.terminate).toHaveBeenCalledTimes(1);
    expect(extractPdfParagraphs).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    expect(state.readers[0].cancel).toHaveBeenCalledTimes(
      stage === "stream" ? 1 : 0
    );
  }
);

test("aborting while the engine import hangs rejects before creating a worker", async () => {
  harness();
  loadPdfEngine.mockImplementation(never);
  const controller = new AbortController();
  const outcome = openPdf(fixture(), { signal: controller.signal }).catch(
    (error) => error
  );
  controller.abort();
  expect(await outcome).toMatchObject({ name: "AbortError" });
  expect(global.Worker).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

test("an already aborted request never imports the engine or starts a worker", async () => {
  harness();
  const controller = new AbortController();
  controller.abort();
  await expect(
    openPdf(fixture(), { signal: controller.signal })
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(loadPdfEngine).not.toHaveBeenCalled();
  expect(global.Worker).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

test.each(["document", "page", "stream"])(
  "the 90-second deadline also releases an unresponsive %s stage",
  async (stage) => {
    const state = harness();
    state.task.destroy.mockImplementation(never);
    if (stage === "document") state.task.promise = never();
    if (stage === "page") state.pdf.getPage.mockImplementation(never);
    if (stage === "stream") state.readers[0].read.mockImplementation(never);
    let settled = false;
    const pending = openPdf(fixture()).catch((error) => {
      settled = true;
      return error;
    });
    await until(() =>
      stage === "document"
        ? state.engine.getDocument.mock.calls.length > 0
        : stage === "page"
          ? state.pdf.getPage.mock.calls.length > 0
          : state.readers[0].read.mock.calls.length > 0
    );
    jest.advanceTimersByTime(89999);
    await Promise.resolve();
    expect(settled).toBe(false);
    jest.advanceTimersByTime(1);
    await until(() => settled);
    expect((await pending).message).toMatch(/PDF 解析超时/);
    expect(state.port.terminate).toHaveBeenCalledTimes(1);
    expect(state.worker.destroy).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  }
);

test("too many pages are rejected before requesting any page content", async () => {
  const state = harness();
  state.pdf.numPages = limits.pages + 1;
  await expect(openPdf(fixture())).rejects.toThrow(/最多 200 页/);
  expect(state.pdf.getPage).not.toHaveBeenCalled();
  expect(extractPdfParagraphs).not.toHaveBeenCalled();
  expect(state.port.terminate).toHaveBeenCalledTimes(1);
});

test("a synchronous parser startup failure still releases its allocated worker", async () => {
  const state = harness();
  const failure = new Error("synthetic parser initialization failure");
  state.engine.getDocument.mockImplementation(() => {
    throw failure;
  });
  await expect(openPdf(fixture())).rejects.toBe(failure);
  expect(state.task.destroy).not.toHaveBeenCalled();
  expect(state.worker.destroy).toHaveBeenCalledTimes(1);
  expect(state.port.terminate).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test.each([
  [
    "page item",
    { pageItems: 2 },
    [[[item(""), item("")], [item("")], [item("never read")]]],
    0,
    2,
  ],
  [
    "document item",
    { pageItems: 3, items: 3 },
    [[[item(""), item("")]], [[item(""), item("")], [item("never read")]]],
    1,
    1,
  ],
  [
    "character",
    { chars: 5 },
    [[[item("abc")], [item("def")], [item("never read")]]],
    0,
    2,
  ],
  [
    "cross-page character",
    { chars: 5 },
    [[[item("abc")]], [[item("def")], [item("never read")]]],
    1,
    1,
  ],
])(
  "the %s limit cancels at the offending chunk before extracting that page",
  async (name, overrides, chunks, page, reads) => {
    Object.assign(PDF_LIMITS, overrides);
    const state = harness(chunks);
    await expect(openPdf(fixture())).rejects.toThrow(/文字量或页面复杂度过大/);
    expect(state.readers[page].read).toHaveBeenCalledTimes(reads);
    expect(state.readers[page].cancel).toHaveBeenCalledTimes(1);
    expect(extractPdfParagraphs).toHaveBeenCalledTimes(page);
    expect(state.task.destroy).toHaveBeenCalledTimes(1);
    expect(state.port.terminate).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  }
);

test("exact item and character limits remain valid across streamed chunks", async () => {
  Object.assign(PDF_LIMITS, { chars: 6, items: 3, pageItems: 3 });
  const state = harness([[[item("ab")], [item("cd"), item("ef")]]]);
  const result = await openPdf(fixture());
  expect(result.pages[0].paragraphs).toEqual([{ id: "p1", text: "abcdef" }]);
  expect(state.readers[0].read).toHaveBeenCalledTimes(3);
  result.destroy();
});

test("password errors are actionable, release the worker, and do not reveal parser details", async () => {
  const state = harness();
  state.task.promise = Promise.reject(
    Object.assign(new Error("private parser detail"), {
      name: "PasswordException",
    })
  );
  const failure = await openPdf(fixture()).catch((error) => error);
  expect(failure.message).toMatch(/需要密码.*有权访问.*解锁/);
  expect(failure.message).not.toContain("private parser detail");
  expect(state.pdf.getPage).not.toHaveBeenCalled();
  expect(state.task.destroy).toHaveBeenCalledTimes(1);
  expect(state.port.terminate).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test("stream cancellation rejection cannot replace the original complexity error", async () => {
  PDF_LIMITS.pageItems = 1;
  const state = harness([[[item(""), item("")]]]);
  state.readers[0].cancel.mockRejectedValue(new Error("reader cleanup failed"));
  await expect(openPdf(fixture())).rejects.toThrow(/文字量或页面复杂度过大/);
  expect(state.port.terminate).toHaveBeenCalledTimes(1);
});
