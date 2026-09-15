import { act } from "react";
import { createRoot } from "react-dom/client";
import PdfReader from "./index";
import { getRulesWithDefault, getSettingWithDefault } from "../../libs/storage";
import { downloadPdf, openPdf, readPdfFile } from "../../libs/pdfDocument";
import { apiTranslate } from "../../apis";
import { consumePdfLaunch } from "../../libs/pdfLaunch";
import { downloadMimePdf } from "../../libs/pdfMimeHandler";
import { useFab } from "../../hooks/Fab";
import {
  hashPdfDocument,
  createPdfTranslationContext,
  readPdfTranslationPage,
  writePdfTranslation,
  savePdfReadingState,
  loadPdfReadingState,
} from "../../libs/pdfTranslationSession";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../../libs/storage", () => ({
  getRulesWithDefault: jest.fn(),
  getSettingWithDefault: jest.fn(),
}));
jest.mock("../../libs/pdfDocument", () => ({
  downloadPdf: jest.fn(),
  openPdf: jest.fn(),
  readPdfFile: jest.fn(),
}));
jest.mock("../../apis", () => ({ apiTranslate: jest.fn() }));
jest.mock("../../hooks/Fab", () => ({ useFab: jest.fn() }));
jest.mock("../../libs/pdfLaunch", () => ({
  ...jest.requireActual("../../libs/pdfLaunch"),
  consumePdfLaunch: jest.fn(),
}));

jest.mock("../../libs/pdfMimeHandler", () => ({
  ...jest.requireActual("../../libs/pdfMimeHandler"),
  downloadMimePdf: jest.fn(),
}));
jest.mock("./PdfAccessControls", () => () => null);
jest.mock("../../libs/pdfTranslationSession", () => ({
  hashPdfDocument: jest.fn(),
  createPdfTranslationContext: jest.fn(),
  readPdfTranslationPage: jest.fn(),
  writePdfTranslation: jest.fn(),
  savePdfReadingState: jest.fn(),
  loadPdfReadingState: jest.fn(),
  getPdfTranslationSessionInfo: () => ({
    mode: "extension-session",
    maxPages: 80,
    maxBytes: 8 * 1024 * 1024,
    notice: "浏览器会话结束后清除。",
  }),
}));

