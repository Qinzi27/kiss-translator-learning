jest.mock("./storage", () => ({ getSettingWithDefault: jest.fn() }));

import { getSettingWithDefault } from "./storage";
import {
  applyNetworkPolicy,
  policyFetch,
  resolveNetworkPolicy,
} from "./networkPolicy";

describe("outbound network policy", () => {
  beforeEach(() => {
    getSettingWithDefault.mockResolvedValue({ networkPolicy: "normal" });
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
  });

  test.each([
    "http://localhost:5000/translate",
    "https://LOCALHOST/translate",
    "http://127.0.0.1:11434/api/chat",
    "http://[::1]:5000/translate",
  ])("offline allows explicit loopback endpoint %s", (url) => {
    expect(
      applyNetworkPolicy(url, { method: "POST", redirect: "follow" }, "offline")
    ).toMatchObject({ method: "POST", redirect: "error" });
  });

  test.each([
    "https://edge.microsoft.com/translate",
    "https://translate.googleapis.com/translate_a/single",
    "http://localhost.evil.example/translate",
    "http://127.0.0.1.evil.example/translate",
    "http://localhost@evil.example/translate",
    "http://evil.example@localhost/translate",
    "http://127.1/translate",
    "http://2130706433/translate",
    "http://local%68ost/translate",
    "http://[::ffff:127.0.0.1]/translate",
    "http://192.168.1.1/translate",
    "https://localhost./translate",
    "file:///tmp/translate",
    "/translate",
  ])(
    "offline blocks remote or disguised destination %s before fetch",
    async (url) => {
      getSettingWithDefault.mockResolvedValue({ networkPolicy: "offline" });
      await expect(policyFetch(url)).rejects.toThrow(/本机|HTTP/);
      expect(global.fetch).not.toHaveBeenCalled();
    }
  );

  test.each([
    "https://translate.google.com/",
    "https://google.cn/",
    "https://translate.google.com.hk/",
    "https://translate.google.co.uk/",
    "https://translate.googleapis.com/",
    "https://GOOGLEAPIS.COM./",
    "https://a.b.googleusercontent.com/",
    "https://fonts.gstatic.com/",
    "https://www.youtube.com/watch?v=example",
  ])("no-google blocks Google host %s before fetch", async (url) => {
    getSettingWithDefault.mockResolvedValue({ networkPolicy: "no-google" });
    await expect(policyFetch(url)).rejects.toThrow("屏蔽谷歌");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test.each([
    "https://edge.microsoft.com/translate/translatetext",
    "https://api.cognitive.microsofttranslator.com/translate",
    "https://notgoogle.com/translate",
    "https://googleapis.com.example.org/translate",
    "https://example.org/google.com?q=gstatic.com",
    "http://127.0.0.1:5000/translate",
  ])(
    "no-google permits non-Google host %s with redirects disabled",
    async (url) => {
      getSettingWithDefault.mockResolvedValue({ networkPolicy: "no-google" });
      await policyFetch(url, { redirect: "follow" });
      expect(global.fetch).toHaveBeenCalledWith(url, { redirect: "error" });
    }
  );

  test("normal mode preserves the upstream fetch options and redirect behavior", async () => {
    const options = { redirect: "follow", method: "POST", body: "text" };
    await policyFetch("https://translate.googleapis.com/", options);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://translate.googleapis.com/",
      options
    );
  });

  test("uses the latest stored policy on each request", async () => {
    await policyFetch("https://edge.microsoft.com/");
    getSettingWithDefault.mockResolvedValue({ networkPolicy: "offline" });
    await expect(policyFetch("https://edge.microsoft.com/")).rejects.toThrow(
      "仅本机"
    );
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("fails closed when policy settings cannot be read", async () => {
    getSettingWithDefault.mockRejectedValue(new Error("storage unavailable"));
    await expect(policyFetch("https://edge.microsoft.com/")).rejects.toThrow(
      "已停止发送请求"
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("rejects unknown saved modes while accepting older settings without the field", async () => {
    getSettingWithDefault.mockResolvedValue({ networkPolicy: "offlien" });
    await expect(resolveNetworkPolicy()).rejects.toThrow("联网策略无效");
    getSettingWithDefault.mockResolvedValue({});
    await expect(resolveNetworkPolicy()).resolves.toBe("normal");
  });

  test("reports redirect or connection refusal without trying another service", async () => {
    getSettingWithDefault.mockResolvedValue({ networkPolicy: "offline" });
    global.fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(policyFetch("http://127.0.0.1:5000/redirect")).rejects.toThrow(
      "禁止 HTTP 重定向"
    );
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][1].redirect).toBe("error");
  });

  test("preserves cancellation errors in restricted mode", async () => {
    getSettingWithDefault.mockResolvedValue({ networkPolicy: "offline" });
    const aborted = new DOMException("cancelled", "AbortError");
    global.fetch.mockRejectedValue(aborted);
    await expect(policyFetch("http://localhost:5000/")).rejects.toBe(aborted);
  });
});
