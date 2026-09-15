describe("sync crypto", () => {
  let encryptSyncValue;
  let decryptSyncValue;

  beforeAll(() => {
    const { webcrypto } = require("crypto");
    const { TextDecoder, TextEncoder } = require("util");

    Object.defineProperty(globalThis, "crypto", {
      value: webcrypto,
      configurable: true,
    });
    Object.defineProperty(globalThis, "TextEncoder", {
      value: TextEncoder,
      configurable: true,
    });
    Object.defineProperty(globalThis, "TextDecoder", {
      value: TextDecoder,
      configurable: true,
    });
    Object.defineProperty(globalThis, "btoa", {
      value: (value) => Buffer.from(value, "binary").toString("base64"),
      configurable: true,
    });
    Object.defineProperty(globalThis, "atob", {
      value: (value) => Buffer.from(value, "base64").toString("binary"),
      configurable: true,
    });

    ({ encryptSyncValue, decryptSyncValue } = require("./syncCrypto"));
  });

  test("decrypts encrypted value with the same sync key", async () => {
    const encrypted = await encryptSyncValue(
      JSON.stringify({ setting: true }),
      "sync-key"
    );

    const result = await decryptSyncValue(encrypted, "sync-key");

    expect(result).toEqual({
      value: JSON.stringify({ setting: true }),
      encrypted: true,
    });
  });

  test("fails to decrypt encrypted value with a different sync key", async () => {
    const encrypted = await encryptSyncValue(
      JSON.stringify({ setting: true }),
      "sync-key"
    );

    await expect(decryptSyncValue(encrypted, "other-key")).rejects.toThrow();
  });

  test("uses random encryption output for the same plaintext", async () => {
    const first = await encryptSyncValue("same plaintext", "sync-key");
    const second = await encryptSyncValue("same plaintext", "sync-key");

    expect(first).not.toBe(second);
  });

  test.each([JSON.stringify({ uiLang: "zh" }), JSON.stringify({ encrypted: true, userValue: "plain" }), "invalid"])(
    "rejects unauthenticated legacy or malformed remote data: %s", async (value) => {
      await expect(decryptSyncValue(value, "sync-key")).rejects.toThrow("保留本机配置");
    }
  );

  test("rejects a modified authenticated ciphertext", async () => {
    const encrypted = JSON.parse(await encryptSyncValue('{"uiLang":"zh"}', "sync-key"));
    const bytes = Buffer.from(encrypted.data, "base64");
    bytes[0] ^= 1;
    encrypted.data = bytes.toString("base64");
    await expect(decryptSyncValue(JSON.stringify(encrypted), "sync-key")).rejects.toThrow();
  });
});