function deferred() {
  let resolve;
  const promise = new Promise((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

function documentFixture(
  pageTexts = [["First paragraph.", "Second paragraph."]]
) {
  const render = jest.fn(() => ({
    promise: Promise.resolve(),
    cancel: jest.fn(),
  }));
  return {
    pages: pageTexts.map((texts, page) => ({
      number: page + 1,
      // Deliberately reuse the same paragraph ids between files to catch result leakage.
      paragraphs: texts.map((text, index) => ({ id: `p${index}`, text })),
    })),
    pdf: {
      getPage: jest.fn(async () => ({
        getViewport: ({ scale }) => ({
          width: 600 * scale,
          height: 800 * scale,
        }),
        render,
        cleanup: jest.fn(),
      })),
    },
    destroy: jest.fn(),
  };
}

let container;
let root;
let settings;
let documentData;
let canvasContext;
let sessionCache;
const bytes = new Uint8Array([37, 80, 68, 70, 45]);

beforeEach(() => {
  window.location.hash = "";
  jest.clearAllMocks();
  useFab.mockReturnValue({ fab: {} });
  consumePdfLaunch.mockReset().mockResolvedValue(null);
  sessionCache = new Map();
  hashPdfDocument.mockReset().mockResolvedValue("document-hash");
  createPdfTranslationContext
    .mockReset()
    .mockImplementation(async (args) => JSON.stringify(args));
  readPdfTranslationPage
    .mockReset()
    .mockImplementation(async ({ contextId, pageNumber, paragraphs }) =>
      Object.fromEntries(
        paragraphs.flatMap(({ id, text }) => {
          const value = sessionCache.get(
            JSON.stringify([contextId, pageNumber, id, text])
          );
          return value ? [[id, value]] : [];
        })
      )
    );
  writePdfTranslation
    .mockReset()
    .mockImplementation(
      async ({ contextId, pageNumber, paragraph, translation }) => {
        sessionCache.set(
          JSON.stringify([contextId, pageNumber, paragraph.id, paragraph.text]),
          translation
        );
        return true;
      }
    );
  savePdfReadingState.mockReset().mockResolvedValue(null);
  loadPdfReadingState.mockReset().mockResolvedValue(null);
  downloadMimePdf.mockReset().mockResolvedValue(bytes);
  settings = {
    networkPolicy: "offline",
    transApis: [
      {
        apiSlug: "local-a",
        apiName: "本机 A",
        apiType: "Custom",
        url: "http://127.0.0.1:8765/translate",
        useContext: true,
      },
      {
        apiSlug: "local-b",
        apiName: "本机 B",
        apiType: "Custom",
        url: "http://127.0.0.1:5000/translate",
      },
      {
        apiSlug: "disabled",
        apiName: "已停用",
        apiType: "Custom",
        isDisabled: true,
      },
    ],
    prompts: [],
    subtitleSetting: {},
  };
  getSettingWithDefault.mockReset().mockImplementation(async () => settings);
  getRulesWithDefault
    .mockReset()
    .mockResolvedValue([{ pattern: "*", apiSlug: "local-a" }]);
  documentData = documentFixture();
  readPdfFile.mockReset().mockResolvedValue(bytes);
  downloadPdf.mockReset().mockResolvedValue(bytes);
  openPdf.mockReset().mockImplementation(async () => documentData);
  apiTranslate
    .mockReset()
    .mockImplementation(async ({ text }) => ({ trText: `译文：${text}` }));
  canvasContext = jest
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue({});
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) act(() => root.unmount());
  container.remove();
  canvasContext.mockRestore();
  window.location.hash = "";
});

async function mountReader() {
  // React DOM's render has no Testing Library act wrapper.
  // eslint-disable-next-line testing-library/no-unnecessary-act
  await act(async () => {
    root.render(<PdfReader />);
    await Promise.resolve();
  });
}

function button(label) {
  const found = Array.from(container.querySelectorAll("button")).find(
    (item) => item.textContent.trim() === label
  );
  if (!found) throw new Error(`Missing reader button: ${label}`);
  return found;
}

async function click(label) {
  await act(async () => button(label).click());
}

async function chooseFile(name = "paper.pdf", translate = false) {
  const file = new File([bytes], name, { type: "application/pdf" });
  const input = container.querySelector(
    translate
      ? 'input[aria-label="选择 PDF 并翻译"]'
      : 'input[aria-label="打开本地 PDF"]'
  );
  expect(input.disabled).toBe(false);
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () =>
    input.dispatchEvent(new Event("change", { bubbles: true }))
  );
  return file;
}

async function changeSelect(label, value) {
  const select = container.querySelector(`select[aria-label="${label}"]`);
  expect(select.disabled).toBe(false);
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

test("a URL fragment only prefills the field and never downloads or translates on mount", async () => {
  const source = "https://arxiv.org/pdf/2402.17764v1?download=1#page=2";
  window.location.hash = `url=${encodeURIComponent(source)}&translate=1&auto=true`;
  await mountReader();

  expect(container.querySelector('input[aria-label="PDF 链接"]').value).toBe(
    source
  );
  expect(downloadPdf).not.toHaveBeenCalled();
  expect(readPdfFile).not.toHaveBeenCalled();
  expect(openPdf).not.toHaveBeenCalled();
  expect(apiTranslate).not.toHaveBeenCalled();
  expect(button("翻译本页").disabled).toBe(true);
});

test("opening a file parses locally and displays its text without invoking translation", async () => {
  await mountReader();
  const file = await chooseFile();

  expect(readPdfFile).toHaveBeenCalledWith(file, expect.any(AbortSignal));
  expect(openPdf).toHaveBeenCalledWith(
    bytes,
    expect.objectContaining({ signal: expect.any(AbortSignal) })
  );
  expect(downloadPdf).not.toHaveBeenCalled();
  expect(apiTranslate).not.toHaveBeenCalled();
  expect(container.textContent).toContain("paper.pdf");
  expect(container.querySelector(".pdf-source").textContent).toBe(
    "First paragraph."
  );
  expect(container.querySelector("canvas")).not.toBeNull();
  expect(button("翻译本页").disabled).toBe(false);
});

test("reading a prefilled remote link still requires a separate translation click", async () => {
  const source = "https://example.test/paper.pdf";
  window.location.hash = `url=${encodeURIComponent(source)}`;
  await mountReader();
  await click("读取链接");

  expect(downloadPdf).toHaveBeenCalledWith(source, expect.any(AbortSignal));
  expect(openPdf).toHaveBeenCalledTimes(1);
  expect(readPdfFile).not.toHaveBeenCalled();
  expect(apiTranslate).not.toHaveBeenCalled();
  expect(container.querySelector(".pdf-source").textContent).toBe(
    "First paragraph."
  );
});

test("an explicit page translation uses the selected language and only the bounded session cache", async () => {
  documentData = documentFixture([["Page one."], ["第二页正文。"]]);
  await mountReader();
  await chooseFile();
  await click("下一页");
  await changeSelect("原文语言", "zh-CN");
  await changeSelect("译文语言", "en");
  // Changes made in settings after the reader opened are used at the click boundary.
  settings = {
    ...settings,
    transApis: settings.transApis.map((api) =>
      api.apiSlug === "local-a"
        ? { ...api, url: "http://localhost:9000/translate" }
        : api
    ),
  };
  await click("翻译本页");

  expect(apiTranslate).toHaveBeenCalledTimes(1);
  expect(apiTranslate).toHaveBeenCalledWith(
    expect.objectContaining({
      text: "第二页正文。",
      fromLang: "zh-CN",
      toLang: "en",
      textFormat: "text",
      useCache: false,
      usePool: false,
      signal: expect.any(AbortSignal),
      apiSetting: expect.objectContaining({
        apiSlug: "local-a",
        url: "http://localhost:9000/translate",
        useContext: false,
      }),
    })
  );
  expect(container.querySelector(".pdf-translation p").textContent).toBe(
    "译文：第二页正文。"
  );
});

test("whole-document translation includes later pages and preserves page navigation", async () => {
  documentData = documentFixture([["Page one."], ["Page two."]]);
  await mountReader();
  await chooseFile();
  await click("一键翻译全文");

  expect(apiTranslate.mock.calls.map(([request]) => request.text)).toEqual([
    "Page one.",
    "Page two.",
  ]);
  expect(container.querySelector(".pdf-translation p").textContent).toBe(
    "译文：Page one."
  );
  await click("下一页");
  expect(container.querySelector(".pdf-translation p").textContent).toBe(
    "译文：Page two."
  );
});

test("HTML-like service output remains literal text, without creating active markup", async () => {
  const output =
    '<img src="https://invalid.test/synthetic" onerror="alert(1)"><script>alert(2)</script>译文';
  documentData = documentFixture([["Plain source."]]);
  apiTranslate.mockResolvedValue({ trText: output });
  await mountReader();
  await chooseFile();
  await click("翻译本页");

  const translated = container.querySelector(".pdf-translation");
  expect(translated.querySelector("p").textContent).toBe(output);
  expect(translated.querySelector("img,script,iframe")).toBeNull();
});

test("stopping keeps completed translations and ignores a delayed response without sending the next paragraph", async () => {
  const pending = deferred();
  documentData = documentFixture([["First.", "Second.", "Third.", "Fourth."]]);
  apiTranslate
    .mockResolvedValueOnce({ trText: "第一段已完成" })
    .mockReturnValueOnce(pending.promise)
    .mockReturnValueOnce(pending.promise);
  await mountReader();
  await chooseFile();
  await click("一键翻译全文");
  expect(apiTranslate).toHaveBeenCalledTimes(3);
  const signal = apiTranslate.mock.calls[1][0].signal;
  await click("停止");
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve({ trText: "迟到的第二段" }));

  expect(apiTranslate).toHaveBeenCalledTimes(3);
  expect(container.querySelector(".pdf-translation p").textContent).toBe(
    "第一段已完成"
  );
  expect(container.textContent).not.toContain("迟到的第二段");
  expect(
    container.querySelectorAll(".pdf-translation-placeholder")
  ).toHaveLength(3);
  expect(button("翻译本页").disabled).toBe(false);
});

test("switching services keeps previous results until the next explicit translation", async () => {
  documentData = documentFixture([["Source."]]);
  apiTranslate
    .mockResolvedValueOnce({ trText: "A 的译文" })
    .mockResolvedValueOnce({ trText: "B 的译文" });
  await mountReader();
  await chooseFile();
  await click("翻译本页");
  await changeSelect("翻译服务", "local-b");

  expect(apiTranslate).toHaveBeenCalledTimes(1);
  expect(container.querySelector(".pdf-translation").textContent).toContain(
    "A 的译文"
  );
  expect(container.querySelector(".pdf-translation").textContent).toContain(
    "本机 A"
  );
  expect(container.querySelector(".pdf-translation").textContent).toContain(
    "上次译文"
  );
  await click("翻译本页");
  expect(apiTranslate.mock.calls[1][0].apiSetting.apiSlug).toBe("local-b");
  expect(container.querySelector(".pdf-translation").textContent).toContain(
    "B 的译文"
  );
  expect(container.querySelector(".pdf-translation").textContent).not.toContain(
    "A 的译文"
  );
});

test("a new file clears old results and late replies cannot contaminate its reused paragraph ids", async () => {
  const pendingOld = deferred();
  const pendingNew = deferred();
  const oldDocument = documentFixture([["Old first.", "Old second."]]);
  const newDocument = documentFixture([["New source."]]);
  documentData = oldDocument;
  apiTranslate
    .mockResolvedValueOnce({ trText: "旧文件已完成译文" })
    .mockReturnValueOnce(pendingOld.promise)
    .mockReturnValueOnce(pendingNew.promise);
  await mountReader();
  await chooseFile("old.pdf");
  await click("翻译本页");
  await click("停止");
  documentData = newDocument;
  await chooseFile("new.pdf");

  expect(oldDocument.destroy).toHaveBeenCalledTimes(1);
  expect(container.querySelector(".pdf-source").textContent).toBe(
    "New source."
  );
  expect(container.querySelector(".pdf-translation")).toBeNull();
  await click("翻译本页");
  await act(async () => pendingOld.resolve({ trText: "旧文件迟到译文" }));
  expect(container.querySelector(".pdf-translation")).toBeNull();
  expect(button("翻译本页").disabled).toBe(true);
  await act(async () => pendingNew.resolve({ trText: "新文件译文" }));
  expect(container.querySelector(".pdf-translation p").textContent).toBe(
    "新文件译文"
  );
  expect(container.textContent).not.toContain("旧文件");
  expect(apiTranslate).toHaveBeenCalledTimes(3);
});

test("closing the reader aborts pending translation and releases the parsed document", async () => {
  const pending = deferred();
  apiTranslate.mockReturnValueOnce(pending.promise);
  await mountReader();
  await chooseFile();
  await click("翻译本页");
  const signal = apiTranslate.mock.calls[0][0].signal;
  act(() => root.unmount());
  root = null;
  expect(signal.aborted).toBe(true);
  expect(documentData.destroy).toHaveBeenCalledTimes(1);
  await act(async () =>
    pending.resolve({ trText: "Late reply after closing" })
  );
  expect(apiTranslate).toHaveBeenCalledTimes(2);
});

test("a trusted quick launch reads once and translates its requested page plus the forward buffer", async () => {
  documentData = documentFixture([
    ["Page one."],
    ["Page two."],
    ["Page three."],
  ]);
  const source = "https://example.test/paper.pdf#page=2";
  consumePdfLaunch.mockResolvedValueOnce({ sourceUrl: source });
  await mountReader();
  expect(downloadPdf).toHaveBeenCalledTimes(1);
  expect(downloadPdf).toHaveBeenCalledWith(source, expect.any(AbortSignal));
  expect(apiTranslate).toHaveBeenCalledTimes(2);
  expect(apiTranslate.mock.calls.map(([request]) => request.text)).toEqual([
    "Page two.",
    "Page three.",
  ]);
  expect(container.querySelector('select[aria-label="页码"]').value).toBe("2");
  expect(container.querySelector('input[type="checkbox"]').checked).toBe(true);
  expect(container.querySelector("details").open).toBe(false);
  expect(container.querySelector(".pdf-return").href).toBe(source);
});

test("quick reading waits for the saved service before sending its first paragraph", async () => {
  const pending = deferred();
  getSettingWithDefault.mockImplementationOnce(() => pending.promise);
  consumePdfLaunch.mockResolvedValueOnce({
    sourceUrl: "https://example.test/paper.pdf",
  });
  await mountReader();
  expect(openPdf).toHaveBeenCalledTimes(1);
  expect(apiTranslate).not.toHaveBeenCalled();
  await act(async () => pending.resolve(settings));
  expect(apiTranslate).toHaveBeenCalledTimes(2);
  expect(apiTranslate.mock.calls[0][0].apiSetting.apiSlug).toBe("local-a");
});

test("turning pages translates on demand and revisiting completed pages sends no duplicate request", async () => {
  documentData = documentFixture([["Page one."], ["Page two."]]);
  consumePdfLaunch.mockResolvedValueOnce({
    sourceUrl: "https://example.test/paper.pdf",
  });
  await mountReader();
  expect(apiTranslate).toHaveBeenCalledTimes(2);
  await click("下一页");
  expect(apiTranslate).toHaveBeenCalledTimes(2);
  expect(container.querySelector(".pdf-translation p").textContent).toBe(
    "译文：Page two."
  );
  await click("上一页");
  expect(apiTranslate).toHaveBeenCalledTimes(2);
  expect(container.querySelector(".pdf-translation p").textContent).toBe(
    "译文：Page one."
  );
  await changeSelect("翻译服务", "local-b");
  expect(apiTranslate).toHaveBeenCalledTimes(2);
  expect(container.querySelector(".pdf-translation").textContent).toContain(
    "上次译文"
  );
  await click("翻译本页");
  expect(apiTranslate.mock.calls[2][0].apiSetting.apiSlug).toBe("local-b");
});

test("turning into the forward buffer reuses its request and keeps a late old-page result on its own page", async () => {
  const pending = deferred();
  documentData = documentFixture([["Page one."], ["Page two."]]);
  consumePdfLaunch.mockResolvedValueOnce({
    sourceUrl: "https://example.test/paper.pdf",
  });
  apiTranslate.mockReturnValueOnce(pending.promise);
  await mountReader();
  const signal = apiTranslate.mock.calls[0][0].signal;
  await click("下一页");
  expect(signal.aborted).toBe(false);
  expect(apiTranslate).toHaveBeenCalledTimes(2);
  expect(container.querySelector(".pdf-translation p").textContent).toBe(
    "译文：Page two."
  );
  await act(async () => pending.resolve({ trText: "迟到的旧页" }));
  expect(container.textContent).not.toContain("迟到的旧页");
  expect(container.querySelector(".pdf-translation p").textContent).toBe(
    "译文：Page two."
  );
});

test("stop also turns off automatic translation for subsequent pages", async () => {
  const pending = deferred();
  documentData = documentFixture([["Page one."], ["Page two."]]);
  consumePdfLaunch.mockResolvedValueOnce({
    sourceUrl: "https://example.test/paper.pdf",
  });
  apiTranslate.mockReturnValue(pending.promise);
  await mountReader();
  await click("停止");
  expect(container.querySelector('input[type="checkbox"]').checked).toBe(false);
  await click("下一页");
  await act(async () => pending.resolve({ trText: "Cancelled" }));
  expect(apiTranslate).toHaveBeenCalledTimes(2);
  expect(container.querySelector(".pdf-translation")).toBeNull();
});

test("opening another file drops quick-reading authorization and does not automatically translate it", async () => {
  consumePdfLaunch.mockResolvedValueOnce({
    sourceUrl: "file:///tmp/first.pdf",
  });
  await mountReader();
  expect(apiTranslate).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain("本地 PDF");
  documentData = documentFixture([["Different private document."]]);
  await chooseFile("private.pdf");
  expect(apiTranslate).toHaveBeenCalledTimes(2);
  expect(container.querySelector('input[type="checkbox"]').checked).toBe(false);
  expect(container.querySelector(".pdf-translation")).toBeNull();
});

test("a failed service stops automatic page translation without falling back to another provider", async () => {
  documentData = documentFixture([["Page one."], ["Page two."]]);
  consumePdfLaunch.mockResolvedValueOnce({
    sourceUrl: "https://example.test/paper.pdf",
  });
  apiTranslate.mockRejectedValueOnce(new Error("network policy blocked"));
  await mountReader();
  expect(container.querySelector('input[type="checkbox"]').checked).toBe(false);
  expect(container.querySelector('[role="alert"]').textContent).toContain(
    "network policy blocked"
  );
  await click("下一页");
  expect(apiTranslate).toHaveBeenCalledTimes(2);
});

test("a stale launch arriving after the user opens a file cannot replace or upload that file", async () => {
  const pending = deferred();
  consumePdfLaunch.mockReturnValueOnce(pending.promise);
  await mountReader();
  await chooseFile("mine.pdf");
  await act(async () =>
    pending.resolve({ sourceUrl: "https://example.test/old.pdf" })
  );
  expect(downloadPdf).not.toHaveBeenCalled();
  expect(apiTranslate).not.toHaveBeenCalled();
  expect(container.textContent).toContain("mine.pdf");
});

test("choose PDF and translate is a permission-free one-step file action using the selected service", async () => {
  documentData = documentFixture([["Handbook first page."], ["Next page."]]);
  await mountReader();
  await changeSelect("翻译服务", "local-b");
  const file = await chooseFile("handbook.pdf", true);
  expect(readPdfFile).toHaveBeenCalledWith(file, expect.any(AbortSignal));
  expect(downloadPdf).not.toHaveBeenCalled();
  expect(apiTranslate).toHaveBeenCalledTimes(2);
  expect(apiTranslate.mock.calls[0][0]).toEqual(
    expect.objectContaining({
      text: "Handbook first page.",
      fromLang: "en",
      toLang: "zh-CN",
      apiSetting: expect.objectContaining({ apiSlug: "local-b" }),
    })
  );
  expect(container.textContent).toContain("handbook.pdf");
  expect(container.querySelector('input[type="checkbox"]').checked).toBe(true);
  await click("下一页");
  expect(apiTranslate).toHaveBeenCalledTimes(2);
  expect(apiTranslate.mock.calls[1][0].text).toBe("Next page.");
});

test("cancelling the translate file chooser does not read or send anything", async () => {
  await mountReader();
  const input = container.querySelector('input[aria-label="选择 PDF 并翻译"]');
  Object.defineProperty(input, "files", { configurable: true, value: [] });
  await act(async () =>
    input.dispatchEvent(new Event("change", { bubbles: true }))
  );
  expect(readPdfFile).not.toHaveBeenCalled();
  expect(openPdf).not.toHaveBeenCalled();
  expect(apiTranslate).not.toHaveBeenCalled();
});

test("the explicit chooser recovers from missing file-URL access without changing permissions", async () => {
  consumePdfLaunch.mockResolvedValueOnce({
    sourceUrl: "file:///tmp/handbook.pdf",
  });
  downloadPdf.mockRejectedValueOnce(
    new Error("请在扩展详情允许访问文件网址，或选择本地文件。")
  );
  documentData = documentFixture([["Handbook content."]]);
  await mountReader();
  expect(apiTranslate).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]').textContent).toContain(
    "允许访问文件网址"
  );
  await chooseFile("handbook.pdf", true);
  expect(downloadPdf).toHaveBeenCalledTimes(1);
  expect(readPdfFile).toHaveBeenCalledTimes(1);
  expect(apiTranslate).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.querySelector(".pdf-translation p").textContent).toBe(
    "译文：Handbook content."
  );
});

