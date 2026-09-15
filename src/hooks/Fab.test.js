import { act } from "react";
import { createRoot } from "react-dom/client";
import { useFab } from "./Fab";
import { DEFAULT_FAB, STOKEY_FAB } from "../config";
import { getFab, putFab } from "../libs/storage";
import { browser } from "../libs/browser";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("../libs/storage", () => ({ getFab: jest.fn(), putFab: jest.fn() }));
jest.mock("../libs/client", () => ({ isExt: true }));
jest.mock("../libs/browser", () => ({
  browser: {
    storage: {
      onChanged: {
        addListener: jest.fn(),
        removeListener: jest.fn(),
      },
    },
  },
}));

let stored;
let current;
let root;
let container;
function Host() {
  current = useFab();
  return null;
}
async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<Host />);
  });
}
beforeEach(() => {
  stored = {
    x: 0,
    y: 140,
    edge: "left",
    isHide: true,
    hideExceptionList: "example.com",
    fabClickAction: 0,
  };
  getFab.mockImplementation(async () => stored);
  putFab.mockImplementation(async (patch) => {
    stored = { ...stored, ...patch };
  });
});
afterEach(() => {
  if (root) act(() => root.unmount());
  root = null;
  container?.remove();
});

test("loads old preferences with safe color defaults without writing on mount", async () => {
  await mount();
  expect(current.isLoading).toBe(false);
  expect(current.fab).toEqual({ ...DEFAULT_FAB, ...stored });
  expect(putFab).not.toHaveBeenCalled();
});

test("a color edit preserves a newer drag position even before Options receives a storage event", async () => {
  await mount();
  stored = { ...stored, x: 845, y: 230, edge: "right" };
  await act(async () => {
    await current.updateFab({ busyColor: "#aa3344" });
  });
  expect(putFab).toHaveBeenCalledWith({ busyColor: "#AA3344" });
  expect(stored).toEqual({
    x: 845,
    y: 230,
    edge: "right",
    isHide: true,
    hideExceptionList: "example.com",
    fabClickAction: 0,
    busyColor: "#AA3344",
  });
  expect(current.fab.x).toBe(845);
});

test("rapid changes are serialized so two different colors survive delayed storage writes", async () => {
  await mount();
  let release;
  putFab.mockImplementationOnce(
    (patch) =>
      new Promise((resolve) => {
        release = () => {
          stored = { ...stored, ...patch };
          resolve();
        };
      })
  );
  let first;
  let second;
  await act(async () => {
    first = current.updateFab({ idleColor: "#112233" });
    second = current.updateFab({ doneColor: "#abcdef" });
  });
  expect(putFab).toHaveBeenCalledTimes(1);
  expect(current.isSaving).toBe(true);
  await act(async () => {
    release();
    await Promise.all([first, second]);
  });
  expect(stored).toMatchObject({
    idleColor: "#112233",
    doneColor: "#ABCDEF",
    x: 0,
    fabClickAction: 0,
  });
  expect(current.isSaving).toBe(false);
});

test("rejects malformed colors at the save boundary while retaining other legitimate preferences", async () => {
  await mount();
  await act(async () => {
    await current.updateFab({
      idleColor: "url(https://example.test/)",
      isHide: false,
    });
  });
  expect(putFab).toHaveBeenCalledWith({ isHide: false });
  expect(stored.idleColor).toBeUndefined();
  expect(current.fab.idleColor).toBe(DEFAULT_FAB.idleColor);
});

test("storage events refresh saved values without writing them back, and listeners are removed", async () => {
  await mount();
  const listener = browser.storage.onChanged.addListener.mock.calls[0][0];
  stored = { ...stored, doneColor: "#CCDDFF", x: 270 };
  await act(async () => {
    listener({ [STOKEY_FAB]: { newValue: JSON.stringify(stored) } }, "sync");
  });
  expect(current.fab.x).toBe(0);
  await act(async () => {
    listener({ [STOKEY_FAB]: { newValue: JSON.stringify(stored) } }, "local");
  });
  expect(current.fab).toMatchObject({ x: 270, doneColor: "#CCDDFF" });
  expect(putFab).not.toHaveBeenCalled();
  act(() => root.unmount());
  root = null;
  expect(browser.storage.onChanged.removeListener).toHaveBeenCalledWith(
    listener
  );
});

test("save failure is visible and a later edit can succeed without clearing previous settings", async () => {
  await mount();
  putFab.mockRejectedValueOnce(new Error("quota"));
  await act(async () => {
    expect(await current.updateFab({ idleColor: "#112233" })).toBe(false);
  });
  expect(current.saveError).toContain("未保存");
  expect(current.isSaving).toBe(false);
  expect(stored.idleColor).toBeUndefined();
  await act(async () => {
    expect(await current.updateFab({ idleColor: "#223344" })).toBe(true);
  });
  expect(current.saveError).toBe("");
  expect(stored).toMatchObject({ idleColor: "#223344", x: 0, isHide: true });
});
