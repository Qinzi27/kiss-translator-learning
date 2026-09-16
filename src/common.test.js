const mockTranslatorManagerStart = jest.fn();
let mockIsIframe = false;

jest.mock("./config", () => ({
  OPT_HIGHLIGHT_WORDS_DISABLE: "-",
}));

jest.mock("./libs/storage", () => ({
  getSettingWithDefault: jest.fn(),
  getFabWithDefault: jest.fn(),
  getWordsWithDefault: jest.fn(),
  runDataMigration: jest.fn(),
}));

jest.mock("./libs/iframe", () => ({
  get isIframe() {
    return mockIsIframe;
  },
}));

jest.mock("./libs/gm", () => ({
  USERSCRIPT_SETTINGS_DISABLED:
    "安全版已停用油猴外置设置页；请使用 Chrome / Edge 扩展。",
  handlePing: jest.fn(),
  injectScript: jest.fn(),
}));

jest.mock("./libs/rules", () => ({
  matchRule: jest.fn(),
}));

jest.mock("./libs/subRules", () => ({
  trySyncAllSubRules: jest.fn(),
}));

jest.mock("./libs/blacklist", () => ({
  isInBlacklist: jest.fn(() => false),
}));

jest.mock("./subtitle/subtitle", () => ({
  runSubtitle: jest.fn(),
}));

jest.mock("./libs/log", () => ({
  logger: {
    setLevel: jest.fn(),
    info: jest.fn(),
  },
}));

jest.mock("./libs/injector", () => ({
  injectInlineJs: jest.fn(),
}));

jest.mock("./libs/translatorManager", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    start: mockTranslatorManagerStart,
  })),
}));

const {
  getSettingWithDefault,
  getFabWithDefault,
  getWordsWithDefault,
  runDataMigration,
} = require("./libs/storage");
const { matchRule } = require("./libs/rules");
const { isInBlacklist } = require("./libs/blacklist");
const { runSubtitle } = require("./subtitle/subtitle");
const { injectInlineJs } = require("./libs/injector");
const TranslatorManager = require("./libs/translatorManager").default;
const { run } = require("./common");

function setReadyState(value) {
  Object.defineProperty(document, "readyState", {
    configurable: true,
    value,
  });
}

function setContentType(value) {
  Object.defineProperty(document, "contentType", {
    configurable: true,
    value,
  });
}

function expectNoNormalUserscriptStartup() {
  expect(runDataMigration).not.toHaveBeenCalled();
  expect(getSettingWithDefault).not.toHaveBeenCalled();
  expect(matchRule).not.toHaveBeenCalled();
  expect(TranslatorManager).not.toHaveBeenCalled();
}