async function remountReader() {
  act(() => root.unmount());
  root = createRoot(container);
  await mountReader();
}

test("page translation buffers only the next two pages and turning advances the window without duplicates", async () => {
  documentData = documentFixture(
    Array.from({ length: 5 }, (_, i) => [`Page ${i + 1}.`])
  );
  await mountReader();
  await chooseFile();
  expect(apiTranslate).not.toHaveBeenCalled();
  await click("翻译本页");
  expect(apiTranslate.mock.calls.map(([r]) => r.text)).toEqual([
    "Page 1.",
    "Page 2.",
    "Page 3.",
  ]);
  await click("下一页");
  expect(apiTranslate.mock.calls.map(([r]) => r.text)).toEqual([
    "Page 1.",
    "Page 2.",
    "Page 3.",
    "Page 4.",
  ]);
  expect(container.querySelector(".pdf-translation p").textContent).toBe(
    "译文：Page 2."
  );
});

test("reselecting the same local file after refresh restores translations but not automatic uploads", async () => {
  documentData = documentFixture([["One."], ["Two."], ["Three."], ["Four."]]);
  await mountReader();
  await chooseFile();
  await click("翻译本页");
  expect(apiTranslate).toHaveBeenCalledTimes(3);
  expect(writePdfTranslation).toHaveBeenCalledTimes(3);
  await remountReader();
  expect(container.querySelector(".pdf-translation")).toBeNull();
  expect(container.textContent).toContain("需重新选择同一文件");
  await chooseFile();
  expect(apiTranslate).toHaveBeenCalledTimes(3);
  expect(container.querySelector(".pdf-translation p").textContent).toBe(
    "译文：One."
  );
  expect(container.querySelector('input[type="checkbox"]').checked).toBe(false);
  await changeSelect("页码", "4");
  expect(apiTranslate).toHaveBeenCalledTimes(3);
  expect(container.querySelector(".pdf-translation")).toBeNull();
});

