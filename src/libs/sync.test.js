jest.mock("../config", () => ({
  APP_LCNAME: "kiss-translator",
  KV_SETTING_KEY: "kiss-setting_v2.json",
  KV_RULES_KEY: "kiss-rules_v2.json",
  KV_WORDS_KEY: "kiss-words.json",
  KV_RULES_SHARE_KEY: "kiss-rules-share_v2.json",
  KV_SALT_SHARE: "share-salt",
  OPT_SYNCTYPE_WEBDAV: "WebDAV",
  OPT_SYNCTYPE_GIST: "GitHub Gist",
}));

jest.mock("./storage", () => ({
  getSyncWithDefault: jest.fn(),
  putSync: jest.fn(),
  getSettingWithDefault: jest.fn(),
  getRulesWithDefault: jest.fn(),
  getWordsWithDefault: jest.fn(),
  setSetting: jest.fn(),
  setRules: jest.fn(),
  setWords: jest.fn(),
}));

jest.mock("../apis", () => ({
  apiSyncData: jest.fn(),
  apiCreateGist: jest.fn(),
  apiListGists: jest.fn(),
  apiGetGist: jest.fn(),
  apiUpdateGistFile: jest.fn(),
  apiFetchText: jest.fn(),
}));

jest.mock("./utils", () => ({
  sha256: jest.fn(),
  removeEndchar: jest.fn((value) => value.replace(/\/$/, "")),
}));

jest.mock("webdav", () => ({
  createClient: jest.fn(),
  getPatcher: jest.fn(() => ({
    patch: jest.fn(),
  })),
}));

jest.mock("./fetch", () => ({
  fetchPatcher: jest.fn(),
}));

jest.mock("./log", () => ({
  kissLog: jest.fn(),
}));

jest.mock("./syncCrypto", () => ({
  encryptSyncValue: jest.fn(),
  decryptSyncValue: jest.fn(),
}));

import { changeSyncEncryptKey, syncData, syncSettingAndRules } from "./sync";
import {
  apiCreateGist,
  apiGetGist,
  apiListGists,
  apiUpdateGistFile,
} from "../apis";
import {
  getSettingWithDefault,
  getRulesWithDefault,
  getSyncWithDefault,
  getWordsWithDefault,
  putSync,
  setSetting,
} from "./storage";
import { decryptSyncValue, encryptSyncValue } from "./syncCrypto";
import { createClient, getPatcher } from "webdav";

const SYNC_DESCRIPTION = "kiss translator sync files";
const SYNC_KEY = "github-token";
const SYNC_ENCRYPT_KEY = "sync-encrypt-passphrase";
const RECOVERY_OLD_ENCRYPT_KEY = "recovery-old-passphrase";
const NEW_SYNC_ENCRYPT_KEY = "new-sync-encrypt-passphrase";
const SETTING_KEY = "kiss-setting_v2.json";
const RULES_KEY = "kiss-rules_v2.json";
const WORDS_KEY = "kiss-words.json";

const gistFileContent = (value, updateAt) =>
  JSON.stringify({
    key: SETTING_KEY,
    value: JSON.stringify(value),
    updateAt,
  });

const encryptedGistFileContent = (value, updateAt) =>
  JSON.stringify({
    key: SETTING_KEY,
    value: `cipher:${Buffer.from(JSON.stringify(value)).toString("base64")}`,
    updateAt,
  });

