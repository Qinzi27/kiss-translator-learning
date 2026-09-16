jest.mock(
  "./shadowDomManager",
  () =>
    class {
      show = jest.fn();
      destroy = jest.fn();
    }
);
jest.mock("../components/TouchTranslateControl", () => ({
  TouchTranslateStatus: () => null,
}));
jest.mock("./storage", () => ({
  getTranslationLock: jest.fn(),
  setTranslationLock: jest.fn(),
}));
jest.mock("./rules", () => ({ matchRule: jest.fn() }));
jest.mock("./trustedInteraction", () => ({
  isTrustedUserEvent: jest.fn(),
}));
const mockTranslatorInstances = [];
const mockTranslatorArgs = [];
const mockTransboxInstances = [];
const mockTransboxArgs = [];
const mockInputTranslatorInstances = [];
const mockPopupInstances = [];
const mockFabInstances = [];
const activeManagers = [];

jest.mock("./ruleEditorManager", () => ({
  RuleEditorManager: class {
    destroy = jest.fn();
    open = jest.fn();
  },
}));

jest.mock("../config", () => ({
  EVENT_KISS_INNER: "kiss-inner",
  EVENT_KISS_TRANSLATOR: "kiss-translator",
  MSG_HOVERNODE_TOGGLE: "hovernode-toggle",
  MSG_INPUT_TRANSLATE: "input-translate",
  MSG_TRANS_TOGGLE: "trans-toggle",
  MSG_TRANS_TOGGLE_ONLY: "trans-toggle-only",
  MSG_TRANS_TOGGLE_STYLE: "trans-toggle-style",
  MSG_TRANS_GETRULE: "trans-getrule",
  MSG_TRANS_PUTRULE: "trans-putrule",
  MSG_OPEN_TRANBOX: "open-tranbox",
  MSG_TRANSBOX_TOGGLE: "transbox-toggle",
  MSG_POPUP_TOGGLE: "popup-toggle",
  MSG_MOUSEHOVER_TOGGLE: "mousehover-toggle",
  MSG_TOUCH_TRANSLATE_MODE_SET: "touch-mode-set",
  MSG_TOUCH_TRANSLATE_STATE: "touch-state",
  MSG_TRANSINPUT_TOGGLE: "transinput-toggle",
  MSG_TRANS_LOCK_SET: "trans-lock-set",
  STOKEY_TRANSLATION_LOCK: "translation-lock",
  OPT_SHORTCUT_TRANSLATE: "translate",
  OPT_SHORTCUT_TRANSONLY: "transonly",
  OPT_SHORTCUT_STYLE: "style",
  OPT_SHORTCUT_POPUP: "popup",
  OPT_SHORTCUT_SETTING: "setting",
  newI18n: () => (key) => key,
}));

jest.mock("./browser", () => ({
  browser: {
    storage: {
      onChanged: { addListener: jest.fn(), removeListener: jest.fn() },
    },
    runtime: {
      id: "test-extension",
      getURL: (path) => `chrome-extension://test-extension${path}`,
      onMessage: {
        addListener: jest.fn(),
        removeListener: jest.fn(),
      },
    },
  },
}));

jest.mock("./translator", () => ({
  Translator: jest.fn().mockImplementation((args) => {
    mockTranslatorArgs.push(args);
    const instance = {
      setting: args.setting,
      rule: args.rule,
      translationProgress: { getSnapshot: jest.fn(), subscribe: jest.fn() },
      stop: jest.fn(function stop() {
        this.rule.transOpen = "false";
      }),
      setTouchMode: jest.fn((mode) => mode),
      rescan: jest.fn(),
      toggle: jest.fn(),
      enable: jest.fn(),
      disable: jest.fn(),
      toggleTransOnly: jest.fn(),
      toggleStyle: jest.fn(),
      updateRule: jest.fn(),
      toggleTransbox: jest.fn(function toggleTransbox() {
        this.setting.tranboxSetting.transOpen =
          !this.setting.tranboxSetting.transOpen;
      }),
      toggleMouseHover: jest.fn(function toggleMouseHover() {
        this.setting.mouseHoverSetting.useMouseHover =
          !this.setting.mouseHoverSetting.useMouseHover;
      }),
      toggleInputTranslate: jest.fn(function toggleInputTranslate() {
        this.setting.inputRule.transOpen = !this.setting.inputRule.transOpen;
      }),
      toggleHoverNode: jest.fn(),
    };
    mockTranslatorInstances.push(instance);
    return instance;
  }),
}));

jest.mock("./tranbox", () => ({
  TransboxManager: jest.fn().mockImplementation((setting) => {
    mockTransboxArgs.push(setting);
    let enabled = Boolean(setting.tranboxSetting?.transOpen);
    const instance = {
      isEnabled: jest.fn(() => enabled),
      enable: jest.fn(() => {
        enabled = true;
      }),
      disable: jest.fn(() => {
        enabled = false;
      }),
      toggle: jest.fn(() => {
        enabled = !enabled;
      }),
    };
    mockTransboxInstances.push(instance);
    return instance;
  }),
}));

jest.mock("./inputTranslate", () => ({
  InputTranslator: jest.fn().mockImplementation(() => {
    const instance = {
      enable: jest.fn(),
      disable: jest.fn(),
      toggle: jest.fn(),
      handleTranslate: jest.fn(),
    };
    mockInputTranslatorInstances.push(instance);
    return instance;
  }),
}));

jest.mock("./popupManager", () => ({
  PopupManager: jest.fn().mockImplementation(() => {
    const instance = {
      destroy: jest.fn(),
      toggle: jest.fn(),
    };
    mockPopupInstances.push(instance);
    return instance;
  }),
}));

jest.mock("./fabManager", () => ({
  FabManager: jest.fn().mockImplementation(() => {
    const instance = {
      destroy: jest.fn(),
    };
    mockFabInstances.push(instance);
    return instance;
  }),
}));

jest.mock("./shortcut", () => ({
  shortcutRegister: jest.fn(() => jest.fn()),
}));

jest.mock("./touch", () => ({
  touchTapListener: jest.fn(() => jest.fn()),
}));

jest.mock("./iframe", () => ({
  sendIframeMsg: jest.fn(),
}));

jest.mock("./log", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
  },
}));

const { browser } = require("./browser");
const { Translator } = require("./translator");
const { TransboxManager } = require("./tranbox");
const { InputTranslator } = require("./inputTranslate");
const { PopupManager } = require("./popupManager");
const { FabManager } = require("./fabManager");
const { getTranslationLock, setTranslationLock } = require("./storage");
const { matchRule } = require("./rules");
const { isTrustedUserEvent } = require("./trustedInteraction");
const TranslatorManager = require("./translatorManager").default;
const { subscribeInternalMessage } = require("./internalEvents");
const trustedSender = {
  id: "test-extension",
  url: "chrome-extension://test-extension/background.js",
};

