import {
  adaptScript,
  handlePing,
  injectScript,
  getGmMethod,
  USERSCRIPT_SETTINGS_DISABLED,
} from "./gm";

describe("disabled public userscript privilege bridge", () => {
  beforeEach(() => {
    delete window.KISS_GM;
    delete window.APP_INFO;
    globalThis.GM = {
      setValue: jest.fn(),
      getValue: jest.fn(),
      deleteValue: jest.fn(),
      xmlHttpRequest: jest.fn(),
      info: { synthetic: true },
    };
  });
  afterEach(() => {
    delete globalThis.GM;
    delete globalThis.GM_getValue;
    delete window.KISS_GM;
    delete window.APP_INFO;
    jest.restoreAllMocks();
  });

  test.each([
    "xmlHttpRequest",
    "xmlHttpRequestAbort",
    "setValue",
    "getValue",
    "deleteValue",
    "info",
  ])(
    "rejects the former %s public message without invoking privileged APIs or returning data",
    async (action) => {
      const dispatch = jest.spyOn(window, "dispatchEvent");
      await handlePing(
        new CustomEvent("legacy-public-channel", {
          detail: {
            action,
            args: {
              key: "synthetic",
              val: "synthetic",
              input: "https://fixture.invalid",
            },
            pong: "synthetic-reply",
          },
        })
      );
      for (const name of [
        "setValue",
        "getValue",
        "deleteValue",
        "xmlHttpRequest",
      ]) {
        expect(globalThis.GM[name]).not.toHaveBeenCalled();
      }
      expect(dispatch).not.toHaveBeenCalled();
    }
  );

  test("stale settings bundles cannot reactivate the DOM adapter", () => {
    const listen = jest.spyOn(window, "addEventListener");
    injectScript("synthetic-public-channel");
    expect(window.APP_INFO).toBeUndefined();
    expect(() => adaptScript("synthetic-public-channel")).toThrow(
      USERSCRIPT_SETTINGS_DISABLED
    );
    expect(window.KISS_GM).toBeUndefined();
    expect(listen).not.toHaveBeenCalled();
  });

  test("keeps native storage and request calls inside the isolated implementation", async () => {
    const values = new Map();
    globalThis.GM.setValue.mockImplementation(async (key, value) =>
      values.set(key, value)
    );
    globalThis.GM.getValue.mockImplementation(async (key) => values.get(key));
    globalThis.GM.deleteValue.mockImplementation(async (key) =>
      values.delete(key)
    );
    globalThis.GM.xmlHttpRequest.mockReturnValue({ abort: jest.fn() });
    await getGmMethod("setValue", "GM_setValue")("synthetic", "fixture");
    expect(await getGmMethod("getValue", "GM_getValue")("synthetic")).toBe(
      "fixture"
    );
    await getGmMethod("deleteValue", "GM_deleteValue")("synthetic");
    expect(values.size).toBe(0);
    expect(
      getGmMethod(
        "xmlHttpRequest",
        "GM_xmlhttpRequest"
      )({ url: "https://fixture.invalid" })
    ).toHaveProperty("abort");
  });

  test("keeps the internal legacy GM fallback", async () => {
    delete globalThis.GM;
    globalThis.GM_getValue = jest.fn(async () => "synthetic-fixture");
    expect(await getGmMethod("getValue", "GM_getValue")("fixture")).toBe(
      "synthetic-fixture"
    );
    expect(globalThis.GM_getValue).toHaveBeenCalledWith("fixture");
  });
});
