import { browser } from "../../libs/browser";
import { launchPdfInTab } from "../../libs/pdfLaunch";
import {
  getPdfPrefillUrl,
  openPdfReader,
  PDF_USERSCRIPT_HINT,
} from "./pdfEntry";

let mockIsExt = true;
let mockIsGm = false;
jest.mock("../../libs/pdfLaunch", () => ({
  ...jest.requireActual("../../libs/pdfLaunch"),
  launchPdfInTab: jest.fn(),
}));
jest.mock("../../libs/client", () => ({
  get isExt() {
    return mockIsExt;
  },
  get isGm() {
    return mockIsGm;
  },
}));
jest.mock("../../libs/browser", () => ({
  browser: {
    runtime: { getURL: jest.fn() },
    tabs: { create: jest.fn(), query: jest.fn() },
  },
}));

beforeEach(() => {
  mockIsExt = true;
  mockIsGm = false;
  jest.clearAllMocks();
  browser.runtime.getURL.mockReturnValue("chrome-extension://test/pdf.html");
  browser.tabs.create.mockResolvedValue({ id: 19 });
  browser.tabs.query.mockResolvedValue([]);
  launchPdfInTab.mockReset().mockResolvedValue(false);
});

test.each([
  "https://example.com/report.pdf?download=1#page=5",
  "http://localhost:8765/REPORT.PDF",
  "https://arxiv.org/pdf/2402.17764v1",
  "https://www.arxiv.org/pdf/2402.17764v1",
  "https://export.arxiv.org/pdf/2402.17764v1",
  "file:///tmp/report.pdf",
])("recognizes a PDF location without fetching it: %s", (url) => {
  expect(getPdfPrefillUrl(url)).toBe(url);
});

test.each([
  "https://example.com/article",
  "https://arxiv.org/abs/2402.17764v1",
  "https://arxiv.org/pdf/",
  "https://arxiv.org.evil.test/pdf/2402.17764v1",
  "https://example.com/pdf/2402.17764v1",
  "https://user:secret@example.com/report.pdf",
  "javascript:alert(1)",
  "chrome-extension://viewer/https://example.com/report.pdf",
  undefined,
])("does not prefill unrelated or unsafe locations: %s", (url) => {
  expect(getPdfPrefillUrl(url)).toBe("");
});

test("popup delegates the current PDF to the authorized same-tab launch", async () => {
  const source = "https://arxiv.org/pdf/2402.17764v1?download=1#page=2";
  const tab = { id: 7, url: source };
  browser.tabs.query.mockResolvedValue([tab]);
  launchPdfInTab.mockResolvedValueOnce(true);
  await openPdfReader({ prefillCurrentTab: true });
  expect(browser.tabs.query).toHaveBeenCalledWith({
    active: true,
    lastFocusedWindow: true,
  });
  expect(launchPdfInTab).toHaveBeenCalledWith(tab);
  expect(browser.tabs.create).not.toHaveBeenCalled();
});

test("an ordinary active page opens a separate empty reader", async () => {
  browser.tabs.query.mockResolvedValue([
    { id: 7, url: "https://example.com/article" },
  ]);
  await openPdfReader({ prefillCurrentTab: true });
  expect(browser.tabs.create).toHaveBeenCalledWith({
    url: "chrome-extension://test/pdf.html",
  });
});

test("a failed authorized launch reports the error instead of opening an unrelated empty reader", async () => {
  browser.tabs.query.mockResolvedValue([
    { id: 7, url: "https://example.com/paper.pdf" },
  ]);
  launchPdfInTab.mockRejectedValueOnce(new Error("当前标签已关闭"));
  await expect(openPdfReader({ prefillCurrentTab: true })).rejects.toThrow(
    "当前标签已关闭"
  );
  expect(browser.tabs.create).not.toHaveBeenCalled();
});

test("settings opens the empty reader without inspecting other tabs", async () => {
  await openPdfReader();
  expect(browser.tabs.query).not.toHaveBeenCalled();
  expect(launchPdfInTab).not.toHaveBeenCalled();
  expect(browser.tabs.create).toHaveBeenCalledWith({
    url: "chrome-extension://test/pdf.html",
  });
});

test("an inaccessible active tab still opens an empty reader", async () => {
  browser.tabs.query.mockRejectedValueOnce(new Error("restricted page"));
  await openPdfReader({ prefillCurrentTab: true });
  expect(browser.tabs.create).toHaveBeenCalledWith({
    url: "chrome-extension://test/pdf.html",
  });
});

test("web preview uses a same-origin reader with no opener", async () => {
  mockIsExt = false;
  const open = jest.spyOn(window, "open").mockImplementation(() => null);
  await openPdfReader({ prefillCurrentTab: true });
  expect(open).toHaveBeenCalledWith(
    `${window.location.origin}/pdf.html`,
    "_blank",
    "noopener,noreferrer"
  );
  expect(browser.tabs.create).not.toHaveBeenCalled();
  expect(browser.tabs.query).not.toHaveBeenCalled();
  open.mockRestore();
});

test("userscript fails with a clear compatibility hint and no new tab", async () => {
  mockIsGm = true;
  await expect(openPdfReader()).rejects.toThrow(PDF_USERSCRIPT_HINT);
  expect(browser.tabs.create).not.toHaveBeenCalled();
});