test("refreshing an authorized source restores its page and cached text in read-only mode", async () => {
  documentData = documentFixture([["One."], ["Two."], ["Three."]]);
  const sourceUrl = "https://example.test/paper.pdf";
  savePdfReadingState.mockResolvedValue({ resumeNonce: "fresh-nonce" });
  consumePdfLaunch.mockResolvedValueOnce({ sourceUrl, quick: true });
  await mountReader();
  await click("下一页");
  expect(window.location.hash).toBe("#resume=fresh-nonce");
  expect(savePdfReadingState).toHaveBeenLastCalledWith({
    documentId: "document-hash",
    sourceUrl,
    pageNumber: 2,
  });
  loadPdfReadingState.mockResolvedValueOnce({
    documentId: "document-hash",
    sourceUrl,
    pageNumber: 2,
  });
  const requestCount = apiTranslate.mock.calls.length;
  await remountReader();
  expect(downloadPdf).toHaveBeenCalledTimes(2);
  expect(container.querySelector('select[aria-label="页码"]').value).toBe("2");
  expect(container.querySelector(".pdf-translation p").textContent).toBe(
    "译文：Two."
  );
  expect(apiTranslate).toHaveBeenCalledTimes(requestCount);
  expect(container.querySelector('input[type="checkbox"]').checked).toBe(false);
});

