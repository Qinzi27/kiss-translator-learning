jest.mock("query-string", () => ({
  stringify: (obj) => new URLSearchParams(obj).toString(),
}));
jest.mock("@streamparser/json", () => ({ JSONParser: jest.fn() }));
jest.mock("../libs/docInfo", () => ({ getDocInfo: () => ({}) }));
jest.mock("../libs/fetch", () => ({ fetchData: jest.fn(), fetchStream: jest.fn() }));
// A translation path must not even import the shared script interpreter.
jest.mock("../libs/interpreter", () => {
  throw new Error("API translation must never import the script interpreter");
}, { virtual: true });

import { genTransReq, parseTransRes, handleTranslate } from "./trans";
import { DEFAULT_API_LIST, OPT_TRANS_CUSTOMIZE, OPT_TRANS_OPENAI } from "../config";
import { fetchData } from "../libs/fetch";

const requestArgs = (overrides = {}) => ({
  ...DEFAULT_API_LIST.find((api) => api.apiSlug === "local_argos"),
  apiType: OPT_TRANS_CUSTOMIZE,
  apiSlug: "synthetic-local-argos",
  url: "http://127.0.0.1:8765/translate",
  key: "synthetic-pairing-token",
  texts: ["Synthetic sample"],
  from: "en",
  to: "zh-CN",
  fromLang: "en",
  toLang: "zh-CN",
  useBatchFetch: false,
  useStream: false,
  ...overrides,
});

const forbiddenScripts = [
  '() => { globalThis.__apiHookExecuted = true; throw new Error("must not execute"); }',
  '(() => { globalThis.__apiHookExecuted = true; return () => []; })()',
  '() => { window.__apiHookExecuted = true; localStorage.setItem("synthetic-hook", "executed"); return []; }',
  '() => { fetch("https://must-not-send.invalid/synthetic"); return []; }',
  '() => { while (true) {} }',
  'invalid javascript {',
];

afterEach(() => {
  expect(globalThis.__apiHookExecuted).toBeUndefined();
  expect(localStorage.getItem("synthetic-hook")).toBeNull();
  jest.clearAllMocks();
});

test.each(forbiddenScripts)("stored reqHook and resHook are ignored without parsing or executing: %s", async (script) => {
  const options = requestArgs({ reqHook: script, resHook: script });
  const [url, init] = await genTransReq(options);
  expect(url).toBe("http://127.0.0.1:8765/translate");
  expect(init.headers.Authorization).toBe("Bearer synthetic-pairing-token");
  expect(JSON.parse(init.body)).toEqual({ text: "Synthetic sample", from: "en", to: "zh-CN" });
  expect(await parseTransRes({ text: "合成示例", src: "en" }, options)).toEqual([["合成示例", "en"]]);
  expect(options.reqHook).toBe(script);
  expect(options.resHook).toBe(script);
  expect(fetchData).not.toHaveBeenCalled();
});

test("Custom still accepts declarative JSON fields and its existing batch response protocol", async () => {
  const options = requestArgs({
    useBatchFetch: true,
    texts: ["Sample one", "Sample two"],
    reqHook: '() => ({url: "https://must-not-send.invalid"})',
    resHook: '() => [["tampered"]]',
    customHeader: '{"X-Synthetic":"yes"}',
    customBody: '{"syntheticOption":true}',
  });
  const [, init] = await genTransReq(options);
  expect(init.headers).toMatchObject({ Authorization: "Bearer synthetic-pairing-token", "X-Synthetic": "yes" });
  expect(JSON.parse(init.body)).toEqual({ texts: options.texts, from: "en", to: "zh-CN", syntheticOption: true });
  const translations = [{ text: "示例一", src: "en" }, { text: "示例二", src: "en" }];
  expect(await parseTransRes(translations, options)).toEqual([["示例一", "en"], ["示例二", "en"]]);
  expect(await parseTransRes({ translations }, options)).toEqual([["示例一", "en"], ["示例二", "en"]]);
});

test("ordinary AI request and response use their built-in protocol despite legacy hooks", async () => {
  const options = requestArgs({
    ...DEFAULT_API_LIST.find((api) => api.apiType === OPT_TRANS_OPENAI),
    url: "https://synthetic.invalid/v1/chat/completions",
    key: "synthetic-ai-key",
    model: "synthetic-model",
    useBatchFetch: false,
    useStream: false,
    reqHook: forbiddenScripts[0],
    resHook: forbiddenScripts[0],
  });
  const [url, init] = await genTransReq(options);
  expect(url).toBe(options.url);
  expect(init.headers.Authorization).toBe("Bearer synthetic-ai-key");
  expect(JSON.parse(init.body)).toMatchObject({ model: "synthetic-model", stream: false });
  expect(await parseTransRes({ choices: [{ message: { role: "assistant", content: "合成译文" } }] }, options)).toEqual([["合成译文"]]);
});

test("handleTranslate keeps Argos auth and built-in parsing with previously configured hooks", async () => {
  fetchData.mockResolvedValue({ text: "合成译文", src: "en" });
  const args = requestArgs({ reqHook: forbiddenScripts[0], resHook: forbiddenScripts[0], fetchInterval: 0, fetchLimit: 1 });
  const results = [];
  for await (const item of handleTranslate(args.texts, {
    from: "en", to: "zh-CN", fromLang: "en", toLang: "zh-CN", langMap: () => "",
    apiSetting: args, usePool: false,
  })) results.push(item);
  expect(fetchData).toHaveBeenCalledTimes(1);
  expect(fetchData.mock.calls[0][0]).toBe(args.url);
  expect(fetchData.mock.calls[0][1].headers.Authorization).toBe("Bearer synthetic-pairing-token");
  expect(results).toEqual([{ id: 0, result: ["合成译文", "en"] }]);
});
