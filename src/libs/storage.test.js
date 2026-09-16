import {
  STOKEY_SETTING,
  STOKEY_FAB,
  STOKEY_TRANSLATION_LOCK,
  STOKEY_SETTING_BACKUP_V1_BEFORE_V2,
  SETTINGS_VERSION_V2,
  SETTINGS_VERSION_V3,
  DEFAULT_SUBTITLE_SETTING,
  DEFAULT_FAB,
  OPT_TRANS_DEEPSEEK,
  OPT_TRANS_OPENAI,
  OPT_TRANS_TENCENT,
} from "../config";
import {
  getFabWithDefault,
  getTranslationLock,
  setTranslationLock,
  setFab,
  putFab,
  getSettingWithDefault,
  runDataMigration,
  tryInitDefaultData,
} from "./storage";

// 存储测试不涉及流式解析，隔离 ESM-only 依赖以免 Jest 27 在加载阶段失败。
jest.mock("@streamparser/json", () => ({ JSONParser: jest.fn() }));
// jsdom 并非扩展页面，使用空实现避免 webextension-polyfill 在模块初始化时主动抛错。
jest.mock("webextension-polyfill", () => ({}));

const readStoredJson = (key) => JSON.parse(window.localStorage.getItem(key));

function loadGmStorageModule() {
  let storageModule;
  jest.isolateModules(() => {
    jest.doMock("./client", () => ({
      isExt: false,
      isGm: true,
    }));
    storageModule = require("./storage");
  });
  jest.dontMock("./client");
  return storageModule;
}