test.each([
  [
    "Key",
    (s) => ({
      ...s,
      transApis: s.transApis.map((a) => ({
        ...a,
        key: "synthetic-different-key",
      })),
    }),
  ],
  [
    "URL",
    (s) => ({
      ...s,
      transApis: s.transApis.map((a) => ({
        ...a,
        url: "http://127.0.0.1:9999/translate",
      })),
    }),
  ],
  [
    "model",
    (s) => ({
      ...s,
      transApis: s.transApis.map((a) => ({ ...a, model: "synthetic-model" })),
    }),
  ],
  [
    "prompt",
    (s) => ({
      ...s,
      transApis: s.transApis.map((a) => ({
        ...a,
        nobatchPrompt: "A different synthetic prompt",
        nobatchUserPrompt: "Translate the supplied data",
      })),
    }),
  ],
  ["network policy", (s) => ({ ...s, networkPolicy: "standard" })],
])(
  "changing the same provider's %s isolates its cache and keeps old text until replacement",
  async (_, change) => {
    documentData = documentFixture([["Source."]]);
    apiTranslate
      .mockResolvedValueOnce({ trText: "旧译文" })
      .mockResolvedValueOnce({ trText: "新译文" });
    await mountReader();
    await chooseFile();
    await click("翻译本页");
    settings = change(settings);
    await click("刷新服务设置");
    expect(container.querySelector(".pdf-translation").textContent).toContain(
      "旧译文"
    );
    expect(container.querySelector(".pdf-translation").textContent).toContain(
      "上次译文"
    );
    expect(apiTranslate).toHaveBeenCalledTimes(1);
    await click("翻译本页");
    expect(apiTranslate).toHaveBeenCalledTimes(2);
    expect(container.querySelector(".pdf-translation p").textContent).toBe(
      "新译文"
    );
  }
);