describe("common iframe startup", () => {
  const initialTestHref = window.location.href;
  const originalOptionsPage = process.env.REACT_APP_OPTIONSPAGE;
  const originalOptionsPageDev = process.env.REACT_APP_OPTIONSPAGE_DEV;
  const originalOptionsPageLocal = process.env.REACT_APP_OPTIONSPAGE_LOCAL;

  beforeEach(() => {
    window.history.replaceState({}, "", initialTestHref);
    document.documentElement.innerHTML = "<head></head><body></body>";
    setReadyState("complete");
    setContentType("text/html");
    mockIsIframe = false;
    process.env.REACT_APP_OPTIONSPAGE = "https://kiss.example/options.html";
    process.env.REACT_APP_OPTIONSPAGE_DEV =
      "https://kiss-dev.example/options.html";
    process.env.REACT_APP_OPTIONSPAGE_LOCAL =
      "http://localhost:3000/options.html";
    delete globalThis.unsafeWindow;
    jest.clearAllMocks();
    isInBlacklist.mockImplementation(() => false);

    TranslatorManager.mockImplementation(() => ({
      start: mockTranslatorManagerStart,
    }));
    getSettingWithDefault.mockResolvedValue({
      blacklist: "",
      tranboxSetting: { blacklist: "", transOpen: true },
      inputRule: { blacklist: "", transOpen: true },
      mouseHoverSetting: { blacklist: "", useMouseHover: true },
      logLevel: 1,
    });
    getFabWithDefault.mockResolvedValue({ isHide: false });
    getWordsWithDefault.mockResolvedValue({});
    runDataMigration.mockResolvedValue();
    matchRule.mockResolvedValue({
      transOpen: "true",
      highlightWords: "-",
    });
  });

  afterEach(() => {
    window.history.replaceState({}, "", initialTestHref);
    if (originalOptionsPage === undefined) {
      delete process.env.REACT_APP_OPTIONSPAGE;
    } else {
      process.env.REACT_APP_OPTIONSPAGE = originalOptionsPage;
    }
    if (originalOptionsPageDev === undefined) {
      delete process.env.REACT_APP_OPTIONSPAGE_DEV;
    } else {
      process.env.REACT_APP_OPTIONSPAGE_DEV = originalOptionsPageDev;
    }
    if (originalOptionsPageLocal === undefined) {
      delete process.env.REACT_APP_OPTIONSPAGE_LOCAL;
    } else {
      process.env.REACT_APP_OPTIONSPAGE_LOCAL = originalOptionsPageLocal;
    }
    delete globalThis.unsafeWindow;
  });

  test("starts translator manager for iframe with text", async () => {
    mockIsIframe = true;
    document.body.innerHTML = "<main>Hello iframe</main>";

    await run();

    expect(matchRule).toHaveBeenCalledTimes(1);
    expect(TranslatorManager).toHaveBeenCalledTimes(1);
    expect(mockTranslatorManagerStart).toHaveBeenCalledTimes(1);
    expect(runSubtitle).not.toHaveBeenCalled();
  });

  test.each([undefined, false, "true", 1, {}, [true]])(
    "a new top-level page ignores a legacy auto-start rule without a strict local lock (%j)",
    async (translationLocked) => {
      const savedRule = {
        transOpen: "true",
        highlightWords: "-",
        selector: "article p",
      };
      matchRule.mockResolvedValue(savedRule);
      getFabWithDefault.mockResolvedValue({ isHide: false, translationLocked });
      await run();
      expect(TranslatorManager.mock.calls[0][0].rule).toMatchObject({
        transOpen: "false",
        selector: "article p",
      });
      expect(savedRule.transOpen).toBe("true");
    }
  );

  test.each(["true", "false"])(
    "an explicit lock enables a new top-level page regardless of the saved rule %s",
    async (transOpen) => {
      matchRule.mockResolvedValue({ transOpen, highlightWords: "-" });
      getFabWithDefault.mockResolvedValue({
        isHide: false,
        translationLocked: true,
      });
      await run();
      expect(TranslatorManager.mock.calls[0][0].rule.transOpen).toBe("true");
      expect(TranslatorManager.mock.calls[0][0].transboxOnly).toBe(false);
    }
  );

  test("a global lock cannot automatically start translation inside an iframe", async () => {
    mockIsIframe = true;
    document.body.innerHTML = "<article>Public synthetic iframe text</article>";
    getFabWithDefault.mockResolvedValue({ translationLocked: true });
    await run();
    expect(TranslatorManager.mock.calls[0][0]).toMatchObject({
      isIframe: true,
      rule: { transOpen: "false" },
    });
    expect(mockTranslatorManagerStart).toHaveBeenCalledTimes(1);
  });

  test("PDF stays transbox-only with automatic translation disabled even when locked", async () => {
    setContentType("application/pdf");
    getFabWithDefault.mockResolvedValue({ translationLocked: true });
    await run();
    expect(TranslatorManager.mock.calls[0][0]).toMatchObject({
      transboxOnly: true,
      rule: { transOpen: "false" },
    });
    expect(runSubtitle).not.toHaveBeenCalled();
  });

  test("the global blacklist blocks startup before reading the local lock", async () => {
    getSettingWithDefault.mockResolvedValue({
      blacklist: "blocked.example",
      logLevel: 1,
    });
    getFabWithDefault.mockResolvedValue({ translationLocked: true });
    isInBlacklist.mockImplementation(
      (_href, blacklist) => blacklist === "blocked.example"
    );
    await run();
    expect(TranslatorManager).not.toHaveBeenCalled();
    expect(matchRule).not.toHaveBeenCalled();
    expect(getFabWithDefault).not.toHaveBeenCalled();
  });

  test("navigation during the initial settings read uses the current URL blacklist", async () => {
    window.history.replaceState({}, "", "/allowed");
    getSettingWithDefault.mockImplementationOnce(async () => {
      window.history.replaceState({}, "", "/blocked");
      return { blacklist: "global-block", logLevel: 1 };
    });
    getFabWithDefault.mockResolvedValue({ translationLocked: true });
    isInBlacklist.mockImplementation(
      (href, list) =>
        list === "global-block" && new URL(href).pathname === "/blocked"
    );

    await run();

    expect(matchRule).not.toHaveBeenCalled();
    expect(getFabWithDefault).not.toHaveBeenCalled();
    expect(TranslatorManager).not.toHaveBeenCalled();
    expect(runSubtitle).not.toHaveBeenCalled();
  });

  test.each(["rules", "words", "fab"])(
    "a move to a blacklisted URL while awaiting %s never starts the stale allowed page",
    async (stage) => {
      window.history.replaceState({}, "", "/allowed");
      getSettingWithDefault.mockResolvedValue({
        blacklist: "global-block",
        logLevel: 1,
      });
      isInBlacklist.mockImplementation(
        (href, list) =>
          list === "global-block" && new URL(href).pathname === "/blocked"
      );
      const rule = {
        transOpen: "true",
        highlightWords: "all",
        selector: "article",
      };
      matchRule.mockResolvedValue(rule);
      getFabWithDefault.mockResolvedValue({ translationLocked: true });
      const navigate = (value) => async () => {
        window.history.replaceState({}, "", "/blocked");
        return value;
      };
      if (stage === "rules") matchRule.mockImplementationOnce(navigate(rule));
      if (stage === "words")
        getWordsWithDefault.mockImplementationOnce(navigate({ synthetic: {} }));
      if (stage === "fab")
        getFabWithDefault.mockImplementationOnce(
          navigate({ translationLocked: true })
        );

      await run();

      expect(matchRule).toHaveBeenCalledTimes(1);
      expect(TranslatorManager).not.toHaveBeenCalled();
      expect(mockTranslatorManagerStart).not.toHaveBeenCalled();
      expect(runSubtitle).not.toHaveBeenCalled();
    }
  );

  test("recomputes component blacklists from clean preferences and matches the eventual URL", async () => {
    window.history.replaceState({}, "", "/old-page");
    const setting = {
      blacklist: "",
      tranboxSetting: { blacklist: "old-page", transOpen: true },
      inputRule: { blacklist: "new-page", transOpen: true },
      mouseHoverSetting: { blacklist: "new-page", useMouseHover: true },
      logLevel: 1,
    };
    getSettingWithDefault.mockResolvedValue(setting);
    isInBlacklist.mockImplementation(
      (href, list) => Boolean(list) && new URL(href).pathname === `/${list}`
    );
    matchRule
      .mockImplementationOnce(async (_href, candidate) => {
        expect(candidate.tranboxSetting.transOpen).toBe(false);
        window.history.replaceState({}, "", "/new-page");
        return { transOpen: "true", selector: ".stale", highlightWords: "-" };
      })
      .mockResolvedValue({
        transOpen: "false",
        selector: ".current",
        highlightWords: "-",
      });
    getFabWithDefault.mockResolvedValue({
      isHide: false,
      translationLocked: true,
      hideExceptionList: "new-page",
    });

    await run();

    expect(matchRule).toHaveBeenCalledTimes(2);
    expect(matchRule.mock.calls[1][0]).toBe(window.location.href);
    expect(TranslatorManager).toHaveBeenCalledTimes(1);
    expect(TranslatorManager.mock.calls[0][0]).toMatchObject({
      rule: { selector: ".current", transOpen: "true" },
      setting: {
        tranboxSetting: { transOpen: true },
        inputRule: { transOpen: false },
        mouseHoverSetting: { useMouseHover: false },
      },
      fabConfig: { isHide: true },
    });
    expect(setting.tranboxSetting.transOpen).toBe(true);
    expect(setting.inputRule.transOpen).toBe(true);
    expect(setting.mouseHoverSetting.useMouseHover).toBe(true);
    expect(runSubtitle.mock.calls[0][0].href).toBe(window.location.href);
  });

  test("a URL change during the final FAB read discards old rules and vocabulary before starting", async () => {
    window.history.replaceState({}, "", "/first");
    matchRule.mockImplementation(async (href) => ({
      selector: new URL(href).pathname === "/first" ? ".first" : ".second",
      highlightWords: "all",
    }));
    getWordsWithDefault
      .mockResolvedValueOnce({ first: {} })
      .mockResolvedValueOnce({ second: {} });
    getFabWithDefault
      .mockImplementationOnce(async () => {
        window.history.replaceState({}, "", "/second");
        return { translationLocked: true };
      })
      .mockResolvedValue({ translationLocked: false });

    await run();

    expect(matchRule).toHaveBeenCalledTimes(2);
    expect(getFabWithDefault).toHaveBeenCalledTimes(2);
    expect(TranslatorManager).toHaveBeenCalledTimes(1);
    expect(TranslatorManager.mock.calls[0][0]).toMatchObject({
      rule: { selector: ".second", transOpen: "false" },
      favWords: ["second"],
    });
    expect(runSubtitle.mock.calls[0][0].href).toBe(window.location.href);
  });

  test("repeated navigation safely abandons startup after a bounded number of attempts", async () => {
    let navigation = 0;
    matchRule.mockImplementation(async () => {
      window.history.replaceState({}, "", `/moving-${++navigation}`);
      return { transOpen: "true", highlightWords: "-" };
    });
    getFabWithDefault.mockResolvedValue({ translationLocked: true });

    await run();

    expect(matchRule).toHaveBeenCalledTimes(4);
    expect(getFabWithDefault).not.toHaveBeenCalled();
    expect(TranslatorManager).not.toHaveBeenCalled();
    expect(runSubtitle).not.toHaveBeenCalled();
  });

  test("an iframe navigation while waiting for its DOM cannot bypass the new URL blacklist", async () => {
    mockIsIframe = true;
    window.history.replaceState({}, "", "/allowed");
    setReadyState("loading");
    getSettingWithDefault.mockResolvedValue({
      blacklist: "global-block",
      logLevel: 1,
    });
    isInBlacklist.mockImplementation(
      (href, list) =>
        list === "global-block" && new URL(href).pathname === "/blocked"
    );
    const running = run();
    await Promise.resolve();
    window.history.replaceState({}, "", "/blocked");
    document.body.innerHTML = "<p>Synthetic iframe article</p>";
    setReadyState("interactive");
    document.dispatchEvent(new Event("DOMContentLoaded"));
    await running;
    expect(matchRule).not.toHaveBeenCalled();
    expect(TranslatorManager).not.toHaveBeenCalled();
  });

  test("skips empty iframe before rule matching and manager startup", async () => {
    mockIsIframe = true;
    document.body.innerHTML = `
      <script>const text = "ignored";</script>
      <style>.ignored { color: red; }</style>
      <textarea>ignored</textarea>
    `;

    await run();

    expect(matchRule).not.toHaveBeenCalled();
    expect(TranslatorManager).not.toHaveBeenCalled();
    expect(mockTranslatorManagerStart).not.toHaveBeenCalled();
  });

  test("waits for DOMContentLoaded before skipping loading iframe", async () => {
    mockIsIframe = true;
    setReadyState("loading");

    const running = run();
    await Promise.resolve();

    document.body.innerHTML = "<p>Late iframe text</p>";
    setReadyState("interactive");
    document.dispatchEvent(new Event("DOMContentLoaded"));

    await running;

    expect(matchRule).toHaveBeenCalledTimes(1);
    expect(TranslatorManager).toHaveBeenCalledTimes(1);
    expect(mockTranslatorManagerStart).toHaveBeenCalledTimes(1);
  });

  test("does not apply empty-text gate to top-level pages", async () => {
    mockIsIframe = false;

    await run();

    expect(matchRule).toHaveBeenCalledTimes(1);
    expect(TranslatorManager).toHaveBeenCalledTimes(1);
    expect(mockTranslatorManagerStart).toHaveBeenCalledTimes(1);
    expect(runSubtitle).toHaveBeenCalledTimes(1);
  });

  test("inverts the FAB visibility when the top-level page matches its exception list", async () => {
    getFabWithDefault.mockResolvedValue({
      isHide: false,
      hideExceptionList: "kiss.example",
    });
    isInBlacklist.mockImplementation(
      (_href, blacklist) => blacklist === "kiss.example"
    );

    await run();

    expect(TranslatorManager.mock.calls[0][0].fabConfig).toEqual({
      isHide: true,
      hideExceptionList: "kiss.example",
    });
  });

  test("shows the FAB when a hidden global setting matches its exception list", async () => {
    getFabWithDefault.mockResolvedValue({
      isHide: true,
      hideExceptionList: "kiss.example",
    });
    isInBlacklist.mockImplementation(
      (_href, blacklist) => blacklist === "kiss.example"
    );

    await run();

    expect(TranslatorManager.mock.calls[0][0].fabConfig.isHide).toBe(false);
  });

  test("starts transbox-only manager for PDF documents", async () => {
    setContentType("application/pdf");

    await run();

    expect(matchRule).toHaveBeenCalledTimes(1);
    expect(TranslatorManager).toHaveBeenCalledTimes(1);
    expect(TranslatorManager.mock.calls[0][0].transboxOnly).toBe(true);
    expect(mockTranslatorManagerStart).toHaveBeenCalledTimes(1);
    expect(runSubtitle).not.toHaveBeenCalled();
  });

  test("skips non-PDF media documents before rule matching and manager startup", async () => {
    setContentType("image/png");

    await run();

    expect(matchRule).not.toHaveBeenCalled();
    expect(TranslatorManager).not.toHaveBeenCalled();
    expect(mockTranslatorManagerStart).not.toHaveBeenCalled();
    expect(runSubtitle).not.toHaveBeenCalled();
  });

  test("creates legacy userscript GM shim before data migration", async () => {
    const originalGM = globalThis.GM;
    const originalGMGetValue = globalThis.GM_getValue;
    const originalGMXmlhttpRequest = globalThis.GM_xmlhttpRequest;
    const legacyGetValue = jest.fn();
    const legacyXmlhttpRequest = jest.fn();
    let gmDuringMigration;

    delete globalThis.GM;
    globalThis.GM_getValue = legacyGetValue;
    globalThis.GM_xmlhttpRequest = legacyXmlhttpRequest;
    runDataMigration.mockImplementation(async () => {
      gmDuringMigration = globalThis.GM;
    });

    try {
      await run(true);

      expect(runDataMigration).toHaveBeenCalledTimes(1);
      expect(gmDuringMigration).toBeDefined();
      expect(gmDuringMigration.getValue).toBe(legacyGetValue);
      expect(gmDuringMigration.xmlHttpRequest).toBe(legacyXmlhttpRequest);
    } finally {
      if (originalGM === undefined) {
        delete globalThis.GM;
      } else {
        globalThis.GM = originalGM;
      }
      if (originalGMGetValue === undefined) {
        delete globalThis.GM_getValue;
      } else {
        globalThis.GM_getValue = originalGMGetValue;
      }
      if (originalGMXmlhttpRequest === undefined) {
        delete globalThis.GM_xmlhttpRequest;
      } else {
        globalThis.GM_xmlhttpRequest = originalGMXmlhttpRequest;
      }
    }
  });

  test("fills missing fields on existing userscript GM object", async () => {
    const originalGM = globalThis.GM;
    const originalGMXmlhttpRequest = globalThis.GM_xmlhttpRequest;
    const existingSetValue = jest.fn();
    const legacyXmlhttpRequest = jest.fn();
    let gmDuringMigration;

    globalThis.GM = { setValue: existingSetValue };
    globalThis.GM_xmlhttpRequest = legacyXmlhttpRequest;
    runDataMigration.mockImplementation(async () => {
      gmDuringMigration = globalThis.GM;
    });

    try {
      await run(true);

      expect(runDataMigration).toHaveBeenCalledTimes(1);
      expect(gmDuringMigration.setValue).toBe(existingSetValue);
      expect(gmDuringMigration.xmlHttpRequest).toBe(legacyXmlhttpRequest);
    } finally {
      if (originalGM === undefined) {
        delete globalThis.GM;
      } else {
        globalThis.GM = originalGM;
      }
      if (originalGMXmlhttpRequest === undefined) {
        delete globalThis.GM_xmlhttpRequest;
      } else {
        globalThis.GM_xmlhttpRequest = originalGMXmlhttpRequest;
      }
    }
  });

  test("does not replace existing GM xmlHttpRequest", async () => {
    const originalGM = globalThis.GM;
    const originalGMXmlhttpRequest = globalThis.GM_xmlhttpRequest;
    const existingXmlhttpRequest = jest.fn();
    const legacyXmlhttpRequest = jest.fn();
    let gmDuringMigration;

    globalThis.GM = { xmlHttpRequest: existingXmlhttpRequest };
    globalThis.GM_xmlhttpRequest = legacyXmlhttpRequest;
    runDataMigration.mockImplementation(async () => {
      gmDuringMigration = globalThis.GM;
    });

    try {
      await run(true);

      expect(runDataMigration).toHaveBeenCalledTimes(1);
      expect(gmDuringMigration.xmlHttpRequest).toBe(existingXmlhttpRequest);
    } finally {
      if (originalGM === undefined) {
        delete globalThis.GM;
      } else {
        globalThis.GM = originalGM;
      }
      if (originalGMXmlhttpRequest === undefined) {
        delete globalThis.GM_xmlhttpRequest;
      } else {
        globalThis.GM_xmlhttpRequest = originalGMXmlhttpRequest;
      }
    }
  });

  test("does not export a bridge when unsafeWindow is unavailable", async () => {
    const originalHref = window.location.href;
    window.history.pushState({}, "", "/options.html");
    process.env.REACT_APP_OPTIONSPAGE = window.location.href;
    globalThis.GM = {
      info: {
        script: {
          grant: ["unsafeWindow"],
        },
      },
    };

    try {
      await run(true);

      expect(injectInlineJs).not.toHaveBeenCalled();
      expect(
        document.querySelector("#KISS-Translator-Message").textContent
      ).toContain("已停用油猴外置设置页");
      expect(require("./libs/gm").handlePing).not.toHaveBeenCalled();
      expectNoNormalUserscriptStartup();
    } finally {
      window.history.pushState({}, "", originalHref);
      delete globalThis.GM;
    }
  });

  test("does not expose GM even when unsafeWindow is available", async () => {
    const originalHref = window.location.href;
    const gm = {
      info: {
        script: {
          grant: ["unsafeWindow"],
        },
      },
    };
    window.history.pushState({}, "", "/options.html");
    process.env.REACT_APP_OPTIONSPAGE = window.location.href;
    globalThis.GM = gm;
    globalThis.unsafeWindow = {};

    try {
      await run(true);

      expect(globalThis.unsafeWindow.GM).toBeUndefined();
      expect(globalThis.unsafeWindow.APP_INFO).toBeUndefined();
      expect(
        document.querySelector("#KISS-Translator-Message").textContent
      ).toContain("Chrome / Edge");
      expect(injectInlineJs).not.toHaveBeenCalled();
      expectNoNormalUserscriptStartup();
    } finally {
      window.history.pushState({}, "", originalHref);
      delete globalThis.GM;
    }
  });

  test("does not export a bridge when GM grant metadata is missing", async () => {
    const originalHref = window.location.href;
    window.history.pushState({}, "", "/options.html");
    process.env.REACT_APP_OPTIONSPAGE = window.location.href;
    globalThis.GM = { info: {} };

    try {
      await run(true);

      expect(injectInlineJs).not.toHaveBeenCalled();
      expect(
        document.querySelector("#KISS-Translator-Message").textContent
      ).toContain("已停用油猴外置设置页");
      expect(require("./libs/gm").handlePing).not.toHaveBeenCalled();
      expectNoNormalUserscriptStartup();
    } finally {
      window.history.pushState({}, "", originalHref);
      delete globalThis.GM;
    }
  });

  test("blocks the dev userscript options bridge", async () => {
    const originalHref = window.location.href;
    window.history.pushState({}, "", "/options");
    process.env.REACT_APP_OPTIONSPAGE_DEV = window.location.href;
    globalThis.GM = { info: {} };

    try {
      await run(true);

      expect(injectInlineJs).not.toHaveBeenCalled();
      expect(
        document.querySelector("#KISS-Translator-Message").textContent
      ).toContain("已停用油猴外置设置页");
      expect(require("./libs/gm").handlePing).not.toHaveBeenCalled();
      expectNoNormalUserscriptStartup();
    } finally {
      window.history.pushState({}, "", originalHref);
      delete globalThis.GM;
    }
  });

  test("blocks the local userscript options bridge", async () => {
    const originalHref = window.location.href;
    window.history.pushState({}, "", "/options.html");
    process.env.REACT_APP_OPTIONSPAGE_LOCAL = window.location.href;
    globalThis.GM = { info: {} };

    try {
      await run(true);

      expect(injectInlineJs).not.toHaveBeenCalled();
      expect(
        document.querySelector("#KISS-Translator-Message").textContent
      ).toContain("已停用油猴外置设置页");
      expect(require("./libs/gm").handlePing).not.toHaveBeenCalled();
      expectNoNormalUserscriptStartup();
    } finally {
      window.history.pushState({}, "", originalHref);
      delete globalThis.GM;
    }
  });
});