describe("WebDAV sync", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getSettingWithDefault.mockReset();
    getPatcher.mockReturnValue({ patch: jest.fn() });
    encryptSyncValue.mockImplementation((value) =>
      Promise.resolve(`cipher:${Buffer.from(value).toString("base64")}`)
    );
    decryptSyncValue.mockImplementation((value) =>
      Promise.resolve({
        value: Buffer.from(value.slice("cipher:".length), "base64").toString(),
        encrypted: true,
      })
    );
  });

  test("applies different remote data with an equal initial timestamp", async () => {
    getSyncWithDefault.mockResolvedValue({
      syncType: "WebDAV",
      syncUrl: "https://dav.example.com",
      syncUser: "user",
      syncKey: "password",
      syncEncryptKey: SYNC_ENCRYPT_KEY,
      syncMeta: {},
    });
    const client = {
      exists: jest.fn().mockResolvedValue(true),
      getFileContents: jest.fn().mockResolvedValue(
        JSON.stringify({
          key: SETTING_KEY,
          value: `cipher:${Buffer.from(
            JSON.stringify({ uiLang: "zh" })
          ).toString("base64")}`,
          updateAt: 0,
        })
      ),
      putFileContents: jest.fn(),
    };
    createClient.mockReturnValue(client);

    const result = await syncData(SETTING_KEY, { uiLang: "en" });

    expect(client.putFileContents).not.toHaveBeenCalled();
    expect(result).toEqual({ value: { uiLang: "zh" }, isNew: true });
  });

  test("does not mark equal-timestamp legacy remote data as new after a prior sync", async () => {
    const remoteLegacySetting = {
      version: 1,
      transApis: [{ systemPrompt: "legacy inline prompt" }],
    };
    const localMigratedSetting = {
      version: 3,
      prompts: [{ slug: "migrated-prompt" }],
      transApis: [{ batchPromptSlug: "migrated-prompt" }],
    };
    getSyncWithDefault.mockResolvedValue({
      syncType: "WebDAV",
      syncUrl: "https://dav.example.com",
      syncUser: "user",
      syncKey: "password",
      syncEncryptKey: SYNC_ENCRYPT_KEY,
      syncMeta: {
        [SETTING_KEY]: {
          updateAt: 100,
          syncAt: 1,
        },
      },
    });
    const client = {
      exists: jest.fn().mockResolvedValue(true),
      getFileContents: jest.fn().mockResolvedValue(
        JSON.stringify({
          key: SETTING_KEY,
          value: `cipher:${Buffer.from(
            JSON.stringify(remoteLegacySetting)
          ).toString("base64")}`,
          updateAt: 100,
        })
      ),
      putFileContents: jest.fn(),
    };
    createClient.mockReturnValue(client);

    const result = await syncData(SETTING_KEY, localMigratedSetting);

    expect(client.putFileContents).not.toHaveBeenCalled();
    expect(result.isNew).toBe(false);
  });
});

