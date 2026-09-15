import { act } from "react";
import { createRoot } from "react-dom/client";
import FabAppearanceSetting from "./FabAppearanceSetting";
import { FAB_APPEARANCE_DEFAULTS } from "../../libs/fabAppearance";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container;
let root;
let fab;
const updateFab = jest.fn();
function render(extra = {}) {
  act(() => {
    root.render(
      <FabAppearanceSetting fab={fab} updateFab={updateFab} {...extra} />
    );
  });
}
function change(input, value) {
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    ).set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
beforeEach(() => {
  fab = {
    ...FAB_APPEARANCE_DEFAULTS,
    x: 8,
    y: 42,
    edge: "right",
    isHide: true,
    fabClickAction: 0,
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("shows three accessible non-interactive state previews without saving on entry", () => {
  render();
  expect(container.querySelectorAll('[role="img"]')).toHaveLength(3);
  expect(container.querySelectorAll('input[type="color"]')).toHaveLength(3);
  expect(container.querySelectorAll('input[type="text"]')).toHaveLength(3);
  expect(
    container.querySelector('[aria-label="翻译中按钮预览"]').style.color
  ).toBe("rgb(0, 0, 0)");
  expect(
    container.querySelector('[aria-label="空闲按钮预览"]').style.color
  ).toBe("rgb(255, 255, 255)");
  expect(container.textContent).toContain("自动保存");
  expect(updateFab).not.toHaveBeenCalled();
});

test("editing a valid hex color updates only that field and immediately previews it", () => {
  render();
  change(container.querySelector('[aria-label="空闲颜色色值"]'), "#aaccff");
  expect(updateFab).toHaveBeenCalledTimes(1);
  expect(updateFab).toHaveBeenCalledWith({ idleColor: "#AACCFF" });
  expect(
    container.querySelector('[aria-label="空闲按钮预览"]').style.backgroundColor
  ).toBe("rgb(170, 204, 255)");
});

test("native color picker saves a single safe field", () => {
  render();
  change(container.querySelector('[aria-label="完成颜色选择器"]'), "#ffbb22");
  expect(updateFab).toHaveBeenCalledWith({ doneColor: "#FFBB22" });
});

test("invalid drafts are identified without saving or inserting arbitrary CSS", () => {
  render();
  const input = container.querySelector('[aria-label="翻译中颜色色值"]');
  change(input, "url(https://example.test/)");
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(
    document.getElementById(input.getAttribute("aria-describedby")).textContent
  ).toContain("尚未保存");
  expect(updateFab).not.toHaveBeenCalled();
  expect(
    container.querySelector('[aria-label="翻译中按钮预览"]').style
      .backgroundColor
  ).toBe("rgb(249, 229, 166)");
  expect(container.innerHTML).not.toContain('style="url(');
});

test("saved malicious colors fall back safely and reset writes only the three color fields", () => {
  fab.idleColor = "#111111;position:fixed";
  render();
  expect(container.querySelector('[aria-label="空闲颜色色值"]').value).toBe(
    FAB_APPEARANCE_DEFAULTS.idleColor
  );
  act(() => container.querySelector("button").click());
  expect(updateFab).toHaveBeenCalledWith(FAB_APPEARANCE_DEFAULTS);
  expect(Object.keys(updateFab.mock.calls[0][0])).toHaveLength(3);
  expect(fab).toMatchObject({ x: 8, y: 42, isHide: true, fabClickAction: 0 });
});

test("loading prevents writes and storage failure is shown instead of a success message", () => {
  render({ disabled: true });
  for (const input of container.querySelectorAll("input"))
    expect(input.disabled).toBe(true);
  expect(container.querySelector("button").disabled).toBe(true);
  act(() => container.querySelector("button").click());
  expect(updateFab).not.toHaveBeenCalled();
  render({ isSaving: true });
  expect(container.querySelector('[role="status"]').textContent).toContain(
    "正在保存"
  );
  render({ saveError: "颜色未保存，请重试。" });
  expect(container.querySelector('[role="status"]').textContent).toBe(
    "颜色未保存，请重试。"
  );
});
