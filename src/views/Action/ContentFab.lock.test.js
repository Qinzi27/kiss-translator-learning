/* eslint-disable testing-library/no-container, testing-library/no-unnecessary-act */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ContentFabContent } from "./ContentFab";
import { MSG_TRANS_LOCK_SET, MSG_TRANS_TOGGLE } from "../../config";
import * as trustedInteraction from "../../libs/trustedInteraction";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../../hooks/Setting", () => ({
  SettingProvider: ({ children }) => children,
}));
jest.mock("../../hooks/M3Theme", () => ({
  __esModule: true,
  default: ({ children }) => children,
}));
jest.mock("../../hooks/I18n", () => ({ useI18n: () => (key) => key }));
jest.mock("../../hooks/WindowSize", () => ({
  __esModule: true,
  default: () => ({ w: 800, h: 600 }),
}));
jest.mock("../../hooks/useFullscreenDetect", () => ({
  useFullscreenDetect: () => ({ isVideoFullscreen: false }),
}));
jest.mock("../../libs/client", () => ({ isExt: true }));
jest.mock("../../libs/msg", () => ({ sendBgMsg: jest.fn() }));
jest.mock("../../libs/mobile", () => ({ isMobile: false }));
jest.mock("../../libs/storage", () => ({ putFab: jest.fn() }));
jest.mock("../../components/TouchTranslateControl", () => () => null);