function setupMockConstructors() {
  Translator.mockImplementation((args) => {
    mockTranslatorArgs.push(args);
    const instance = {
      setting: args.setting,
      rule: args.rule,
      translationProgress: { getSnapshot: jest.fn(), subscribe: jest.fn() },
      stop: jest.fn(function stop() {
        this.rule.transOpen = "false";
      }),
      setTouchMode: jest.fn((mode) => mode),
      rescan: jest.fn(),
      toggle: jest.fn(function () {
        this.rule.transOpen = this.rule.transOpen === "true" ? "false" : "true";
      }),
      enable: jest.fn(function () {
        this.rule.transOpen = "true";
      }),
      disable: jest.fn(function () {
        this.rule.transOpen = "false";
      }),
      toggleTransOnly: jest.fn(),
      toggleStyle: jest.fn(),
      updateRule: jest.fn(function (rule) {
        this.rule = { ...this.rule, ...rule };
      }),
      toggleTransbox: jest.fn(function toggleTransbox() {
        this.setting.tranboxSetting.transOpen =
          !this.setting.tranboxSetting.transOpen;
      }),
      toggleMouseHover: jest.fn(function toggleMouseHover() {
        this.setting.mouseHoverSetting.useMouseHover =
          !this.setting.mouseHoverSetting.useMouseHover;
      }),
      toggleInputTranslate: jest.fn(function toggleInputTranslate() {
        this.setting.inputRule.transOpen = !this.setting.inputRule.transOpen;
      }),
      toggleHoverNode: jest.fn(),
    };
    mockTranslatorInstances.push(instance);
    return instance;
  });

  TransboxManager.mockImplementation((setting) => {
    mockTransboxArgs.push(setting);
    let enabled = Boolean(setting.tranboxSetting?.transOpen);
    const instance = {
      isEnabled: jest.fn(() => enabled),
      enable: jest.fn(() => {
        enabled = true;
      }),
      disable: jest.fn(() => {
        enabled = false;
      }),
      toggle: jest.fn(() => {
        enabled = !enabled;
      }),
    };
    mockTransboxInstances.push(instance);
    return instance;
  });

  InputTranslator.mockImplementation(() => {
    const instance = {
      enable: jest.fn(),
      disable: jest.fn(),
      toggle: jest.fn(),
      handleTranslate: jest.fn(),
    };
    mockInputTranslatorInstances.push(instance);
    return instance;
  });

  PopupManager.mockImplementation(() => {
    const instance = {
      destroy: jest.fn(),
      toggle: jest.fn(),
    };
    mockPopupInstances.push(instance);
    return instance;
  });

  FabManager.mockImplementation((args) => {
    let config = { ...args.fabConfig };
    const instance = {
      destroy: jest.fn(),
      getConfig: jest.fn(() => ({ ...config })),
      setTranslationLock: jest.fn((enabled, error = "") => {
        config = {
          ...config,
          translationLocked: enabled,
          translationLockError: error,
        };
      }),
    };
    mockFabInstances.push(instance);
    return instance;
  });
}

function createManager({
  rule = { transOpen: "true" },
  setting = {},
  isUserscript = false,
  isIframe = false,
  transboxOnly = false,
} = {}) {
  const manager = new TranslatorManager({
    setting: {
      touchModes: [],
      shortcuts: {},
      tranboxSetting: { transOpen: true },
      mouseHoverSetting: { useMouseHover: false },
      inputRule: { transOpen: true },
      contextMenuType: 0,
      ...setting,
    },
    rule,
    fabConfig: { isHide: false },
    favWords: [],
    isIframe,
    isUserscript,
    transboxOnly,
  });
  activeManagers.push(manager);
  return manager;
}

function replaceBody() {
  const newBody = document.createElement("body");
  document.body.replaceWith(newBody);
}

async function flushMutationObserver() {
  await Promise.resolve();
  await Promise.resolve();
}

function sendRuntimeMessage(message) {
  const runtimeHandler = browser.runtime.onMessage.addListener.mock.calls[0][0];
  const sendResponse = jest.fn();
  runtimeHandler(message, trustedSender, sendResponse);
  expect(sendResponse).toHaveBeenCalledTimes(1);
  return sendResponse.mock.calls[0][0];
}

