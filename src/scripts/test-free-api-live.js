// Real request + actual provider adapter/handleTranslate; no fake responses.
jest.mock("query-string", () => globalThis.__LIVE_QUERY_STRING__);
jest.mock("@streamparser/json", () =>
  jest.requireActual("../../node_modules/@streamparser/json/dist/cjs/index.js")
);
jest.mock("../libs/docInfo", () => ({ getDocInfo: () => ({}) }));
jest.mock("../libs/fetch", () => ({
  fetchData: (...args) => globalThis.__LIVE_FREE_FETCH__(...args),
  fetchStream: () => {
    throw new Error("Streaming is disabled for MyMemory.");
  },
}));

const { TextEncoder, TextDecoder } = require("node:util");
globalThis.TextEncoder = TextEncoder;
globalThis.TextDecoder = TextDecoder;
const { handleTranslate } = require("../apis/trans");
const { DEFAULT_API_LIST, OPT_TRANS_MYMEMORY } = require("../config");
const { applyNetworkPolicy } = require("../libs/networkPolicy");
const fs = require("node:fs");
const path = require("node:path");

if (process.env.KISS_FREE_API_LIVE !== "1")
  throw new Error("Use node src/scripts/test-free-api-live.cjs to opt in.");
const realFetch = globalThis.fetch;
const audit = [];
globalThis.__LIVE_FREE_FETCH__ = async (input, init = {}, opts = {}) => {
  const url = new URL(input);
  expect(url.origin).toBe("https://api.mymemory.translated.net");
  expect(url.pathname).toBe("/get");
  expect(Array.from(url.searchParams.keys()).sort()).toEqual(["langpair", "q"]);
  const bytes = new TextEncoder().encode(url.searchParams.get("q")).length;
  expect(bytes).toBeLessThanOrEqual(500);
  expect(init.credentials).toBe("omit");
  expect(opts.useCache).toBe(false);
  expect(opts.usePool).toBe(false);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  opts.signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(cancel, 25000);
  try {
    const response = await realFetch(url.href, {
      ...applyNetworkPolicy(url.href, init, "no-google"),
      signal: controller.signal,
      redirect: "error",
    });
    const body = await response.json();
    audit.push({
      host: url.hostname,
      path: url.pathname,
      bytes,
      status: response.status,
      responseStatus: body.responseStatus,
      quotaFinished: body.quotaFinished,
    });
    expect(response.status).toBe(200);
    return body;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", cancel);
  }
};

test("real anonymous MyMemory API translates both directions with Google blocked", async () => {
  expect(() =>
    applyNetworkPolicy("https://translate.googleapis.com/", {}, "no-google")
  ).toThrow();
  const examples = [
    {
      fromLang: "en",
      toLang: "zh-CN",
      source:
        "A small translation test can help us learn how a browser extension works.",
    },
    {
      fromLang: "zh-CN",
      toLang: "en",
      source: "这个免费的接口可以帮助我们测试网页翻译。",
    },
  ];
  const translations = [];
  for (const example of examples) {
    const output = [];
    for await (const item of handleTranslate([example.source], {
      ...example,
      apiSetting: DEFAULT_API_LIST.find(
        (api) => api.apiType === OPT_TRANS_MYMEMORY
      ),
      textFormat: "text",
      usePool: false,
    }))
      output.push(item);
    expect(output).toHaveLength(1);
    const translation = output[0]?.result?.[0];
    expect(typeof translation).toBe("string");
    expect(translation.trim()).not.toBe("");
    expect(translation).not.toBe(example.source);
    expect(translation).toMatch(
      example.toLang === "en" ? /[A-Za-z]/ : /[\u3400-\u9fff]/
    );
    translations.push({ ...example, translation });
  }
  expect(audit).toHaveLength(2);
  const receipt = {
    timestamp: new Date().toISOString(),
    provider: "MyMemory",
    anonymous: true,
    scope:
      "Real handleTranslate/provider with exact-origin Node HTTPS transport; no cached responses",
    networkPolicy: "no-google",
    audit,
    translations,
  };
  const directory = path.resolve(process.cwd(), "validation");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "free-api-live.json"),
    JSON.stringify(receipt, null, 2) + "\n"
  );
  console.log(JSON.stringify(receipt, null, 2));
}, 65000);