describe("GitHub Gist sync", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getSettingWithDefault.mockReset();
    encryptSyncValue.mockImplementation((value) =>
      Promise.resolve(`cipher:${Buffer.from(value).toString("base64")}`)
    );
    decryptSyncValue.mockImplementation((value) => {
      if (value.startsWith("bad-cipher:")) {
        return Promise.reject(new Error("decrypt failed"));
      }
      if (value.startsWith("cipher:")) {
        return Promise.resolve({
          value: Buffer.from(
            value.slice("cipher:".length),
            "base64"
          ).toString(),
          encrypted: true,
        });
      }
      return Promise.resolve({ value, encrypted: false });
    });
    jest.spyOn(Date, "now").mockReturnValue(1000);
  });

  afterEach(() => {
    Date.now.mockRestore();
  });

  test("initial upload strips credentials before encryption and retains the newest local key", async () => {
    const api = { apiSlug: "fixture", apiType: "OpenAI", url: "https://example.test/v1/chat/completions", key: "OLD_LOCAL" };
    getSyncWithDefault.mockResolvedValue({ syncType: "GitHub Gist", syncUrl: "",
      syncKey: SYNC_KEY, syncEncryptKey: SYNC_ENCRYPT_KEY, syncMeta: {} });
    apiListGists.mockResolvedValue([]);
    apiCreateGist.mockResolvedValue({ id: "fixture-gist" });
    getSettingWithDefault.mockResolvedValue({ uiLang: "en", transApis: [{ ...api, key: "NEW_LOCAL" }] });
    const result = await syncData(SETTING_KEY, { uiLang: "en", transApis: [api] });
    const encryptedInput = JSON.parse(encryptSyncValue.mock.calls[0][0]);
    expect(encryptedInput.transApis[0]).not.toHaveProperty("key");
    expect(result.value.transApis[0].key).toBe("NEW_LOCAL");
  });

  test("authenticated remote settings cannot supply keys or rebind an existing local credential", async () => {
    const localApi = { apiSlug: "fixture", apiType: "OpenAI", url: "https://local-config.test/v1/chat/completions", key: "LOCAL_ONLY" };
    getSyncWithDefault.mockResolvedValue({ syncType: "GitHub Gist", syncUrl: "fixture-gist",
      syncKey: SYNC_KEY, syncEncryptKey: SYNC_ENCRYPT_KEY,
      syncMeta: { [SETTING_KEY]: { updateAt: 10, syncAt: 1 } } });
    getSettingWithDefault.mockResolvedValue({ networkPolicy: "offline", uiLang: "en", transApis: [localApi] });
    apiGetGist.mockResolvedValue({ files: { [SETTING_KEY]: { content: encryptedGistFileContent({
      uiLang: "zh", networkPolicy: "normal", transApis: [{ ...localApi,
        url: "https://remote-config.test/v1/chat/completions", key: "REMOTE_VALUE" }],
    }, 50) } } });
    const result = await syncData(SETTING_KEY, { uiLang: "en", transApis: [localApi] });
    expect(result.value).toMatchObject({ uiLang: "zh", networkPolicy: "offline", transApis: [localApi] });
    expect(result.isNew).toBe(true);
    expect(apiUpdateGistFile).not.toHaveBeenCalled();
  });

  test("skips sync when encryption passphrase is missing", async () => {
    getSyncWithDefault.mockResolvedValue({
      syncType: "GitHub Gist",
      syncUrl: "existing-gist",
      syncKey: SYNC_KEY,
      syncEncryptKey: "",
      syncMeta: {},
    });

    const result = await syncData(SETTING_KEY, { uiLang: "en" });

    expect(result).toBeUndefined();
    expect(apiGetGist).not.toHaveBeenCalled();
    expect(encryptSyncValue).not.toHaveBeenCalled();
  });

  test("reuses the newest existing fixed-description gist when syncUrl is empty", async () => {
    getSyncWithDefault.mockResolvedValue({
      syncType: "GitHub Gist",
      syncUrl: "",
      syncKey: SYNC_KEY,
      syncEncryptKey: SYNC_ENCRYPT_KEY,
      syncMeta: {
        [SETTING_KEY]: {
          updateAt: 100,
          syncAt: 1,
        },
      },
    });
    apiListGists.mockResolvedValue([
      {
        id: "legacy-timestamped",
        description: `${SYNC_DESCRIPTION}-1780891711256`,
        updated_at: "2026-06-08T01:00:00Z",
      },
      {
        id: "fixed-old",
        description: SYNC_DESCRIPTION,
        updated_at: "2026-06-08T02:00:00Z",
      },
      {
        id: "fixed-new",
        description: SYNC_DESCRIPTION,
        updated_at: "2026-06-08T03:00:00Z",
      },
    ]);
    apiGetGist.mockResolvedValue({
      files: {
        [SETTING_KEY]: {
          content: encryptedGistFileContent({ uiLang: "zh" }, 200),
        },
      },
    });

    const result = await syncData(SETTING_KEY, { uiLang: "en" });

    expect(apiCreateGist).not.toHaveBeenCalled();
    expect(apiGetGist).toHaveBeenCalledWith("fixed-new", SYNC_KEY);
    expect(putSync).toHaveBeenNthCalledWith(1, { syncUrl: "fixed-new" });
    expect(result).toEqual({ value: { uiLang: "zh" }, isNew: true });
  });

  test("creates one fixed-description gist when syncUrl is empty and none exists", async () => {
    getSyncWithDefault.mockResolvedValue({
      syncType: "GitHub Gist",
      syncUrl: "",
      syncKey: SYNC_KEY,
      syncEncryptKey: SYNC_ENCRYPT_KEY,
      syncMeta: {},
    });
    apiListGists.mockResolvedValue([]);
    apiCreateGist.mockResolvedValue({ id: "created-gist" });

    const result = await syncData(SETTING_KEY, { uiLang: "en" });

    expect(apiCreateGist).toHaveBeenCalledWith(
      SYNC_KEY,
      {
        key: SETTING_KEY,
        content: JSON.stringify(
          {
            key: SETTING_KEY,
            value: `cipher:${Buffer.from(
              JSON.stringify({ uiLang: "en" })
            ).toString("base64")}`,
            updateAt: 0,
          },
          null,
          2
        ),
      },
      SYNC_DESCRIPTION
    );
    expect(putSync).toHaveBeenNthCalledWith(1, { syncUrl: "created-gist" });
    expect(encryptSyncValue).toHaveBeenCalledWith(
      JSON.stringify({ uiLang: "en" }),
      SYNC_ENCRYPT_KEY
    );
    expect(encryptSyncValue).not.toHaveBeenCalledWith(
      expect.any(String),
      SYNC_KEY
    );
    expect(result).toEqual({ value: { uiLang: "en" }, isNew: false });
  });

  test("returns remote value when an existing gist file is newer", async () => {
    getSyncWithDefault.mockResolvedValue({
      syncType: "GitHub Gist",
      syncUrl: "https://gist.github.com/fishjar/existing-gist",
      syncKey: SYNC_KEY,
      syncEncryptKey: SYNC_ENCRYPT_KEY,
      syncMeta: {
        [SETTING_KEY]: {
          updateAt: 10,
          syncAt: 1,
        },
      },
    });
    apiGetGist.mockResolvedValue({
      files: {
        [SETTING_KEY]: {
          content: encryptedGistFileContent({ uiLang: "zh" }, 50),
        },
      },
    });

    const result = await syncData(SETTING_KEY, { uiLang: "en" });

    expect(apiListGists).not.toHaveBeenCalled();
    expect(apiUpdateGistFile).not.toHaveBeenCalled();
    expect(result).toEqual({ value: { uiLang: "zh" }, isNew: true });
  });

  test("decrypts encrypted remote value when an existing gist file is newer", async () => {
    getSyncWithDefault.mockResolvedValue({
      syncType: "GitHub Gist",
      syncUrl: "existing-gist",
      syncKey: SYNC_KEY,
      syncEncryptKey: SYNC_ENCRYPT_KEY,
      syncMeta: {
        [SETTING_KEY]: {
          updateAt: 10,
          syncAt: 1,
        },
      },
    });
    apiGetGist.mockResolvedValue({
      files: {
        [SETTING_KEY]: {
          content: encryptedGistFileContent({ uiLang: "zh" }, 50),
        },
      },
    });

    const result = await syncData(SETTING_KEY, { uiLang: "en" });

    expect(apiUpdateGistFile).not.toHaveBeenCalled();
    expect(decryptSyncValue).toHaveBeenCalledWith(
      expect.any(String),
      SYNC_ENCRYPT_KEY
    );
    expect(decryptSyncValue).not.toHaveBeenCalledWith(
      expect.any(String),
      SYNC_KEY
    );
    expect(result).toEqual({ value: { uiLang: "zh" }, isNew: true });
  });

  test("rejects newer legacy plaintext without adopting or rewriting it", async () => {
    getSyncWithDefault.mockResolvedValue({
      syncType: "GitHub Gist",
      syncUrl: "existing-gist",
      syncKey: SYNC_KEY,
      syncEncryptKey: SYNC_ENCRYPT_KEY,
      syncMeta: {
        [SETTING_KEY]: {
          updateAt: 10,
          syncAt: 1,
        },
      },
    });
    apiGetGist.mockResolvedValue({
      files: {
        [SETTING_KEY]: {
          content: gistFileContent({ uiLang: "zh" }, 50),
        },
      },
    });

    await expect(syncData(SETTING_KEY, { uiLang: "en" })).rejects.toThrow("加密验证");
    expect(apiUpdateGistFile).not.toHaveBeenCalled();
    expect(setSetting).not.toHaveBeenCalled();
    expect(putSync).not.toHaveBeenCalled();
  });

  test("patches the existing gist file when local data is newer", async () => {
    getSyncWithDefault.mockResolvedValue({
      syncType: "GitHub Gist",
      syncUrl: "existing-gist",
      syncKey: SYNC_KEY,
      syncEncryptKey: SYNC_ENCRYPT_KEY,
      syncMeta: {
        [SETTING_KEY]: {
          updateAt: 200,
          syncAt: 1,
        },
      },
    });
    apiGetGist.mockResolvedValue({
      files: {
        [SETTING_KEY]: {
          content: encryptedGistFileContent({ uiLang: "zh" }, 100),
        },
      },
    });

    const result = await syncData(SETTING_KEY, { uiLang: "en" });

    expect(apiUpdateGistFile).toHaveBeenCalledWith(
      "existing-gist",
      SYNC_KEY,
      SETTING_KEY,
      JSON.stringify(
        {
          key: SETTING_KEY,
          value: `cipher:${Buffer.from(
            JSON.stringify({ uiLang: "en" })
          ).toString("base64")}`,
          updateAt: 200,
        },
        null,
        2
      )
    );
    expect(result).toEqual({ value: { uiLang: "en" }, isNew: false });
  });

  test("rejects older unauthenticated data before overwriting cloud backups", async () => {
    getSyncWithDefault.mockResolvedValue({
      syncType: "GitHub Gist",
      syncUrl: "existing-gist",
      syncKey: SYNC_KEY,
      syncEncryptKey: SYNC_ENCRYPT_KEY,
      syncMeta: {
        [SETTING_KEY]: {
          updateAt: 200,
          syncAt: 1,
        },
      },
    });
    apiGetGist.mockResolvedValue({
      files: {
        [SETTING_KEY]: {
          content: gistFileContent({ uiLang: "zh" }, 100),
        },
      },
    });

    await expect(syncData(SETTING_KEY, { uiLang: "en" })).rejects.toThrow("加密验证");
    expect(apiUpdateGistFile).not.toHaveBeenCalled();
    expect(putSync).not.toHaveBeenCalled();
  });

  test("stops setting sync when encrypted remote data cannot be decrypted", async () => {
    getSyncWithDefault.mockResolvedValue({
      syncType: "GitHub Gist",
      syncUrl: "existing-gist",
      syncKey: SYNC_KEY,
      syncEncryptKey: SYNC_ENCRYPT_KEY,
      syncMeta: {
        [SETTING_KEY]: {
          updateAt: 10,
          syncAt: 1,
        },
      },
    });
    getSettingWithDefault.mockResolvedValue({ uiLang: "en" });
    apiGetGist.mockResolvedValue({
      files: {
        [SETTING_KEY]: {
          content: JSON.stringify({
            key: SETTING_KEY,
            value: "bad-cipher:value",
            updateAt: 50,
          }),
        },
      },
    });

    await expect(syncSettingAndRules()).rejects.toThrow("decrypt failed");

    expect(setSetting).not.toHaveBeenCalled();
    expect(apiUpdateGistFile).not.toHaveBeenCalled();
  });

  test("changes encryption passphrase after re-encrypting personal sync data", async () => {
    getSyncWithDefault.mockResolvedValue({
      syncType: "GitHub Gist",
      syncUrl: "existing-gist",
      syncKey: SYNC_KEY,
      syncEncryptKey: SYNC_ENCRYPT_KEY,
      syncMeta: {
        [SETTING_KEY]: {
          updateAt: 200,
          syncAt: 1,
        },
        [RULES_KEY]: {
          updateAt: 201,
          syncAt: 1,
        },
        [WORDS_KEY]: {
          updateAt: 202,
          syncAt: 1,
        },
      },
    });
    getSettingWithDefault.mockResolvedValue({ uiLang: "zh" });
    getRulesWithDefault.mockResolvedValue([{ pattern: "*" }]);
    getWordsWithDefault.mockResolvedValue({ hello: true });
    apiGetGist.mockResolvedValue({ files: {} });

    Date.now.mockReturnValue(9999);

    await changeSyncEncryptKey({
      oldEncryptKey: SYNC_ENCRYPT_KEY,
      newEncryptKey: NEW_SYNC_ENCRYPT_KEY,
    });

    expect(encryptSyncValue).toHaveBeenNthCalledWith(
      1,
      JSON.stringify({ uiLang: "zh" }),
      SYNC_ENCRYPT_KEY
    );
    expect(encryptSyncValue).toHaveBeenNthCalledWith(
      2,
      JSON.stringify([{ pattern: "*" }]),
      SYNC_ENCRYPT_KEY
    );
    expect(encryptSyncValue).toHaveBeenNthCalledWith(
      3,
      JSON.stringify({ hello: true }),
      SYNC_ENCRYPT_KEY
    );
    expect(encryptSyncValue).toHaveBeenNthCalledWith(
      4,
      JSON.stringify({ uiLang: "zh" }),
      NEW_SYNC_ENCRYPT_KEY
    );
    expect(encryptSyncValue).toHaveBeenNthCalledWith(
      5,
      JSON.stringify([{ pattern: "*" }]),
      NEW_SYNC_ENCRYPT_KEY
    );
    expect(encryptSyncValue).toHaveBeenNthCalledWith(
      6,
      JSON.stringify({ hello: true }),
      NEW_SYNC_ENCRYPT_KEY
    );
    const uploadedSetting = JSON.parse(apiUpdateGistFile.mock.calls[3][3]);
    const uploadedRules = JSON.parse(apiUpdateGistFile.mock.calls[4][3]);
    const uploadedWords = JSON.parse(apiUpdateGistFile.mock.calls[5][3]);
    expect(uploadedSetting.updateAt).toBe(9999);
    expect(uploadedRules.updateAt).toBe(9999);
    expect(uploadedWords.updateAt).toBe(9999);
    expect(putSync).toHaveBeenCalledWith({
      syncMeta: expect.objectContaining({
        [SETTING_KEY]: {
          updateAt: 9999,
          syncAt: 9999,
        },
      }),
    });
    expect(putSync).toHaveBeenCalledWith({
      syncMeta: expect.objectContaining({
        [RULES_KEY]: {
          updateAt: 9999,
          syncAt: 9999,
        },
      }),
    });
    expect(putSync).toHaveBeenCalledWith({
      syncMeta: expect.objectContaining({
        [WORDS_KEY]: {
          updateAt: 9999,
          syncAt: 9999,
        },
      }),
    });
    expect(putSync).toHaveBeenLastCalledWith({
      syncEncryptKey: NEW_SYNC_ENCRYPT_KEY,
    });
  });

  test("keeps old encryption passphrase when re-encryption fails", async () => {
    getSyncWithDefault.mockResolvedValue({
      syncType: "GitHub Gist",
      syncUrl: "existing-gist",
      syncKey: SYNC_KEY,
      syncEncryptKey: SYNC_ENCRYPT_KEY,
      syncMeta: {
        [SETTING_KEY]: {
          updateAt: 200,
          syncAt: 1,
        },
      },
    });
    getSettingWithDefault.mockResolvedValue({ uiLang: "zh" });
    apiGetGist.mockResolvedValue({ files: {} });
    apiUpdateGistFile.mockRejectedValue(new Error("upload failed"));

    await expect(
      changeSyncEncryptKey({
        oldEncryptKey: SYNC_ENCRYPT_KEY,
        newEncryptKey: NEW_SYNC_ENCRYPT_KEY,
      })
    ).rejects.toThrow("upload failed");

    expect(putSync).not.toHaveBeenCalledWith({
      syncEncryptKey: NEW_SYNC_ENCRYPT_KEY,
    });
  });

  test("uses the supplied old passphrase instead of a stale local passphrase", async () => {
    getSyncWithDefault.mockResolvedValue({
      syncType: "GitHub Gist",
      syncUrl: "existing-gist",
      syncKey: SYNC_KEY,
      syncEncryptKey: "stale-local-passphrase",
      syncMeta: {},
    });
    getSettingWithDefault.mockResolvedValue({ uiLang: "zh" });
    getRulesWithDefault.mockResolvedValue([]);
    getWordsWithDefault.mockResolvedValue({});
    apiGetGist.mockResolvedValue({ files: {} });

    await changeSyncEncryptKey({
      oldEncryptKey: RECOVERY_OLD_ENCRYPT_KEY,
      newEncryptKey: NEW_SYNC_ENCRYPT_KEY,
    });

    expect(encryptSyncValue).toHaveBeenNthCalledWith(
      1,
      JSON.stringify({ uiLang: "zh" }),
      RECOVERY_OLD_ENCRYPT_KEY
    );
    expect(encryptSyncValue).not.toHaveBeenCalledWith(
      JSON.stringify({ uiLang: "zh" }),
      "stale-local-passphrase"
    );
  });
});