// Keep the actual Draggable: its parent pointer handlers must not lose the
// child's long press or let the release click toggle the current page.
describe.each(["document", "shadow root"])("FAB lock in %s", (context) => {
  let host;
  let container;
  let root;
  let processActions;
  let trustedEvent;

  beforeEach(() => {
    jest.useFakeTimers();
    window.PointerEvent = MouseEvent;
    trustedEvent = jest
      .spyOn(trustedInteraction, "isTrustedUserEvent")
      .mockReturnValue(true);
    jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 100,
      left: 0,
      top: 100,
      right: 56,
      bottom: 156,
      width: 56,
      height: 56,
      toJSON: () => ({}),
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    container = document.createElement("div");
    (context === "shadow root"
      ? host.attachShadow({ mode: "open" })
      : host
    ).appendChild(container);
    root = createRoot(container);
    processActions = jest.fn();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function render(config = {}, configStore) {
    act(() =>
      root.render(
        <ContentFabContent
          fabConfig={{ x: 0, y: 100, edge: "left", ...config }}
          configStore={configStore}
          processActions={processActions}
        />
      )
    );
    fab().setPointerCapture = jest.fn();
  }

  const fab = () => container.querySelector(".kt-content-fab");
  const menu = () => container.querySelector(".kt-content-fab-menu");
  const advance = (ms) => act(() => jest.advanceTimersByTime(ms));
  const click = (target = fab()) => act(() => target.click());
  function pointer(type, options = {}, target = fab()) {
    const { pointerId = 1, isPrimary = true, ...mouseOptions } = options;
    const event = new MouseEvent(type, {
      bubbles: true,
      composed: true,
      cancelable: true,
      button: 0,
      clientX: 24,
      clientY: 124,
      ...mouseOptions,
    });
    Object.defineProperties(event, {
      pointerId: { value: pointerId },
      isPrimary: { value: isPrimary },
    });
    act(() => target.dispatchEvent(event));
    return event;
  }
  function key(keyValue, options = {}) {
    const event = new KeyboardEvent("keydown", {
      key: keyValue,
      bubbles: true,
      composed: true,
      cancelable: true,
      ...options,
    });
    act(() => fab().dispatchEvent(event));
    return event;
  }

  test("a trusted 650 ms press locks once and consumes only its release click", () => {
    expect(MSG_TRANS_LOCK_SET).toEqual(expect.any(String));
    render();
    pointer("pointerdown");
    advance(649);
    expect(processActions).not.toHaveBeenCalled();
    advance(1);
    expect(processActions).toHaveBeenCalledTimes(1);
    expect(processActions).toHaveBeenCalledWith({
      action: MSG_TRANS_LOCK_SET,
      args: { enabled: true },
    });
    advance(1300);
    pointer("pointerup");
    click();
    expect(processActions).toHaveBeenCalledTimes(1);
    expect(menu()).toBeNull();

    pointer("pointerdown");
    advance(50);
    pointer("pointerup");
    click();
    expect(processActions).toHaveBeenCalledTimes(2);
    expect(processActions).toHaveBeenLastCalledWith({
      action: MSG_TRANS_TOGGLE,
    });
  });

  test("locked appearance follows saved state and ordinary clicks still toggle this page", () => {
    let snapshot = { fabClickAction: 1, translationLocked: false };
    let notify;
    const configStore = {
      subscribe: (listener) => {
        notify = listener;
        return () => {};
      },
      getSnapshot: () => snapshot,
    };
    render({}, configStore);
    expect(container.querySelector(".kt-content-fab-lock")).toBeNull();
    act(() => {
      snapshot = { ...snapshot, translationLocked: true };
      notify();
    });
    expect(container.querySelector(".kt-content-fab-lock")).not.toBeNull();
    expect(fab().title).toContain("持续翻译已锁定");
    expect(fab().getAttribute("aria-label")).toContain("新网页自动翻译");
    expect(fab().disabled).toBe(false);
    click();
    expect(processActions).toHaveBeenLastCalledWith({
      action: MSG_TRANS_TOGGLE,
    });
    pointer("pointerdown");
    advance(650);
    expect(processActions).toHaveBeenLastCalledWith({
      action: MSG_TRANS_LOCK_SET,
      args: { enabled: false },
    });
  });

  test("save failure is announced without showing a successful lock", () => {
    render({
      translationLocked: false,
      translationLockError: "锁定设置未保存，请重试",
    });
    expect(container.querySelector(".kt-content-fab-lock")).toBeNull();
    expect(fab().title).toContain("锁定设置未保存，请重试");
    expect(container.querySelector('[role="status"]').textContent).toContain(
      "锁定设置未保存，请重试"
    );
  });

  test.each([
    "pointerup",
    "pointercancel",
    "lostpointercapture",
    "blur",
    "unmount",
  ])("%s cancels an unfinished long press", (reason) => {
    render();
    pointer("pointerdown");
    advance(400);
    if (reason === "unmount") act(() => root.render(null));
    else if (reason === "blur")
      act(() => window.dispatchEvent(new Event("blur")));
    else pointer(reason);
    advance(1000);
    expect(processActions).not.toHaveBeenCalled();
  });

  test("a drag cancels the long press and its final click", () => {
    render();
    pointer("pointerdown");
    advance(300);
    pointer("pointermove", { clientX: 60 });
    advance(1000);
    pointer("pointerup", { clientX: 60 });
    click();
    expect(processActions).not.toHaveBeenCalled();
  });

  test("movement outside the handle and release outside also cancel the hold", () => {
    render();
    pointer("pointerdown");
    pointer("pointermove", { clientY: 150 }, document.body);
    advance(1000);
    expect(processActions).not.toHaveBeenCalled();
    pointer("pointerdown");
    pointer("pointerup", {}, document.body);
    advance(1000);
    expect(processActions).not.toHaveBeenCalled();
  });

  test.each([{ button: 2 }, { isPrimary: false }])(
    "non-primary input %j does not lock",
    (options) => {
      render();
      pointer("pointerdown", options);
      advance(1000);
      expect(processActions).not.toHaveBeenCalled();
    }
  );

  test("actual synthetic pointer and keyboard events cannot open the lock control or lock", () => {
    trustedEvent.mockRestore();
    render();
    expect(pointer("pointerdown").isTrusted).toBe(false);
    advance(1000);
    key("ArrowDown");
    expect(menu()).toBeNull();
    expect(processActions).not.toHaveBeenCalled();
  });

  test.each([false, true])(
    "keyboard menu can change lock=%s in direct-click mode",
    (locked) => {
      render({ translationLocked: locked });
      expect(key("ArrowDown").defaultPrevented).toBe(true);
      const lockItem = Array.from(
        menu().querySelectorAll('[role="menuitem"]')
      ).find((item) =>
        item.textContent.includes(locked ? "关闭持续翻译锁定" : "锁定持续翻译")
      );
      expect(lockItem).toBeDefined();
      click(lockItem);
      expect(processActions).toHaveBeenCalledWith({
        action: MSG_TRANS_LOCK_SET,
        args: { enabled: !locked },
      });
      expect(menu()).toBeNull();
      expect(container.getRootNode().activeElement).toBe(fab());
    }
  );

  test("a synthetic lock-menu click is refused even if its menu is already open", () => {
    render();
    key("F10", { shiftKey: true });
    const lockItem = Array.from(
      menu().querySelectorAll('[role="menuitem"]')
    ).find((item) => item.textContent.includes("锁定持续翻译"));
    trustedEvent.mockRestore();
    click(lockItem);
    expect(processActions).not.toHaveBeenCalled();
    expect(menu()).not.toBeNull();
  });

  test("unmount removes the document-level pointer listeners", () => {
    const add = jest.spyOn(document, "addEventListener");
    const remove = jest.spyOn(document, "removeEventListener");
    render();
    const handlers = add.mock.calls.filter(
      ([name, , capture]) =>
        ["pointermove", "pointerup", "pointercancel"].includes(name) &&
        capture === true
    );
    expect(handlers).toHaveLength(3);
    act(() => root.render(null));
    handlers.forEach((args) => expect(remove).toHaveBeenCalledWith(...args));
  });
});
