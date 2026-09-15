jest.mock("./storage", () => ({
  getSettingWithDefault: jest.fn(() => Promise.resolve({ httpTimeout: 1000 })),
}));

jest.mock("../config", () => ({
  CLIENT_EXTS: [],
  CLIENT_FIREFOX: "firefox",
  CLIENT_USERSCRIPT: "userscript",
  CLIENT_WEB: "web",
  DEFAULT_HTTP_TIMEOUT: 30,
  MSG_FETCH: "kiss_fetch",
}));

jest.mock("./log", () => ({
  kissLog: jest.fn(),
}));

import { fetchGM, fetchPatcher, normalizeHttpTimeout } from "./request";

const loadRequestWithClient = (clientMock, networkPolicy = "normal") => {
  jest.resetModules();
  jest.doMock("./client", () => clientMock);
  jest.doMock("./storage", () => ({
    getSettingWithDefault: jest.fn(() =>
      Promise.resolve({ httpTimeout: 1000, networkPolicy })
    ),
  }));
  jest.doMock("../config", () => ({
    CLIENT_EXTS: [],
    CLIENT_FIREFOX: "firefox",
    CLIENT_USERSCRIPT: "userscript",
    CLIENT_WEB: "web",
    DEFAULT_HTTP_TIMEOUT: 30,
    MSG_FETCH: "kiss_fetch",
  }));
  jest.doMock("./log", () => ({
    kissLog: jest.fn(),
  }));
  return require("./request");
};

const waitFor = async (condition) => {
  for (let i = 0; i < 12 && !condition(); i += 1) {
    await Promise.resolve();
  }
  expect(condition()).toBe(true);
};

describe("normalizeHttpTimeout", () => {
  test("converts second-based timeout values to milliseconds", () => {
    expect(normalizeHttpTimeout(30)).toBe(30000);
    expect(normalizeHttpTimeout(600)).toBe(600000);
  });

  test("keeps legacy millisecond timeout values unchanged", () => {
    expect(normalizeHttpTimeout(1000)).toBe(1000);
  });

  test("falls back to the default timeout in seconds", () => {
    expect(normalizeHttpTimeout()).toBe(30000);
    expect(normalizeHttpTimeout(0)).toBe(30000);
  });
});

describe("fetchPatcher", () => {
  afterEach(() => {
    delete window.KISS_GM;
    jest.restoreAllMocks();
  });

  test("background HTTP requests enforce saved offline policy despite caller overrides", async () => {
    const { fetchHandle } = loadRequestWithClient(
      { isExt: true, isGm: false },
      "offline"
    );
    global.fetch = jest.fn();
    await expect(
      fetchHandle({
        input: "https://edge.microsoft.com/translate",
        init: { method: "POST" },
        opts: { networkPolicy: "normal", httpTimeout: 1000 },
      })
    ).rejects.toThrow("仅本机离线");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("web requests reach loopback services with redirects disabled", async () => {
    const { fetchPatcher: webFetch } = loadRequestWithClient(
      { isExt: false, isGm: false },
      "offline"
    );
    global.fetch = jest
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    await webFetch("http://127.0.0.1:5000/translate", {
      redirect: "follow",
      method: "POST",
    });
    expect(global.fetch.mock.calls[0][1]).toMatchObject({
      redirect: "error",
      method: "POST",
    });
  });

  test("restricted userscript requests use native redirect protection instead of the GM bridge", async () => {
    const { fetchPatcher: gmFetch } = loadRequestWithClient(
      { isExt: false, isGm: true },
      "offline"
    );
    window.KISS_GM = { xmlHttpRequest: jest.fn() };
    global.fetch = jest
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    await gmFetch("http://localhost:5000/translate");
    expect(window.KISS_GM.xmlHttpRequest).not.toHaveBeenCalled();
    expect(global.fetch.mock.calls[0][1].redirect).toBe("error");
  });

  test("passes external abort signal to native fetch", async () => {
    const controller = new AbortController();
    global.fetch = jest.fn(() =>
      Promise.resolve(new Response("{}", { status: 200 }))
    );

    await fetchPatcher(
      "https://example.test",
      {},
      { signal: controller.signal }
    );

    expect(global.fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  test("merged signal aborts when external signal aborts", async () => {
    const controller = new AbortController();
    let capturedSignal;
    global.fetch = jest.fn((_, init) => {
      capturedSignal = init.signal;
      return new Promise(() => {});
    });

    fetchPatcher("https://example.test", {}, { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();

    expect(capturedSignal.aborted).toBe(true);
  });

  test("normal userscript requests use native fetch with redirects disabled", async () => {
    const { fetchPatcher: gmFetch } = loadRequestWithClient({ isExt: false, isGm: true });
    window.KISS_GM = { fetch: jest.fn(), xmlHttpRequest: jest.fn() };
    global.fetch = jest.fn().mockResolvedValue(new Response("{}"));
    await gmFetch("https://example.test/data", { redirect: "follow" });
    expect(global.fetch.mock.calls[0][1].redirect).toBe("error");
    expect(window.KISS_GM.xmlHttpRequest).not.toHaveBeenCalled();
  });

  test("normal userscript HTTP is rejected before either transport can send", async () => {
    const { fetchPatcher: gmFetch } = loadRequestWithClient({ isExt: false, isGm: true });
    window.KISS_GM = { xmlHttpRequest: jest.fn() };
    global.fetch = jest.fn();
    await expect(gmFetch("http://example.test/data")).rejects.toThrow("HTTPS");
    expect(global.fetch).not.toHaveBeenCalled();
    expect(window.KISS_GM.xmlHttpRequest).not.toHaveBeenCalled();
  });
});

describe("fetchGM", () => {
  afterEach(() => {
    delete global.GM;
    jest.restoreAllMocks();
  });

  test("accepts GM response from callback this context", async () => {
    let requestDetails;
    global.GM = {
      xmlHttpRequest: jest.fn((details) => {
        requestDetails = details;
        return { abort: jest.fn() };
      }),
    };

    const request = fetchGM("https://example.test");
    requestDetails.onload.call({
      response: '{"ok":true}',
      responseHeaders: "content-type: application/json",
      status: 200,
      statusText: "OK",
    });

    await expect(request).resolves.toEqual({
      body: '{"ok":true}',
      headers: { "content-type": "application/json" },
      status: 200,
      statusText: "OK",
    });
  });
});
