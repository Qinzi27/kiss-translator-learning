jest.mock(
  "./shadowDomManager",
  () =>
    class {
      constructor({ props }) {
        this.props = props;
      }
      show = jest.fn();
      hide = jest.fn();
      destroy() {}
    }
);
jest.mock("../views/Action/ContentFab", () => () => null);
jest.mock("./client", () => ({ isExt: true }));
jest.mock("./browser", () => ({
  browser: {
    storage: {
      onChanged: { addListener: jest.fn(), removeListener: jest.fn() },
    },
  },
}));
const { browser } = require("./browser");
const { STOKEY_FAB, DEFAULT_FAB } = require("../config");
const { FabManager } = require("./fabManager");

beforeEach(() => jest.clearAllMocks());

test("passes the engine's readonly progress store and immediately applies serialized local colors", () => {
  const progress = { getSnapshot: jest.fn(), subscribe: jest.fn() };
  const manager = new FabManager({
    fabConfig: { x: 20, idleColor: "#123456" },
    translationProgress: progress,
  });
  expect(manager.props.translationProgress).toBe(progress);
  const changed = browser.storage.onChanged.addListener.mock.calls[0][0];
  const listener = jest.fn();
  manager.props.configStore.subscribe(listener);
  changed(
    {
      [STOKEY_FAB]: {
        newValue: JSON.stringify({ x: 30, idleColor: "#654321" }),
      },
    },
    "local"
  );
  expect(manager.getConfig()).toMatchObject({ x: 30, idleColor: "#654321" });
  expect(listener).toHaveBeenCalledTimes(1);
  const copy = manager.getConfig();
  copy.x = 99;
  expect(manager.getConfig().x).toBe(30);
  manager.destroy();
  expect(browser.storage.onChanged.removeListener).toHaveBeenCalledWith(
    changed
  );
});

test("ignores non-local and damaged changes, and deletion restores defaults", () => {
  const manager = new FabManager({ fabConfig: { idleColor: "#123456" } });
  const changed = browser.storage.onChanged.addListener.mock.calls[0][0];
  changed({ [STOKEY_FAB]: { newValue: "{}" } }, "sync");
  changed({ [STOKEY_FAB]: { newValue: "broken" } }, "local");
  expect(manager.getConfig().idleColor).toBe("#123456");
  changed({ [STOKEY_FAB]: { newValue: undefined } }, "local");
  expect(manager.getConfig().idleColor).toBe(DEFAULT_FAB.idleColor);
  manager.destroy();
});