describe("TranslatorManager SPA lifecycle", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    document.documentElement.innerHTML = "<head></head><body></body>";
    jest.clearAllMocks();

    mockTranslatorInstances.length = 0;
    mockTranslatorArgs.length = 0;
    mockTransboxInstances.length = 0;
    mockTransboxArgs.length = 0;
    mockInputTranslatorInstances.length = 0;
    mockPopupInstances.length = 0;
    mockFabInstances.length = 0;
    activeManagers.length = 0;
    getTranslationLock.mockReset().mockResolvedValue(false);
    setTranslationLock.mockReset().mockResolvedValue(undefined);
    matchRule.mockReset().mockResolvedValue({
      transOpen: "false",
      apiSlug: "matched-service",
      selector: ".matched",
    });
    isTrustedUserEvent.mockImplementation(
      jest.requireActual("./trustedInteraction").isTrustedUserEvent
    );
    require("./shortcut").shortcutRegister.mockImplementation(() => jest.fn());
    require("./touch").touchTapListener.mockImplementation(() => jest.fn());
    setupMockConstructors();
  });

  afterEach(() => {
    activeManagers.forEach((manager) => manager.stop());
    activeManagers.length = 0;
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test.each([
    {
      action: "trans-putrule",
      args: { injectJs: "synthetic", apiSlug: "other" },
    },
    { action: "trans-putrule", args: { transStartHook: "synthetic" } },
    { action: "trans-toggle", args: { enabled: true } },
    { action: "trans-toggle" },
    { action: "trans-toggle-only" },
    { action: "trans-toggle-style" },
    { action: "input-translate" },
    { action: "open-tranbox", args: { text: "page-controlled text" } },
    { action: "trans-toggle", args: { enabled: false, injectJs: "synthetic" } },
  ])("rejects page-controlled CustomEvent action $action", (message) => {
    const manager = createManager();
    manager.start();
    window.dispatchEvent(
      new CustomEvent("kiss-translator", { detail: message })
    );
    const translator = mockTranslatorInstances[0];
    for (const method of [
      "updateRule",
      "toggle",
      "enable",
      "disable",
      "toggleStyle",
      "toggleTransOnly",
    ]) {
      expect(translator[method]).not.toHaveBeenCalled();
    }
    expect(require("./iframe").sendIframeMsg).not.toHaveBeenCalled();
    expect(
      mockInputTranslatorInstances[0].handleTranslate
    ).not.toHaveBeenCalled();
  });

  test("only accepts explicit stop from the public event and strips its envelope", () => {
    createManager().start();
    window.dispatchEvent(
      new CustomEvent("kiss-translator", {
        detail: {
          action: "trans-toggle",
          args: { enabled: false },
          fromExt: true,
        },
      })
    );
    expect(mockTranslatorInstances[0].disable).toHaveBeenCalledTimes(1);
    expect(require("./iframe").sendIframeMsg).toHaveBeenCalledWith(
      "trans-toggle",
      { enabled: false }
    );
  });

  test.each([false, true])(
    "postMessage cannot elevate rule changes (userscript: %s)",
    (isUserscript) => {
      createManager({ isIframe: true, isUserscript }).start();
      window.dispatchEvent(
        new MessageEvent("message", {
          source: window.parent,
          origin: "https://untrusted.example",
          data: {
            action: "trans-putrule",
            args: { injectJs: "synthetic" },
            fromExt: true,
          },
        })
      );
      expect(mockTranslatorInstances[0].updateRule).not.toHaveBeenCalled();
      expect(require("./iframe").sendIframeMsg).not.toHaveBeenCalled();
    }
  );

  test.each([
    {},
    { id: "another-extension", url: trustedSender.url },
    { id: "test-extension", url: "https://untrusted.example" },
    {
      id: "test-extension",
      url: "chrome-extension://another-extension/options.html",
    },
    { id: "test-extension", url: "not-a-url" },
    { id: "test-extension", tab: { id: 1 } },
    { id: "test-extension", frameId: 0 },
    { id: "test-extension", frameId: -1 },
    { id: "test-extension", documentId: "document-fixture" },
    { id: "test-extension", documentLifecycle: "active" },
    { id: "test-extension", origin: "https://untrusted.example" },
    { id: "test-extension", origin: "null" },
    { id: "test-extension", origin: "chrome-extension://another-extension" },
  ])(
    "rejects an untrusted runtime sender without returning settings",
    (sender) => {
      createManager().start();
      const handler = browser.runtime.onMessage.addListener.mock.calls[0][0];
      const respond = jest.fn();
      expect(
        handler(
          { action: "trans-putrule", args: { apiSlug: "other" } },
          sender,
          respond
        )
      ).toBe(false);
      expect(mockTranslatorInstances[0].updateRule).not.toHaveBeenCalled();
      expect(respond).not.toHaveBeenCalled();
    }
  );

  test.each([
    { id: "test-extension" },
    { id: "test-extension", url: "", origin: "" },
    { id: "test-extension", origin: "chrome-extension://test-extension" },
  ])("accepts a native worker sender without a document URL: %j", (sender) => {
    createManager().start();
    const handler = browser.runtime.onMessage.addListener.mock.calls[0][0];
    const respond = jest.fn();
    expect(handler({ action: "trans-toggle" }, sender, respond)).toBe(true);
    expect(mockTranslatorInstances[0].toggle).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledTimes(1);
    expect(require("./iframe").sendIframeMsg).not.toHaveBeenCalled();
  });

  test("worker metadata in message data cannot impersonate the native runtime sender", () => {
    createManager().start();
    const handler = browser.runtime.onMessage.addListener.mock.calls[0][0];
    const respond = jest.fn();
    const message = {
      action: "trans-toggle",
      sender: { id: "test-extension" },
      fromExt: true,
    };
    expect(handler(message, {}, respond)).toBe(false);
    window.dispatchEvent(
      new CustomEvent("kiss-translator", { detail: message })
    );
    expect(mockTranslatorInstances[0].toggle).not.toHaveBeenCalled();
    expect(respond).not.toHaveBeenCalled();
  });

  test("preserves trusted extension and internal editor rule changes without DOM forwarding", () => {
    createManager().start();
    const rule = {
      apiSlug: "saved-service",
      transStartHook: "({text}) => ({text})",
    };
    sendRuntimeMessage({ action: "trans-putrule", args: rule });
    const processActions = PopupManager.mock.calls[0][0].processActions;
    processActions({ action: "trans-putrule", args: rule });
    expect(mockTranslatorInstances[0].updateRule).toHaveBeenCalledTimes(2);
    expect(mockTranslatorInstances[0].updateRule).toHaveBeenLastCalledWith(
      rule
    );
    expect(require("./iframe").sendIframeMsg).not.toHaveBeenCalled();
  });

  test("restarts runtime modules when body is replaced", async () => {
    const manager = createManager();
    manager.start();

    replaceBody();
    await flushMutationObserver();
    jest.runOnlyPendingTimers();

    expect(Translator).toHaveBeenCalledTimes(2);
    expect(mockTranslatorInstances[0].stop).toHaveBeenCalledTimes(1);
    expect(mockPopupInstances[0].destroy).toHaveBeenCalledTimes(1);
    expect(mockFabInstances[0].destroy).toHaveBeenCalledTimes(1);
    expect(browser.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
  });

  test("touch mode is document-local and survives runtime recreation", () => {
    const manager = createManager();
    manager.start();
    expect(
      sendRuntimeMessage({ action: "touch-state" }).touchTranslate.mode
    ).toBe("off");
    expect(
      sendRuntimeMessage({ action: "touch-mode-set", args: { mode: "tap" } })
        .touchTranslate.mode
    ).toBe("tap");
    manager.restart();
    expect(mockTranslatorInstances[1].setTouchMode).toHaveBeenCalledWith("tap");
    expect(mockTranslatorArgs[1].setting.mouseHoverSetting).toEqual({
      useMouseHover: false,
    });
    manager.stop();
    const nextDocument = createManager();
    nextDocument.start();
    const respond = jest.fn();
    browser.runtime.onMessage.addListener.mock.calls.at(-1)[0](
      { action: "touch-state" },
      trustedSender,
      respond
    );
    expect(respond.mock.calls[0][0].touchTranslate.mode).toBe("off");
  });

  test("does not restart after stop", async () => {
    const manager = createManager();
    manager.start();
    manager.stop();

    replaceBody();
    await flushMutationObserver();
    jest.runOnlyPendingTimers();

    expect(Translator).toHaveBeenCalledTimes(1);
  });

  test("preserves disabled translation and UI settings across restart", async () => {
    const manager = createManager({
      rule: { transOpen: "false" },
      setting: {
        tranboxSetting: { transOpen: false },
        inputRule: { transOpen: false },
      },
    });
    manager.start();

    replaceBody();
    await flushMutationObserver();
    jest.runOnlyPendingTimers();

    expect(mockTranslatorArgs[1].rule.transOpen).toBe("false");
    expect(mockTransboxArgs[1].tranboxSetting.transOpen).toBe(false);
    expect(mockTranslatorArgs[1].setting.inputRule.transOpen).toBe(false);
  });

  test.each([true, false])(
    "restores pre-editor translation state %s and explicit feature settings on restart",
    (enabled) => {
      const manager = createManager();
      manager.start();
      sendRuntimeMessage({
        action: "transbox-toggle",
        args: { enabled: false },
      });
      sendRuntimeMessage({
        action: "transinput-toggle",
        args: { enabled: false },
      });

      const translator = mockTranslatorInstances[0];
      const editor = manager._ruleEditorManager;
      editor.session = { runtimeState: { enabled, mouseHover: enabled } };
      translator.rule = {
        transOpen: enabled ? "false" : "true",
        selector: ".article",
      };
      translator.setting.mouseHoverSetting.useMouseHover = !enabled;

      manager.restart("rule-editor-state-test");

      expect(editor.destroy).toHaveBeenCalledTimes(1);
      expect(mockTranslatorArgs[1].rule).toEqual({
        transOpen: enabled ? "true" : "false",
        selector: ".article",
      });
      expect(
        mockTranslatorArgs[1].setting.mouseHoverSetting.useMouseHover
      ).toBe(enabled);
      expect(mockTransboxArgs[1].tranboxSetting.transOpen).toBe(false);
      expect(mockTranslatorArgs[1].setting.inputRule.transOpen).toBe(false);
      expect(translator.setting.mouseHoverSetting.useMouseHover).toBe(!enabled);
    }
  );

  test("coalesces navigation rescan and body replacement into one restart", async () => {
    const manager = createManager();
    manager.start();

    document.documentElement.dispatchEvent(new Event("turbo:load"));
    replaceBody();
    await flushMutationObserver();
    jest.runOnlyPendingTimers();

    expect(Translator).toHaveBeenCalledTimes(2);
    expect(mockTranslatorInstances[0].rescan).not.toHaveBeenCalled();
  });

  test("rescans on bfcache pageshow when the document container is unchanged", () => {
    const manager = createManager();
    manager.start();

    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true })
    );
    jest.runOnlyPendingTimers();

    expect(mockTranslatorInstances[0].rescan).toHaveBeenCalledTimes(1);
    expect(Translator).toHaveBeenCalledTimes(1);
  });

  test("starts only the transbox and message listener in transbox-only mode", () => {
    const manager = createManager({ transboxOnly: true });
    manager.start();

    expect(TransboxManager).toHaveBeenCalledTimes(1);
    expect(Translator).not.toHaveBeenCalled();
    expect(InputTranslator).not.toHaveBeenCalled();
    expect(PopupManager).not.toHaveBeenCalled();
    expect(FabManager).not.toHaveBeenCalled();
    expect(browser.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
  });

  test.each(["background.js", "popup.html", "options.html"])(
    "trusted %s can open selection translation through the private bus",
    (senderPage) => {
      const manager = createManager({ transboxOnly: true });
      const eventHandler = jest.fn();
      manager.start();
      const unsubscribe = subscribeInternalMessage(eventHandler);
      const pageListener = jest.fn();
      document.addEventListener("kiss-inner", pageListener);

      const runtimeHandler =
        browser.runtime.onMessage.addListener.mock.calls[0][0];
      const sendResponse = jest.fn();
      runtimeHandler(
        { action: "open-tranbox", args: { text: "hello" } },
        {
          ...trustedSender,
          url: `chrome-extension://test-extension/${senderPage}`,
        },
        sendResponse
      );

      expect(eventHandler).toHaveBeenCalledTimes(1);
      expect(eventHandler.mock.calls[0][0]).toEqual({
        action: "open-tranbox",
        args: { text: "hello" },
      });

      expect(pageListener).not.toHaveBeenCalled();
      unsubscribe();
      document.removeEventListener("kiss-inner", pageListener);
    }
  );

  test.each([true, false])(
    "keeps reopened Popup toggles in sync in transbox-only mode from %s",
    (initialEnabled) => {
      const manager = createManager({
        transboxOnly: true,
        setting: { tranboxSetting: { transOpen: initialEnabled } },
      });
      manager.start();

      for (const expected of [
        !initialEnabled,
        initialEnabled,
        !initialEnabled,
      ]) {
        const reopened = sendRuntimeMessage({ action: "trans-getrule" });
        const message = {
          action: "transbox-toggle",
          args: { enabled: !reopened.setting.tranboxSetting.transOpen },
        };
        const response = sendRuntimeMessage(message);
        expect(response.setting.tranboxSetting.transOpen).toBe(expected);
        expect(mockTransboxInstances[0].isEnabled()).toBe(expected);

        const replayed = sendRuntimeMessage(message);
        expect(replayed.setting.tranboxSetting.transOpen).toBe(expected);
        expect(mockTransboxInstances[0].isEnabled()).toBe(expected);
      }

      for (const expected of [initialEnabled, !initialEnabled]) {
        const response = sendRuntimeMessage({ action: "transbox-toggle" });
        expect(response.setting.tranboxSetting.transOpen).toBe(expected);
        expect(mockTransboxInstances[0].isEnabled()).toBe(expected);
        const reopened = sendRuntimeMessage({ action: "trans-getrule" });
        expect(reopened.setting.tranboxSetting.transOpen).toBe(expected);
      }
    }
  );

  test.each([true, false])(
    "preserves the live transbox-only state across restart from %s",
    (initialEnabled) => {
      const tranboxSetting = {
        transOpen: initialEnabled,
        tranboxShortcut: "Alt+S",
      };
      const manager = createManager({
        transboxOnly: true,
        setting: { tranboxSetting, uiLang: "en" },
      });
      manager.start();
      sendRuntimeMessage({ action: "transbox-toggle" });

      manager.restart("pdf-selection-state-test");

      const response = sendRuntimeMessage({ action: "trans-getrule" });
      expect(response.setting.tranboxSetting).toEqual({
        ...tranboxSetting,
        transOpen: !initialEnabled,
      });
      expect(response.setting.uiLang).toBe("en");
      expect(mockTransboxInstances[1].isEnabled()).toBe(!initialEnabled);
      expect(mockTransboxArgs[1].tranboxSetting.transOpen).toBe(
        !initialEnabled
      );
      expect(tranboxSetting.transOpen).toBe(initialEnabled);
      expect(Translator).not.toHaveBeenCalled();
    }
  );

  test("returns current translator settings and rules in normal mode", () => {
    const manager = createManager();
    manager.start();
    const translator = mockTranslatorInstances[0];
    translator.setting.uiLang = "en";
    translator.rule = { transOpen: "false", toLang: "en" };

    sendRuntimeMessage({
      action: "transbox-toggle",
      args: { enabled: false },
    });
    const response = sendRuntimeMessage({ action: "trans-getrule" });

    expect(response).toEqual({
      rule: translator.rule,
      setting: translator.setting,
    });
    expect(response.setting.uiLang).toBe("en");
    expect(response.setting.tranboxSetting.transOpen).toBe(false);
    expect(mockTransboxInstances[0].isEnabled()).toBe(false);
  });

  test("applies an explicit page translation state without double toggling", () => {
    const manager = createManager();
    manager.start();

    const runtimeHandler =
      browser.runtime.onMessage.addListener.mock.calls[0][0];
    runtimeHandler(
      { action: "trans-toggle", args: { enabled: false } },
      trustedSender,
      jest.fn()
    );
    runtimeHandler(
      { action: "trans-toggle", args: { enabled: true } },
      trustedSender,
      jest.fn()
    );

    expect(mockTranslatorInstances[0].disable).toHaveBeenCalledTimes(1);
    expect(mockTranslatorInstances[0].enable).toHaveBeenCalledTimes(1);
    expect(mockTranslatorInstances[0].toggle).not.toHaveBeenCalled();
  });

  test("keeps the legacy page translation toggle when no state is supplied", () => {
    const manager = createManager();
    manager.start();

    const runtimeHandler =
      browser.runtime.onMessage.addListener.mock.calls[0][0];
    runtimeHandler({ action: "trans-toggle" }, trustedSender, jest.fn());

    expect(mockTranslatorInstances[0].toggle).toHaveBeenCalledTimes(1);
    expect(mockTranslatorInstances[0].enable).not.toHaveBeenCalled();
    expect(mockTranslatorInstances[0].disable).not.toHaveBeenCalled();
  });

  test("applies explicit feature states without flipping them on replay", () => {
    const manager = createManager();
    manager.start();

    const runtimeHandler =
      browser.runtime.onMessage.addListener.mock.calls[0][0];
    const send = (action, enabled) =>
      runtimeHandler({ action, args: { enabled } }, trustedSender, jest.fn());

    send("transbox-toggle", false);
    send("transbox-toggle", false);
    send("mousehover-toggle", true);
    send("mousehover-toggle", true);
    send("transinput-toggle", false);
    send("transinput-toggle", false);

    expect(mockTransboxInstances[0].disable).toHaveBeenCalledTimes(2);
    expect(mockTranslatorInstances[0].toggleTransbox).toHaveBeenCalledTimes(1);
    expect(mockTranslatorInstances[0].setting.tranboxSetting.transOpen).toBe(
      false
    );
    expect(mockTranslatorInstances[0].toggleMouseHover).toHaveBeenCalledTimes(
      1
    );
    expect(
      mockTranslatorInstances[0].setting.mouseHoverSetting.useMouseHover
    ).toBe(true);
    expect(mockInputTranslatorInstances[0].disable).toHaveBeenCalledTimes(2);
    expect(
      mockTranslatorInstances[0].toggleInputTranslate
    ).toHaveBeenCalledTimes(1);
    expect(mockTranslatorInstances[0].setting.inputRule.transOpen).toBe(false);
  });

  test("keeps legacy feature toggles when no desired state is supplied", () => {
    const manager = createManager();
    manager.start();

    const runtimeHandler =
      browser.runtime.onMessage.addListener.mock.calls[0][0];
    ["transbox-toggle", "mousehover-toggle", "transinput-toggle"].forEach(
      (action) => runtimeHandler({ action }, trustedSender, jest.fn())
    );

    expect(mockTransboxInstances[0].toggle).toHaveBeenCalledTimes(1);
    expect(mockTranslatorInstances[0].toggleTransbox).toHaveBeenCalledTimes(1);
    expect(mockTranslatorInstances[0].toggleMouseHover).toHaveBeenCalledTimes(
      1
    );
    expect(mockInputTranslatorInstances[0].toggle).toHaveBeenCalledTimes(1);
    expect(
      mockTranslatorInstances[0].toggleInputTranslate
    ).toHaveBeenCalledTimes(1);
  });

  test("binds FAB progress to the current engine and retains live appearance on runtime restart", () => {
    const manager = createManager();
    manager.start();
    expect(FabManager.mock.calls[0][0].translationProgress).toBe(
      mockTranslatorInstances[0].translationProgress
    );
    const previous = FabManager.mock.calls[0][0].translationProgress;
    mockFabInstances[0].getConfig = () => ({
      isHide: false,
      idleColor: "#123456",
      x: 50,
    });
    manager.restart("new-page");
    expect(FabManager.mock.calls[1][0].translationProgress).toBe(
      mockTranslatorInstances[1].translationProgress
    );
    expect(FabManager.mock.calls[1][0].translationProgress).not.toBe(previous);
    expect(FabManager.mock.calls[1][0].fabConfig).toEqual({
      isHide: false,
      idleColor: "#123456",
      x: 50,
    });
  });

  test("reports live selection availability to the FAB after toggles and restart", () => {
    const manager = createManager({
      setting: { tranboxSetting: { transOpen: false } },
    });
    manager.start();
    const { getSelectionEnabled } = FabManager.mock.calls[0][0];
    const { processActions } = PopupManager.mock.calls[0][0];
    const snapshots = [];
    const onSelectionChange = (message) => {
      if (message.action === "transbox-toggle") {
        snapshots.push(getSelectionEnabled());
      }
    };
    const unsubscribe = subscribeInternalMessage(onSelectionChange);

    try {
      expect(getSelectionEnabled()).toBe(false);
      for (const enabled of [true, true, false]) {
        processActions({ action: "transbox-toggle", args: { enabled } });
      }
      processActions({ action: "transbox-toggle" });
      processActions({ action: "transbox-toggle" });

      expect(snapshots).toEqual([true, true, false, true, false]);
      expect(getSelectionEnabled()).toBe(false);

      manager.restart("selection-state-test");
      expect(FabManager.mock.calls[1][0].getSelectionEnabled()).toBe(false);
      expect(mockTransboxArgs[1].tranboxSetting.transOpen).toBe(false);
    } finally {
      unsubscribe();
    }
  });

  test("cleans up transbox-only runtime on stop", () => {
    const manager = createManager({ transboxOnly: true });
    manager.start();
    manager.stop();

    expect(browser.runtime.onMessage.removeListener).toHaveBeenCalledWith(
      browser.runtime.onMessage.addListener.mock.calls[0][0]
    );
    expect(mockTransboxInstances[0].disable).toHaveBeenCalledTimes(1);
  });

  describe("persistent translation lock and new-page policy", () => {
    let initialUrl;
    let originalNavigation;
    const settle = () => new Promise(jest.requireActual("timers").setImmediate);
    const pending = () => {
      let resolve;
      let reject;
      const promise = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
      });
      return { promise, resolve, reject };
    };
    const action = (enabled) => ({
      action: "trans-lock-set",
      args: { enabled },
    });
    const internal = (enabled, index = 0) =>
      FabManager.mock.calls[index][0].processActions(action(enabled));
    const navigate = (path, event = "currententrychange") => {
      window.history.pushState({}, "", path);
      (event === "currententrychange"
        ? window.navigation
        : window
      ).dispatchEvent(new Event(event));
    };
    const storageChange = (enabled, area = "local") => {
      for (const [listener] of browser.storage.onChanged.addListener.mock.calls)
        listener(
          { "translation-lock": { newValue: JSON.stringify({ enabled }) } },
          area
        );
    };
    beforeEach(() => {
      initialUrl = window.location.href;
      originalNavigation = Object.getOwnPropertyDescriptor(
        window,
        "navigation"
      );
      Object.defineProperty(window, "navigation", {
        configurable: true,
        value: new EventTarget(),
      });
      window.history.replaceState({}, "", "/lock-test/article-a");
    });
    afterEach(() => {
      window.history.replaceState({}, "", initialUrl);
      if (originalNavigation)
        Object.defineProperty(window, "navigation", originalNavigation);
      else delete window.navigation;
    });

    test("public CustomEvent and postMessage cannot persist a lock or forge trusted runtime identity", () => {
      createManager({
        isUserscript: true,
        rule: { transOpen: "false" },
      }).start();
      const forged = { ...action(true), fromExt: true, sender: trustedSender };
      window.dispatchEvent(
        new CustomEvent("kiss-translator", { detail: forged })
      );
      window.dispatchEvent(
        new MessageEvent("message", {
          data: forged,
          source: window,
          origin: window.location.origin,
        })
      );
      expect(setTranslationLock).not.toHaveBeenCalled();
      expect(getTranslationLock).not.toHaveBeenCalled();
      expect(mockTranslatorInstances[0].enable).not.toHaveBeenCalled();
    });

    test("only a verified runtime sender receives the asynchronous lock result", async () => {
      createManager({ rule: { transOpen: "false" } }).start();
      getTranslationLock.mockResolvedValue(true);
      const handler = browser.runtime.onMessage.addListener.mock.calls[0][0];
      const untrustedResponse = jest.fn();
      expect(
        handler(
          action(true),
          { id: trustedSender.id, url: "https://page.example/" },
          untrustedResponse
        )
      ).toBe(false);
      expect(setTranslationLock).not.toHaveBeenCalled();
      const response = jest.fn();
      expect(handler(action(true), trustedSender, response)).toBe(true);
      expect(response).not.toHaveBeenCalled();
      await settle();
      expect(response).toHaveBeenCalledWith({ translationLocked: true });
      expect(untrustedResponse).not.toHaveBeenCalled();
      expect(mockTranslatorInstances[0].enable).toHaveBeenCalledTimes(1);
    });

    test("saving succeeds before the current page enables, while unlocking leaves its translations intact", async () => {
      createManager({ rule: { transOpen: "false" } }).start();
      const saved = pending();
      setTranslationLock.mockReturnValueOnce(saved.promise);
      getTranslationLock.mockResolvedValue(true);
      const saving = internal(true);
      await settle();
      expect(setTranslationLock).toHaveBeenCalledWith(true);
      expect(mockTranslatorInstances[0].enable).not.toHaveBeenCalled();
      expect(getTranslationLock).not.toHaveBeenCalled();
      saved.resolve();
      await expect(saving).resolves.toEqual({ translationLocked: true });
      expect(mockTranslatorInstances[0].rule.transOpen).toBe("true");
      expect(mockFabInstances[0].setTranslationLock).toHaveBeenLastCalledWith(
        true,
        ""
      );
      getTranslationLock.mockResolvedValue(false);
      await expect(internal(false)).resolves.toEqual({
        translationLocked: false,
      });
      expect(mockTranslatorInstances[0].disable).not.toHaveBeenCalled();
      expect(mockTranslatorInstances[0].rule.transOpen).toBe("true");
    });

    test("failed persistent storage neither enables nor displays a saved lock", async () => {
      createManager({ rule: { transOpen: "false" } }).start();
      setTranslationLock.mockRejectedValueOnce(
        new Error("synthetic quota failure")
      );
      const response = await internal(true);
      expect(response.error).toContain("未保存");
      expect(mockTranslatorInstances[0].enable).not.toHaveBeenCalled();
      expect(mockFabInstances[0].getConfig().translationLocked).not.toBe(true);
      expect(mockFabInstances[0].getConfig().translationLockError).toContain(
        "未保存"
      );
      expect(getTranslationLock).not.toHaveBeenCalled();
    });

    test("a successful write followed by a failed confirmation reports saved-but-unconfirmed and never auto-enables", async () => {
      createManager({ rule: { transOpen: "false" } }).start();
      getTranslationLock.mockRejectedValueOnce(
        new Error("synthetic read failure")
      );
      const response = await internal(true);
      expect(setTranslationLock).toHaveBeenCalledWith(true);
      expect(response.error).toContain("已保存");
      expect(response.error).toContain("确认失败");
      expect(response.error).not.toContain("未保存");
      expect(mockTranslatorInstances[0].enable).not.toHaveBeenCalled();
      expect(mockFabInstances[0].getConfig()).toMatchObject({
        translationLocked: true,
        translationLockError: response.error,
      });
    });

    test("other already-open tabs synchronize only the badge, and listeners are removed on stop", async () => {
      const first = createManager({ rule: { transOpen: "false" } });
      const second = createManager({ rule: { transOpen: "false" } });
      first.start();
      second.start();
      getTranslationLock.mockResolvedValue(true);
      await internal(true);
      storageChange(true);
      expect(mockTranslatorInstances[0].enable).toHaveBeenCalledTimes(1);
      expect(mockTranslatorInstances[1].enable).not.toHaveBeenCalled();
      expect(mockFabInstances[1].getConfig().translationLocked).toBe(true);
      storageChange(false, "sync");
      expect(mockFabInstances[1].getConfig().translationLocked).toBe(true);
      storageChange(false);
      expect(mockFabInstances[1].getConfig().translationLocked).toBe(false);
      expect(mockTranslatorInstances[0].disable).not.toHaveBeenCalled();
      expect(mockTranslatorInstances[1].disable).not.toHaveBeenCalled();
      const listeners = browser.storage.onChanged.addListener.mock.calls.map(
        ([listener]) => listener
      );
      first.stop();
      second.stop();
      expect(
        browser.storage.onChanged.removeListener.mock.calls.map(
          ([listener]) => listener
        )
      ).toEqual(listeners);
    });

    test.each(["currententrychange", "popstate", "hashchange"])(
      "%s navigation stops old work before reads and never inherits an unlocked manual true",
      async (event) => {
        createManager({
          rule: { transOpen: "true", apiSlug: "old-service" },
        }).start();
        const read = pending();
        getTranslationLock.mockReturnValueOnce(read.promise);
        matchRule.mockResolvedValue({
          transOpen: "true",
          apiSlug: "new-service",
          selector: ".new",
        });
        navigate(
          event === "hashchange"
            ? "/lock-test/article-a#/next"
            : "/lock-test/article-b",
          event
        );
        const translator = mockTranslatorInstances[0];
        expect(translator.disable).toHaveBeenCalledTimes(1);
        expect(translator.rule.transOpen).toBe("false");
        expect(translator.disable.mock.invocationCallOrder[0]).toBeLessThan(
          getTranslationLock.mock.invocationCallOrder[0]
        );
        expect(matchRule).not.toHaveBeenCalled();
        read.resolve(false);
        await settle();
        expect(matchRule).toHaveBeenCalledWith(
          window.location.href,
          translator.setting
        );
        expect(translator.rule).toMatchObject({
          transOpen: "false",
          apiSlug: "new-service",
          selector: ".new",
        });
        expect(translator.enable).not.toHaveBeenCalled();
        expect(translator.rescan).toHaveBeenCalledTimes(1);
      }
    );

    test("a locked new URL applies its freshly matched rule before enabling", async () => {
      createManager({ rule: { transOpen: "false" } }).start();
      getTranslationLock.mockResolvedValue(true);
      navigate("/lock-test/article-b");
      await settle();
      const translator = mockTranslatorInstances[0];
      expect(translator.rule.apiSlug).toBe("matched-service");
      expect(translator.rule.transOpen).toBe("true");
      expect(translator.updateRule.mock.invocationCallOrder[0]).toBeLessThan(
        translator.enable.mock.invocationCallOrder[0]
      );
      expect(mockFabInstances[0].getConfig().translationLocked).toBe(true);
    });

    test("new URL plus replaced body keeps the newly matched provider and selector during restart", async () => {
      createManager({
        rule: { transOpen: "true", apiSlug: "old-service", selector: ".old" },
      }).start();
      getTranslationLock.mockResolvedValue(true);
      matchRule.mockResolvedValue({
        transOpen: "false",
        apiSlug: "new-service",
        selector: ".new",
      });
      replaceBody();
      navigate("/lock-test/article-b");
      await settle();
      jest.runOnlyPendingTimers();
      await settle();
      const latest = mockTranslatorInstances.at(-1);
      expect(latest.rule).toMatchObject({
        apiSlug: "new-service",
        selector: ".new",
        transOpen: "true",
      });
      expect(mockTranslatorInstances[0].stop).toHaveBeenCalled();
    });

    test("same-URL body remount preserves the current manual state without reading a lock or rematching", async () => {
      createManager({
        rule: { transOpen: "true", apiSlug: "manual-provider" },
      }).start();
      replaceBody();
      await settle();
      jest.runOnlyPendingTimers();
      expect(mockTranslatorInstances.at(-1).rule).toMatchObject({
        transOpen: "true",
        apiSlug: "manual-provider",
      });
      expect(getTranslationLock).not.toHaveBeenCalled();
      expect(matchRule).not.toHaveBeenCalled();
    });

    test("a locked URL in the blacklist stays stopped and does not match or enable a provider", async () => {
      createManager({
        setting: { blacklist: `${window.location.origin}/lock-test/private*` },
      }).start();
      getTranslationLock.mockResolvedValue(true);
      navigate("/lock-test/private-paper");
      await settle();
      expect(mockTranslatorInstances[0].disable).toHaveBeenCalledTimes(1);
      expect(mockTranslatorInstances[0].enable).not.toHaveBeenCalled();
      expect(mockTranslatorInstances[0].rule.transOpen).toBe("false");
      expect(matchRule).not.toHaveBeenCalled();
    });

    test.each([true, false])(
      "native BFCache restoration reads the latest lock (%s), not the suspended page state",
      async (locked) => {
        createManager({
          rule: { transOpen: locked ? "false" : "true" },
        }).start();
        // Explicitly model browser trust; these synthetic fixtures are not a claim
        // that dispatched page events carry isTrusted in a real browser.
        isTrustedUserEvent.mockReturnValue(true);
        getTranslationLock.mockResolvedValue(locked);
        window.dispatchEvent(
          new PageTransitionEvent("pageshow", { persisted: true })
        );
        await settle();
        expect(getTranslationLock).toHaveBeenCalledTimes(1);
        expect(mockTranslatorInstances[0].rule.transOpen).toBe(String(locked));
        expect(mockTranslatorInstances[0].enable).toHaveBeenCalledTimes(
          locked ? 1 : 0
        );
      }
    );

    test("forged pageshow cannot reread a stored lock and initiate automatic translation", async () => {
      createManager({ rule: { transOpen: "false" } }).start();
      getTranslationLock.mockResolvedValue(true);
      window.dispatchEvent(
        new PageTransitionEvent("pageshow", { persisted: true })
      );
      await settle();
      jest.runOnlyPendingTimers();
      expect(getTranslationLock).not.toHaveBeenCalled();
      expect(mockTranslatorInstances[0].enable).not.toHaveBeenCalled();
    });

    test("a later navigation supersedes a slow older rule lookup", async () => {
      createManager().start();
      const oldRule = pending();
      getTranslationLock.mockResolvedValue(true);
      matchRule
        .mockReturnValueOnce(oldRule.promise)
        .mockResolvedValueOnce({ apiSlug: "latest", transOpen: "false" });
      navigate("/lock-test/article-b");
      await settle();
      navigate("/lock-test/article-c");
      await settle();
      const translator = mockTranslatorInstances[0];
      expect(translator.rule.apiSlug).toBe("latest");
      expect(translator.enable).toHaveBeenCalledTimes(1);
      oldRule.resolve({ apiSlug: "stale", transOpen: "true" });
      await settle();
      expect(translator.rule.apiSlug).toBe("latest");
      expect(translator.enable).toHaveBeenCalledTimes(1);
    });

    test("stop invalidates a pending navigation before it can recreate or enable a runtime", async () => {
      const manager = createManager();
      manager.start();
      const read = pending();
      getTranslationLock.mockReturnValueOnce(read.promise);
      navigate("/lock-test/article-b");
      manager.stop();
      read.resolve(true);
      await settle();
      jest.runOnlyPendingTimers();
      expect(Translator).toHaveBeenCalledTimes(1);
      expect(mockTranslatorInstances[0].enable).not.toHaveBeenCalled();
      expect(manager._translator).toBeNull();
    });

    test("manual stop while a navigation reads the lock prevents automatic revival", async () => {
      createManager().start();
      const read = pending();
      getTranslationLock.mockReturnValueOnce(read.promise);
      navigate("/lock-test/article-b");
      sendRuntimeMessage({ action: "trans-toggle", args: { enabled: false } });
      read.resolve(true);
      await settle();
      expect(mockTranslatorInstances[0].enable).not.toHaveBeenCalled();
      expect(mockTranslatorInstances[0].rule.transOpen).toBe("false");
    });

    test.each([false, true])(
      "a manual enable on the new URL survives its older in-flight rule lookup (replace body: %s)",
      async (bodyChanged) => {
        createManager({
          rule: { transOpen: "false", apiSlug: "old-service" },
        }).start();
        const ruleRead = pending();
        matchRule.mockReturnValueOnce(ruleRead.promise);
        navigate("/lock-test/article-b");
        await settle();
        sendRuntimeMessage({ action: "trans-toggle", args: { enabled: true } });
        expect(mockTranslatorInstances[0].rule.transOpen).toBe("true");
        if (bodyChanged) replaceBody();
        ruleRead.resolve({ transOpen: "false", apiSlug: "new-service" });
        await settle();
        jest.runOnlyPendingTimers();
        await settle();
        expect(mockTranslatorInstances.at(-1).rule).toMatchObject({
          transOpen: "true",
          apiSlug: "new-service",
        });
        expect(mockTranslatorInstances[0].enable).toHaveBeenCalledTimes(1);
      }
    );

    test("an explicit unlock blocks an older navigation read even while persistence is still pending", async () => {
      createManager().start();
      const oldRead = pending();
      const unlockWrite = pending();
      getTranslationLock
        .mockReturnValueOnce(oldRead.promise)
        .mockResolvedValue(false);
      setTranslationLock.mockReturnValueOnce(unlockWrite.promise);
      navigate("/lock-test/article-b");
      const unlocking = internal(false);
      oldRead.resolve(true);
      await settle();
      expect(mockTranslatorInstances[0].enable).not.toHaveBeenCalled();
      unlockWrite.resolve();
      await unlocking;
      expect(mockTranslatorInstances[0].enable).not.toHaveBeenCalled();
      expect(mockFabInstances[0].getConfig().translationLocked).toBe(false);
    });

    test("a queued unlock wins over a slow older lock confirmation without enabling in between", async () => {
      createManager({ rule: { transOpen: "false" } }).start();
      const oldRead = pending();
      getTranslationLock
        .mockReturnValueOnce(oldRead.promise)
        .mockResolvedValue(false);
      const locking = internal(true);
      await settle();
      const unlocking = internal(false);
      await settle();
      expect(setTranslationLock).toHaveBeenCalledTimes(1);
      oldRead.resolve(true);
      await Promise.all([locking, unlocking]);
      expect(setTranslationLock.mock.calls).toEqual([[true], [false]]);
      expect(mockFabInstances[0].getConfig().translationLocked).toBe(false);
      expect(mockTranslatorInstances[0].enable).not.toHaveBeenCalled();
    });

    test("a newer unlock from another tab supersedes an old in-flight save confirmation", async () => {
      createManager({ rule: { transOpen: "false" } }).start();
      const oldRead = pending();
      getTranslationLock.mockReturnValueOnce(oldRead.promise);
      const locking = internal(true);
      await settle();
      expect(setTranslationLock).toHaveBeenCalledWith(true);
      expect(getTranslationLock).toHaveBeenCalledTimes(1);
      storageChange(false);
      oldRead.resolve(true);
      await locking;
      expect(mockFabInstances[0].getConfig().translationLocked).toBe(false);
      expect(mockTranslatorInstances[0].enable).not.toHaveBeenCalled();
    });

    test("lock saving across a URL change applies the latest page policy before any enable", async () => {
      createManager({
        rule: { transOpen: "false", apiSlug: "old-service" },
      }).start();
      const saving = pending();
      setTranslationLock.mockReturnValueOnce(saving.promise);
      getTranslationLock.mockResolvedValue(true);
      const lock = internal(true);
      await settle();
      navigate("/lock-test/article-b");
      await settle();
      expect(mockTranslatorInstances[0].enable).not.toHaveBeenCalled();
      saving.resolve();
      await lock;
      await settle();
      const translator = mockTranslatorInstances[0];
      expect(translator.rule.apiSlug).toBe("matched-service");
      expect(translator.enable).toHaveBeenCalledTimes(1);
      expect(translator.rule.transOpen).toBe("true");
      expect(
        matchRule.mock.calls.every(([url]) => url === window.location.href)
      ).toBe(true);
    });

    test.each([{ isIframe: true }, { transboxOnly: true }])(
      "PDF/iframe context %j cannot persist a lock or automatically enable on navigation",
      async (context) => {
        createManager({ ...context, rule: { transOpen: "false" } }).start();
        const handler = browser.runtime.onMessage.addListener.mock.calls[0][0];
        handler(action(true), trustedSender, jest.fn());
        getTranslationLock.mockResolvedValue(true);
        navigate("/lock-test/article-b");
        await settle();
        expect(setTranslationLock).not.toHaveBeenCalled();
        expect(
          mockTranslatorInstances.every(
            (translator) => translator.enable.mock.calls.length === 0
          )
        ).toBe(true);
      }
    );

    test("plain anchors and same-URL navigation entries do not reset an ongoing translation", async () => {
      createManager().start();
      navigate("/lock-test/article-a#references", "hashchange");
      window.navigation.dispatchEvent(new Event("currententrychange"));
      window.dispatchEvent(new Event("popstate"));
      await settle();
      jest.runOnlyPendingTimers();
      expect(getTranslationLock).not.toHaveBeenCalled();
      expect(matchRule).not.toHaveBeenCalled();
      expect(mockTranslatorInstances[0].disable).not.toHaveBeenCalled();
      expect(mockTranslatorInstances[0].rescan).not.toHaveBeenCalled();
    });
  });
});
