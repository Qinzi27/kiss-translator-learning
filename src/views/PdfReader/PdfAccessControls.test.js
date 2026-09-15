import { act } from "react";
import { createRoot } from "react-dom/client";
import PdfAccessControls from "./PdfAccessControls";
import {
  getPdfHandlingEnabled,
  returnToNativePdf,
  setPdfHandlingEnabled,
  supportsPdfMimeHandler,
} from "../../libs/pdfMimeHandler";

jest.mock("../../libs/pdfMimeHandler", () => ({
  getPdfHandlingEnabled: jest.fn(),
  hasActiveMimePdf: () => false,
  returnToNativePdf: jest.fn(),
  setPdfHandlingEnabled: jest.fn(),
  supportsPdfMimeHandler: jest.fn(),
}));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container;
let root;
beforeEach(() => {
  jest.clearAllMocks();
  supportsPdfMimeHandler.mockReturnValue(true);
  getPdfHandlingEnabled.mockResolvedValue(true);
  setPdfHandlingEnabled.mockReset().mockResolvedValue(undefined);
  returnToNativePdf.mockReset().mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("opening the controls only reads the persisted choice; opt-out needs a click", async () => {
  await act(async () => root.render(<PdfAccessControls />));
  const checkbox = container.querySelector('input[type="checkbox"]');
  expect(checkbox.checked).toBe(true);
  expect(setPdfHandlingEnabled).not.toHaveBeenCalled();
  expect(returnToNativePdf).not.toHaveBeenCalled();
  await act(async () => checkbox.click());
  expect(setPdfHandlingEnabled).toHaveBeenCalledWith(false);
  expect(checkbox.checked).toBe(false);
});

test("a rejected native setting keeps the previous choice and shows the failure", async () => {
  await act(async () => root.render(<PdfAccessControls />));
  setPdfHandlingEnabled.mockRejectedValueOnce(new Error("setting unavailable"));
  const checkbox = container.querySelector("input");
  await act(async () => checkbox.click());
  expect(checkbox.checked).toBe(true);
  expect(container.querySelector('[role="alert"]').textContent).toContain(
    "setting unavailable"
  );
});

test("the native return button calls fallback only on explicit click", async () => {
  await act(async () => root.render(<PdfAccessControls isMimeHandler />));
  const button = container.querySelector("button");
  expect(button.textContent).toBe("返回 Chrome 原生阅读器");
  expect(returnToNativePdf).not.toHaveBeenCalled();
  await act(async () => button.click());
  expect(returnToNativePdf).toHaveBeenCalledTimes(1);
});

test("older browsers get an actionable keyboard fallback, without a misleading toggle", async () => {
  supportsPdfMimeHandler.mockReturnValue(false);
  getPdfHandlingEnabled.mockResolvedValue(null);
  await act(async () => root.render(<PdfAccessControls />));
  expect(container.querySelector("input")).toBeNull();
  expect(container.textContent).toContain("Option + Q");
});