test("changing direction never reuses a cached translation for the opposite direction", async () => {
  documentData = documentFixture([["Source 中文。"]]);
  await mountReader();
  await chooseFile();
  await click("翻译本页");
  await changeSelect("原文语言", "zh-CN");
  await changeSelect("译文语言", "en");
  await click("翻译本页");
  expect(apiTranslate).toHaveBeenCalledTimes(2);
  expect(apiTranslate.mock.calls[1][0]).toEqual(
    expect.objectContaining({ fromLang: "zh-CN", toLang: "en" })
  );
});

test("stopped concurrent requests cannot write late translations into session cache", async () => {
  const pending = deferred();
  documentData = documentFixture([["One."], ["Two."], ["Three."]]);
  apiTranslate.mockReturnValue(pending.promise);
  await mountReader();
  await chooseFile();
  await click("翻译本页");
  expect(apiTranslate).toHaveBeenCalledTimes(2);
  await click("停止");
  await act(async () => pending.resolve({ trText: "Cancelled late result" }));
  expect(writePdfTranslation).not.toHaveBeenCalled();
  expect(container.querySelector(".pdf-translation")).toBeNull();
  expect(apiTranslate).toHaveBeenCalledTimes(2);
});

test("native MIME opening reads only its browser stream and remains read-only without changing the URL", async () => {
  const mimeStream = {};
  window.location.hash = "page=2";
  documentData = documentFixture([["One."], ["Two."], ["Three."]]);
  consumePdfLaunch.mockResolvedValueOnce({
    sourceUrl: "https://example.test/download?id=1#page=3",
    mimeStream,
    quick: false,
  });
  await mountReader();
  expect(downloadMimePdf).toHaveBeenCalledWith(
    mimeStream,
    expect.any(AbortSignal)
  );
  expect(downloadPdf).not.toHaveBeenCalled();
  expect(apiTranslate).not.toHaveBeenCalled();
  expect(savePdfReadingState).not.toHaveBeenCalled();
  expect(window.location.hash).toBe("#page=2");
  expect(container.querySelector('select[aria-label="页码"]').value).toBe("3");
  expect(container.querySelector(".pdf-source").textContent).toBe("Three.");
  expect(container.querySelector(".pdf-return")).toBeNull();
});

