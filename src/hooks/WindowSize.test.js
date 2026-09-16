import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import useWindowSize, { readWindowSize } from "./WindowSize";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container;
let root;
let originalWidth;
let originalHeight;
let originalInnerWidth;
let originalInnerHeight;

function viewport(width, height, innerWidth = width, innerHeight = height) {
  for (const [target, key, value] of [
    [document.documentElement, "clientWidth", width],
    [document.documentElement, "clientHeight", height],
    [window, "innerWidth", innerWidth],
    [window, "innerHeight", innerHeight],
  ])
    Object.defineProperty(target, key, { configurable: true, value });
}
function Probe({ observe }) {
  const size = useWindowSize();
  useLayoutEffect(() => {
    observe(size);
  }, [observe, size]);
  return (
    <span>
      {size.w} × {size.h}
    </span>
  );
}
function renderProbe(observe) {
  // Native ReactDOM root.render requires act; this is not Testing Library.
  // eslint-disable-next-line testing-library/no-unnecessary-act
  act(() => {
    root.render(<Probe observe={observe} />);
  });
}
beforeEach(() => {
  jest.useFakeTimers();
  originalWidth = Object.getOwnPropertyDescriptor(
    document.documentElement,
    "clientWidth"
  );
  originalHeight = Object.getOwnPropertyDescriptor(
    document.documentElement,
    "clientHeight"
  );
  originalInnerWidth = Object.getOwnPropertyDescriptor(window, "innerWidth");
  originalInnerHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");
  viewport(1000, 700, 1024, 768);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  if (root) act(() => root.unmount());
  container.remove();
  for (const [target, key, descriptor] of [
    [document.documentElement, "clientWidth", originalWidth],
    [document.documentElement, "clientHeight", originalHeight],
    [window, "innerWidth", originalInnerWidth],
    [window, "innerHeight", originalInnerHeight],
  ]) {
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else delete target[key];
  }
  jest.useRealTimers();
});

test("uses the actual layout viewport on the first commit and schedules no mount correction", () => {
  const observe = jest.fn();
  renderProbe(observe);
  expect(observe.mock.calls).toEqual([[{ w: 1000, h: 700 }]]);
  expect(jest.getTimerCount()).toBe(0);
  act(() => jest.advanceTimersByTime(500));
  expect(observe).toHaveBeenCalledTimes(1);
});

test("a not-yet-laid-out root falls back to the available viewport before any timer", () => {
  viewport(0, 0, 1024, 768);
  const observe = jest.fn();
  renderProbe(observe);
  expect(observe.mock.calls).toEqual([[{ w: 1024, h: 768 }]]);
  expect(container.textContent).toBe("1024 × 768");
  expect(jest.getTimerCount()).toBe(0);
});

test("real resize events remain debounced and equal sizes avoid an extra render", () => {
  const observe = jest.fn();
  renderProbe(observe);
  viewport(800, 600);
  act(() => window.dispatchEvent(new Event("resize")));
  act(() => jest.advanceTimersByTime(199));
  expect(observe).toHaveBeenCalledTimes(1);
  act(() => jest.advanceTimersByTime(1));
  expect(observe).toHaveBeenLastCalledWith({ w: 800, h: 600 });
  act(() => window.dispatchEvent(new Event("resize")));
  act(() => jest.advanceTimersByTime(200));
  expect(observe).toHaveBeenCalledTimes(2);
});

test("unmount cancels a pending resize without later observer updates", () => {
  const observe = jest.fn();
  renderProbe(observe);
  viewport(800, 600);
  act(() => window.dispatchEvent(new Event("resize")));
  expect(jest.getTimerCount()).toBe(1);
  act(() => root.unmount());
  root = null;
  expect(jest.getTimerCount()).toBe(0);
  act(() => jest.advanceTimersByTime(500));
  expect(observe).toHaveBeenCalledTimes(1);
});

test("unavailable or invalid viewport metrics remain finite", () => {
  viewport(Number.NaN, -1, Infinity, 0);
  expect(readWindowSize()).toEqual({ w: 0, h: 0 });
});