describe("settings storage migration", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete window.KISS_GM;
    delete globalThis.GM;
    delete globalThis.GM_setValue;
    delete globalThis.GM_getValue;
    delete globalThis.GM_deleteValue;
  });

  afterEach(() => {
    delete globalThis.GM;
    delete globalThis.GM_setValue;
    delete globalThis.GM_getValue;
    delete globalThis.GM_deleteValue;
  });

  test("fresh installations show the FAB and translate on a single click", async () => {
    await expect(getFabWithDefault()).resolves.toMatchObject({
      isHide: false,
      fabClickAction: 1,
      hideExceptionList: "",
      translationLocked: false,
    });
  });

  test("the translation lock persists under its own key and overrides stale FAB values", async () => {
    window.localStorage.setItem(
      STOKEY_FAB,
      JSON.stringify({ translationLocked: true, x: 12 })
    );
    await expect(getTranslationLock()).resolves.toBe(false);
    await expect(getFabWithDefault()).resolves.toMatchObject({
      translationLocked: false,
      x: 12,
    });
    await setTranslationLock(true);
    expect(readStoredJson(STOKEY_TRANSLATION_LOCK)).toEqual({ enabled: true });
    window.localStorage.setItem(
      STOKEY_FAB,
      JSON.stringify({ translationLocked: false, x: 13 })
    );
    await expect(getTranslationLock()).resolves.toBe(true);
    await expect(getFabWithDefault()).resolves.toMatchObject({
      translationLocked: true,
      x: 13,
    });
    await setTranslationLock(false);
    expect(readStoredJson(STOKEY_TRANSLATION_LOCK)).toEqual({ enabled: false });
    await expect(getTranslationLock()).resolves.toBe(false);
  });

  test.each([
    null,
    true,
    false,
    "true",
    1,
    [],
    [true],
    {},
    { enabled: "true" },
    { enabled: 1 },
    { enabled: {} },
  ])(
    "malformed translation lock %j cannot authorize a new page",
    async (value) => {
      window.localStorage.setItem(
        STOKEY_TRANSLATION_LOCK,
        JSON.stringify(value)
      );
      window.localStorage.setItem(
        STOKEY_FAB,
        JSON.stringify({ translationLocked: true })
      );
      await expect(getTranslationLock()).resolves.toBe(false);
      await expect(getFabWithDefault()).resolves.toHaveProperty(
        "translationLocked",
        false
      );
    }
  );

  test.each([undefined, null, "true", "false", 0, 1, {}, []])(
    "the lock setter rejects a non-boolean %j without changing the stored lock",
    async (value) => {
      await setTranslationLock(false);
      await expect(setTranslationLock(value)).rejects.toThrow(TypeError);
      expect(readStoredJson(STOKEY_TRANSLATION_LOCK)).toEqual({
        enabled: false,
      });
    }
  );

  test("FAB dragging and color writes cannot grant or revoke the independent lock", async () => {
    await putFab({ x: 15, translationLocked: true });
    expect(readStoredJson(STOKEY_FAB)).toEqual({ x: 15 });
    expect(readStoredJson(STOKEY_TRANSLATION_LOCK)).toBeNull();
    await expect(getTranslationLock()).resolves.toBe(false);

    await setTranslationLock(true);
    await putFab({ y: 20, busyColor: "#123456", translationLocked: false });
    expect(readStoredJson(STOKEY_FAB)).toEqual({
      x: 15,
      y: 20,
      busyColor: "#123456",
    });
    await expect(getTranslationLock()).resolves.toBe(true);

    const staleAppearance = await getFabWithDefault();
    await setTranslationLock(false);
    await setFab({ ...staleAppearance, idleColor: "#654321" });
    expect(readStoredJson(STOKEY_FAB)).not.toHaveProperty("translationLocked");
    await expect(getFabWithDefault()).resolves.toMatchObject({
      translationLocked: false,
      idleColor: "#654321",
    });
  });

  test("a FAB patch also removes a legacy lock field without touching authorization", async () => {
    window.localStorage.setItem(
      STOKEY_FAB,
      JSON.stringify({ translationLocked: true, x: 7 })
    );
    await putFab({ y: 11 });
    expect(readStoredJson(STOKEY_FAB)).toEqual({ x: 7, y: 11 });
    await expect(getTranslationLock()).resolves.toBe(false);
  });

  test("fresh installation keeps the Chinese UI default even when the browser reports English", async () => {
    // onInstalled historically passes the browser UI language to this initializer.
    await tryInitDefaultData("en");
    expect(readStoredJson(STOKEY_SETTING).uiLang).toBe("zh");
  });

  test("initialization preserves an existing language and offline preference exactly", async () => {
    const savedSetting = {
      version: SETTINGS_VERSION_V3,
      uiLang: "ja",
      networkPolicy: "offline",
      customPreference: "keep",
    };
    window.localStorage.setItem(STOKEY_SETTING, JSON.stringify(savedSetting));
    await tryInitDefaultData("en");
    expect(readStoredJson(STOKEY_SETTING)).toEqual(savedSetting);
  });

  test("fills missing FAB preferences while keeping the saved position", async () => {
    const savedFab = { x: 0, y: 120, edge: "left" };
    window.localStorage.setItem(STOKEY_FAB, JSON.stringify(savedFab));

    await expect(getFabWithDefault()).resolves.toMatchObject({
      ...savedFab,
      fabClickAction: 1,
    });
    expect(readStoredJson(STOKEY_FAB)).toEqual(savedFab);
  });

  test("preserves an existing FAB menu preference instead of applying the new default", async () => {
    const savedFab = {
      fabClickAction: 0,
      isHide: true,
      hideExceptionList: "example.com",
    };
    window.localStorage.setItem(STOKEY_FAB, JSON.stringify(savedFab));

    await expect(getFabWithDefault()).resolves.toEqual({
      ...DEFAULT_FAB,
      ...savedFab,
    });
    expect(readStoredJson(STOKEY_FAB)).toEqual(savedFab);
  });

  test("runDataMigration backs up raw v1 settings and stores current settings", async () => {
    const oldSetting = {
      uiLang: "zh-CN",
      transApis: [
        {
          apiSlug: "openai",
          apiName: "OpenAI",
          systemPrompt: "custom batch prompt",
        },
      ],
    };
    window.localStorage.setItem(STOKEY_SETTING, JSON.stringify(oldSetting));

    await runDataMigration();

    const backup = readStoredJson(STOKEY_SETTING_BACKUP_V1_BEFORE_V2);
    const stored = readStoredJson(STOKEY_SETTING);

    expect(backup).toEqual(oldSetting);
    expect(stored.version).toBe(SETTINGS_VERSION_V3);
    expect(stored.transApis[0].batchPromptSlug).toMatch(
      /^prompt_migrated_batch_/
    );
    expect(stored.transApis[0]).not.toHaveProperty("systemPrompt");
  });

  test("getSettingWithDefault returns current settings for stored v1 data", async () => {
    const oldSetting = {
      uiLang: "zh",
      transApis: [
        {
          apiSlug: "openai",
          apiName: "OpenAI",
          systemPrompt: "custom batch prompt",
        },
      ],
    };
    window.localStorage.setItem(STOKEY_SETTING, JSON.stringify(oldSetting));

    const setting = await getSettingWithDefault();

    expect(setting.version).toBe(SETTINGS_VERSION_V3);
    expect(setting.transApis[0].batchPromptSlug).toMatch(
      /^prompt_migrated_batch_/
    );
    expect(setting.transApis[0]).not.toHaveProperty("systemPrompt");
  });

  test("merges the language variant default without overriding an explicit choice", async () => {
    window.localStorage.setItem(
      STOKEY_SETTING,
      JSON.stringify({ version: SETTINGS_VERSION_V3, uiLang: "zh" })
    );
    await expect(getSettingWithDefault()).resolves.toMatchObject({
      translateVariants: true,
    });

    window.localStorage.setItem(
      STOKEY_SETTING,
      JSON.stringify({
        version: SETTINGS_VERSION_V3,
        translateVariants: false,
      })
    );
    await expect(getSettingWithDefault()).resolves.toMatchObject({
      translateVariants: false,
    });
  });

  test("keeps clipboard auto-translation opt-in for existing settings", async () => {
    window.localStorage.setItem(
      STOKEY_SETTING,
      JSON.stringify({ version: SETTINGS_VERSION_V3, uiLang: "zh" })
    );
    await expect(getSettingWithDefault()).resolves.toMatchObject({
      autoTranslateClipboard: false,
    });

    window.localStorage.setItem(
      STOKEY_SETTING,
      JSON.stringify({
        version: SETTINGS_VERSION_V3,
        autoTranslateClipboard: true,
      })
    );
    await expect(getSettingWithDefault()).resolves.toMatchObject({
      autoTranslateClipboard: true,
    });
  });

  test("does not replace explicitly stored Tencent entry points", async () => {
    window.localStorage.setItem(
      STOKEY_SETTING,
      JSON.stringify({
        version: SETTINGS_VERSION_V3,
        inputRule: { apiSlug: OPT_TRANS_TENCENT },
        tranboxSetting: { apiSlugs: [OPT_TRANS_TENCENT] },
        subtitleSetting: { apiSlug: OPT_TRANS_TENCENT },
      })
    );

    await expect(getSettingWithDefault()).resolves.toMatchObject({
      inputRule: { apiSlug: OPT_TRANS_TENCENT },
      tranboxSetting: { apiSlugs: [OPT_TRANS_TENCENT] },
      subtitleSetting: { apiSlug: OPT_TRANS_TENCENT },
    });
  });

  test("keeps an explicitly stored subtitle chunk length", async () => {
    // 新默认值只影响新配置；已有用户明确保存的 2000 不应被默认设置覆盖。
    expect(DEFAULT_SUBTITLE_SETTING.chunkLength).toBe(1000);
    window.localStorage.setItem(
      STOKEY_SETTING,
      JSON.stringify({
        version: SETTINGS_VERSION_V2,
        subtitleSetting: { chunkLength: 2000 },
      })
    );

    const setting = await getSettingWithDefault();

    expect(setting.subtitleSetting.chunkLength).toBe(2000);
  });

  test("normalizes legacy default thinking effort only in the loaded setting", async () => {
    const storedSetting = {
      version: SETTINGS_VERSION_V3,
      transApis: [
        {
          apiSlug: "openai",
          apiType: OPT_TRANS_OPENAI,
          model: "gpt-5.6-sol",
          thinkingMode: "enabled",
          thinkingEffort: "_default",
        },
      ],
    };
    window.localStorage.setItem(STOKEY_SETTING, JSON.stringify(storedSetting));

    const setting = await getSettingWithDefault();

    expect(setting.transApis[0].thinkingEffort).toBeNull();
    expect(readStoredJson(STOKEY_SETTING)).toEqual(storedSetting);
  });

  test("normalizes thinking settings for a fresh installation", async () => {
    const setting = await getSettingWithDefault();
    const deepseek = setting.transApis.find(
      (api) => api.apiType === OPT_TRANS_DEEPSEEK
    );

    expect(deepseek).toMatchObject({
      thinkingMode: "disabled",
      thinkingEffort: null,
    });
  });

  test("GM storage reports a clear error when GM APIs are unavailable", async () => {
    const { storage } = loadGmStorageModule();

    await expect(storage.get("missing-gm")).rejects.toThrow(
      "GM API is not available"
    );
  });

  test("GM storage uses KISS_GM when it is available", async () => {
    const stored = new Map();
    window.KISS_GM = {
      setValue: jest.fn(async (key, value) => stored.set(key, value)),
      getValue: jest.fn(async (key) => stored.get(key)),
      deleteValue: jest.fn(async (key) => stored.delete(key)),
    };
    globalThis.GM = {
      setValue: jest.fn(),
      getValue: jest.fn(),
      deleteValue: jest.fn(),
    };
    const { storage } = loadGmStorageModule();

    await storage.setObj("gm-key", { local: true });
    await expect(storage.getObj("gm-key")).resolves.toEqual({ local: true });
    await storage.del("gm-key");

    expect(window.KISS_GM.setValue).toHaveBeenCalledWith(
      "gm-key",
      JSON.stringify({ local: true })
    );
    expect(window.KISS_GM.getValue).toHaveBeenCalledWith("gm-key");
    expect(window.KISS_GM.deleteValue).toHaveBeenCalledWith("gm-key");
    expect(globalThis.GM.setValue).not.toHaveBeenCalled();
    expect(globalThis.GM.getValue).not.toHaveBeenCalled();
    expect(globalThis.GM.deleteValue).not.toHaveBeenCalled();
    expect(stored.has("gm-key")).toBe(false);
  });

  test("GM storage uses native GM storage APIs without KISS_GM", async () => {
    const stored = new Map();
    globalThis.GM = {
      setValue: jest.fn(async (key, value) => stored.set(key, value)),
      getValue: jest.fn(async (key) => stored.get(key)),
      deleteValue: jest.fn(async (key) => stored.delete(key)),
    };
    globalThis.GM_setValue = jest.fn();
    globalThis.GM_getValue = jest.fn();
    globalThis.GM_deleteValue = jest.fn();
    const { storage } = loadGmStorageModule();

    await storage.setObj("native-gm-key", { ios: true });
    await expect(storage.getObj("native-gm-key")).resolves.toEqual({
      ios: true,
    });
    await storage.del("native-gm-key");

    expect(globalThis.GM.setValue).toHaveBeenCalledWith(
      "native-gm-key",
      JSON.stringify({ ios: true })
    );
    expect(globalThis.GM.getValue).toHaveBeenCalledWith("native-gm-key");
    expect(globalThis.GM.deleteValue).toHaveBeenCalledWith("native-gm-key");
    expect(globalThis.GM_setValue).not.toHaveBeenCalled();
    expect(globalThis.GM_getValue).not.toHaveBeenCalled();
    expect(globalThis.GM_deleteValue).not.toHaveBeenCalled();
    expect(stored.has("native-gm-key")).toBe(false);
  });

  test("GM storage falls back to legacy GM storage APIs", async () => {
    const stored = new Map();
    globalThis.GM = {};
    globalThis.GM_setValue = jest.fn(async (key, value) =>
      stored.set(key, value)
    );
    globalThis.GM_getValue = jest.fn(async (key) => stored.get(key));
    globalThis.GM_deleteValue = jest.fn(async (key) => stored.delete(key));
    const { storage } = loadGmStorageModule();

    await storage.setObj("legacy-gm-key", { ios: true });
    await expect(storage.getObj("legacy-gm-key")).resolves.toEqual({
      ios: true,
    });
    await storage.del("legacy-gm-key");

    expect(globalThis.GM_setValue).toHaveBeenCalledWith(
      "legacy-gm-key",
      JSON.stringify({ ios: true })
    );
    expect(globalThis.GM_getValue).toHaveBeenCalledWith("legacy-gm-key");
    expect(globalThis.GM_deleteValue).toHaveBeenCalledWith("legacy-gm-key");
    expect(stored.has("legacy-gm-key")).toBe(false);
  });
});
