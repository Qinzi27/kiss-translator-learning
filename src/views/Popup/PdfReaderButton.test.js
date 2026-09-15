import { act } from "react";
import { createRoot } from "react-dom/client";
import PdfReaderButton from "./PdfReaderButton";
import { openPdfReader } from "./pdfEntry";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockIsGm = false;
jest.mock("../../libs/client", () => ({
  get isGm() {
    return mockIsGm;
  },
}));
jest.mock("./pdfEntry", () => ({
  openPdfReader: jest.fn(),
  PDF_USERSCRIPT_HINT: "油猴版本暂不支持，请使用扩展或网页预览。",
}));

let container;
let root;
beforeEach(() => {
  mockIsGm = false;
  openPdfReader.mockReset().mockResolvedValue({ id: 19 });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("requires an explicit click and forwards the popup prefill option", async () => {
  act(() => root.render(<PdfReaderButton prefillCurrentTab />));
  expect(container.querySelector("button").getAttribute("aria-label")).toBe(
    "翻译当前 PDF"
  );
  expect(container.textContent).toContain("当前标签打开，自动翻译当前页");
  expect(openPdfReader).not.toHaveBeenCalled();
  await act(async () => container.querySelector("button").click());
  expect(openPdfReader).toHaveBeenCalledTimes(1);
  expect(openPdfReader).toHaveBeenCalledWith({ prefillCurrentTab: true });
});

test("disables repeat opens while pending and closes mobile navigation only on success", async () => {
  let finish;
  openPdfReader.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const onOpened = jest.fn();
  act(() => root.render(<PdfReaderButton navigation onOpened={onOpened} />));
  const button = container.querySelector("button");
  expect(button.textContent).toBe("PDF 双语阅读");
  expect(container.textContent).not.toContain("自动翻译当前页");
  act(() => button.click());
  expect(button.disabled).toBe(true);
  expect(onOpened).not.toHaveBeenCalled();
  act(() => button.click());
  expect(openPdfReader).toHaveBeenCalledTimes(1);
  await act(async () => finish({ id: 19 }));
  expect(onOpened).toHaveBeenCalledTimes(1);
  expect(button.disabled).toBe(false);
});

test("failed opening leaves a visible error and allows retry", async () => {
  openPdfReader.mockRejectedValueOnce(new Error("浏览器拒绝创建标签"));
  const onOpened = jest.fn();
  act(() => root.render(<PdfReaderButton onOpened={onOpened} />));
  const button = container.querySelector("button");
  await act(async () => button.click());
  expect(container.querySelector('[role="alert"]').textContent).toBe(
    "浏览器拒绝创建标签"
  );
  expect(button.disabled).toBe(false);
  expect(onOpened).not.toHaveBeenCalled();
  await act(async () => button.click());
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

test("userscript entry stays disabled and explains available alternatives", () => {
  mockIsGm = true;
  act(() => root.render(<PdfReaderButton />));
  const button = container.querySelector("button");
  expect(button.disabled).toBe(true);
  expect(container.textContent).toContain("油猴版本暂不支持");
  act(() => button.click());
  expect(openPdfReader).not.toHaveBeenCalled();
});
