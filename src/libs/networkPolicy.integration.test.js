jest.mock("@streamparser/json", () => ({ JSONParser: jest.fn() }));
jest.mock("webextension-polyfill", () => ({}));
// Query-string is ESM-only and is not involved in the apiFetch path under test.
jest.mock("query-string", () => ({}));
// Cloud sync is not invoked by subscription download and brings unrelated crypto APIs.
jest.mock("./sync", () => ({}));

import { CURRENT_SETTINGS_VERSION, STOKEY_SETTING } from "../config";
import { apiFetch } from "../apis";
import { syncSubRules } from "./subRules";

function setPolicy(networkPolicy) {
  window.localStorage.setItem(
    STOKEY_SETTING,
    JSON.stringify({ version: CURRENT_SETTINGS_VERSION, networkPolicy })
  );
}

describe("policy across real storage and shared API routing", () => {
  beforeEach(() => {
    window.localStorage.clear();
    global.fetch = jest.fn().mockResolvedValue(
      new Response('{"translatedText":"本地译文"}', {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
  });

  test("offline blocks a background-style rule subscription before sending HTTP", async () => {
    setPolicy("offline");
    await expect(
      syncSubRules("https://raw.githubusercontent.com/example/rules.json")
    ).rejects.toThrow("仅本机离线");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("Google API requests are blocked while Microsoft and loopback remain selectable", async () => {
    setPolicy("no-google");
    await expect(
      apiFetch("https://translate.googleapis.com/translate_a/single")
    ).rejects.toThrow("屏蔽谷歌");
    expect(global.fetch).not.toHaveBeenCalled();
    await apiFetch("https://edge.microsoft.com/translate/translatetext");
    expect(global.fetch).toHaveBeenCalledTimes(1);

    setPolicy("offline");
    global.fetch.mockResolvedValue(
      new Response('{"translatedText":"你好"}', {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    await expect(apiFetch("http://127.0.0.1:5000/translate")).resolves.toEqual({
      translatedText: "你好",
    });
    expect(global.fetch.mock.calls[1][1].redirect).toBe("error");
  });
});