test("a failed metadata save for a new document cannot leave the previous source's resume nonce", async () => {
  savePdfReadingState
    .mockResolvedValueOnce({ resumeNonce: "previous" })
    .mockResolvedValue(null);
  consumePdfLaunch.mockResolvedValueOnce({
    sourceUrl: "https://example.test/previous.pdf",
    quick: false,
  });
  await mountReader();
  expect(window.location.hash).toBe("#resume=previous");
  documentData = documentFixture([["Different file."]]);
  await chooseFile("new.pdf");
  expect(window.location.hash).toBe("");
});

test("an old metadata save resolving after a new local file does not resurrect the old resume URL", async () => {
  const pending = deferred();
  savePdfReadingState.mockReturnValueOnce(pending.promise);
  consumePdfLaunch.mockResolvedValueOnce({
    sourceUrl: "https://example.test/old.pdf",
    quick: false,
  });
  await mountReader();
  await chooseFile("mine.pdf");
  await act(async () => pending.resolve({ resumeNonce: "obsolete" }));
  expect(window.location.hash).toBe("");
  expect(container.textContent).toContain("mine.pdf");
});

test("the floating button translates and stops from the reading area", async () => {
  await mountReader();
  expect(container.querySelector(".pdf-floating-translate")).toBeNull();
  await chooseFile();
  const floating = container.querySelector(".pdf-floating-translate");
  expect(floating.textContent).toBe("译");
  expect(floating.style.backgroundColor).toBe("rgb(20, 108, 95)");
  expect(floating.getAttribute("aria-busy")).toBe("false");
  const pending = deferred();
  apiTranslate.mockReturnValue(pending.promise);
  await act(async () =>
    container.querySelector('[aria-label="浮动翻译本页"]').click()
  );
  expect(apiTranslate).toHaveBeenCalledTimes(2);
  expect(floating.disabled).toBe(false);
  expect(floating.getAttribute("aria-busy")).toBe("true");
  expect(floating.style.backgroundColor).toBe("rgb(249, 229, 166)");
  expect(floating.style.color).toBe("rgb(0, 0, 0)");
  expect(
    floating.querySelector(".pdf-floating-translate__ring")
  ).not.toBeNull();
  expect(
    floating.querySelector(".pdf-floating-translate__stop")
  ).not.toBeNull();
  expect(floating.title).toContain("点击停止");
  await act(async () =>
    container.querySelector('[aria-label="浮动停止翻译"]').click()
  );
  expect(apiTranslate.mock.calls[0][0].signal.aborted).toBe(true);
  expect(container.querySelector('[aria-label="浮动翻译本页"]').disabled).toBe(
    false
  );
  expect(floating.getAttribute("aria-busy")).toBe("false");
  expect(floating.textContent).toBe("译");
  expect(floating.querySelector(".pdf-floating-translate__ring")).toBeNull();
  await act(async () => pending.resolve({ trText: "Ignored" }));
  expect(container.querySelector(".pdf-translation")).toBeNull();
});

