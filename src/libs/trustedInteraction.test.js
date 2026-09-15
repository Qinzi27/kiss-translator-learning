import React, { act } from "react";
import ShadowDomManager from "./shadowDomManager";
import { guardInjectedUi, isTrustedUserEvent } from "./trustedInteraction";
import { shortcutRegister } from "./shortcut";
import { touchTapListener } from "./touch";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test("rejects actual script-created DOM events without treating a unit mock as browser input", () => {
  expect(isTrustedUserEvent(new MouseEvent("click"))).toBe(false);
  expect(isTrustedUserEvent(new KeyboardEvent("keydown"))).toBe(false);
  expect(isTrustedUserEvent(undefined)).toBe(false);
  // This object only models the browser-owned field for branch coverage.
  expect(isTrustedUserEvent({ isTrusted: true })).toBe(true);
});

test.each(["click", "keydown", "input", "change", "submit", "touchend"])(
  "an injected UI root blocks synthetic %s before handlers, then cleans up",
  (type) => {
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const button = document.createElement("button");
    shadow.appendChild(button);
    document.body.appendChild(host);
    const cleanup = guardInjectedUi(shadow);
    const handler = jest.fn();
    button.addEventListener(type, handler);
    button.dispatchEvent(
      new Event(type, { bubbles: true, composed: true, cancelable: true })
    );
    expect(handler).not.toHaveBeenCalled();
    cleanup();
    button.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
    expect(handler).toHaveBeenCalledTimes(1);
    host.remove();
  }
);

test("the actual React shadow manager rejects page .click() before its action callback", () => {
  const action = jest.fn();
  const manager = new ShadowDomManager({
    id: "security-ui-fixture",
    reactComponent: () => <button onClick={action}>Translate fixture</button>,
  });
  try {
    act(() => manager.show());
    const host = document.getElementById("security-ui-fixture");
    act(() => host.shadowRoot.querySelector("button").click());
    expect(action).not.toHaveBeenCalled();
  } finally {
    act(() => manager.destroy());
  }
});

test("does not interfere with a page's own synthetic UI events", () => {
  const guarded = document.createElement("div");
  const ordinary = document.createElement("button");
  const handler = jest.fn();
  ordinary.addEventListener("click", handler);
  document.body.append(guarded, ordinary);
  const cleanup = guardInjectedUi(guarded);
  ordinary.click();
  expect(handler).toHaveBeenCalledTimes(1);
  cleanup();
  guarded.remove();
  ordinary.remove();
});

test("global shortcuts reject synthetic keyboard sequences", () => {
  const action = jest.fn();
  const cleanup = shortcutRegister(["AltLeft", "KeyT"], action);
  for (const [type, code] of [
    ["keydown", "AltLeft"],
    ["keydown", "KeyT"],
    ["keyup", "KeyT"],
  ]) {
    window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
  }
  expect(action).not.toHaveBeenCalled();
  cleanup();
});

test("a unit model of native keyboard input retains the shortcut flow", () => {
  const handlers = {};
  const target = {
    addEventListener: (name, callback) => {
      handlers[name] = callback;
    },
    removeEventListener: jest.fn(),
  };
  const action = jest.fn();
  const cleanup = shortcutRegister(["KeyT"], action, target);
  // A callback fixture, not a dispatched event or real browser verification.
  handlers.keydown({ code: "KeyT", isTrusted: true });
  handlers.keyup({ code: "KeyT", isTrusted: true });
  expect(action).toHaveBeenCalledTimes(1);
  cleanup();
});

test("global tap gestures reject page-created touch sequences", () => {
  const action = jest.fn();
  const cleanup = touchTapListener(action, { taps: 1, fingers: 1 });
  for (const [type, touches] of [
    ["touchstart", [{ clientX: 1, clientY: 1 }]],
    ["touchend", []],
  ]) {
    const event = new Event(type, { bubbles: true });
    Object.defineProperty(event, "touches", { value: touches });
    document.dispatchEvent(event);
  }
  expect(action).not.toHaveBeenCalled();
  cleanup();
});