test("PDF floating completion reflects actual current-service results, even with automatic next-page translation enabled", async () => {
  await mountReader();
  await chooseFile();
  await click("翻译本页");
  const floating = container.querySelector(".pdf-floating-translate");
  expect(floating.textContent).toBe("✓");
  expect(floating.style.backgroundColor).toBe("rgb(37, 77, 50)");
  expect(floating.getAttribute("aria-busy")).toBe("false");
  expect(floating.disabled).toBe(false);
  expect(floating.title).toContain("本页译文已就绪");
  await changeSelect("翻译服务", "local-b");
  expect(floating.textContent).toBe("译");
  expect(floating.title).not.toContain("本页译文已就绪");
  expect(container.querySelectorAll(".pdf-translation")).toHaveLength(2);
});

test("PDF floating button reflects live color preferences and readable error state", async () => {
  await mountReader();
  await chooseFile();
  useFab.mockReturnValue({
    fab: { idleColor: "#FFFFFF", busyColor: "#000000", doneColor: "#AABBCC" },
  });
  await act(async () => {
    root.render(<PdfReader />);
  });
  const floating = container.querySelector(".pdf-floating-translate");
  expect(floating.style.backgroundColor).toBe("rgb(255, 255, 255)");
  expect(floating.style.color).toBe("rgb(0, 0, 0)");
  apiTranslate.mockRejectedValue(new Error("合成测试服务错误"));
  await click("翻译本页");
  expect(floating.textContent).toBe("!");
  expect(floating.title).toContain("遇到错误");
  expect(floating.getAttribute("aria-busy")).toBe("false");
  expect(floating.disabled).toBe(false);
});

test("PDF floating button is disabled only during file loading while showing a busy pattern", async () => {
  await mountReader();
  await chooseFile();
  const pending = deferred();
  openPdf.mockReturnValueOnce(pending.promise);
  await chooseFile("next.pdf");
  const floating = container.querySelector(".pdf-floating-translate");
  expect(floating.disabled).toBe(true);
  expect(floating.getAttribute("aria-busy")).toBe("true");
  expect(floating.title).toContain("正在读取 PDF");
  expect(
    floating.querySelector(".pdf-floating-translate__ring")
  ).not.toBeNull();
  expect(floating.querySelector(".pdf-floating-translate__stop")).toBeNull();
  await act(async () => pending.resolve(documentFixture([["New file."]])));
  expect(floating.disabled).toBe(false);
  expect(floating.textContent).toBe("译");
});

test("stopping while settings are being loaded prevents any queued translation", async () => {
  await mountReader();
  await chooseFile();
  const pending = deferred();
  getSettingWithDefault.mockReturnValueOnce(pending.promise);
  await click("翻译本页");
  await click("停止");
  await act(async () => pending.resolve(settings));
  expect(apiTranslate).not.toHaveBeenCalled();
  expect(writePdfTranslation).not.toHaveBeenCalled();
});

test("a cache restore for an old provider cannot overwrite the selected provider's display", async () => {
  const pending = deferred();
  readPdfTranslationPage.mockReturnValueOnce(pending.promise);
  await mountReader();
  await chooseFile();
  await changeSelect("翻译服务", "local-b");
  await click("翻译本页");
  await act(async () => pending.resolve({ p0: "Obsolete cached provider" }));
  expect(container.textContent).not.toContain("Obsolete cached provider");
  expect(container.querySelector(".pdf-translation").textContent).toContain(
    "本机 B"
  );
});

test("an oversized replacement is rejected before live state or session cache and keeps the old translation", async () => {
  documentData = documentFixture([["Source."]]);
  apiTranslate
    .mockResolvedValueOnce({ trText: "保留的旧译文" })
    .mockResolvedValueOnce({ trText: "x".repeat(16001) });
  await mountReader();
  await chooseFile();
  await click("翻译本页");
  await changeSelect("翻译服务", "local-b");
  await click("翻译本页");
  expect(container.querySelector(".pdf-translation p").textContent).toBe(
    "保留的旧译文"
  );
  expect(writePdfTranslation).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[role="alert"]').textContent).toContain(
    "16000"
  );
});

test("an oversized old session entry is treated as a cache miss and can be replaced", async () => {
  documentData = documentFixture([["Source."]]);
  readPdfTranslationPage.mockResolvedValue({ p0: "x".repeat(16001) });
  await mountReader();
  await chooseFile();
  expect(container.querySelector(".pdf-translation")).toBeNull();
  await click("翻译本页");
  expect(apiTranslate).toHaveBeenCalledTimes(1);
  expect(container.querySelector(".pdf-translation p").textContent).toBe(
    "译文：Source."
  );
  expect(writePdfTranslation).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
