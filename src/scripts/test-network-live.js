/* This opt-in integration file deliberately lacks .test/.spec in its name.
 * Run with: node src/scripts/test-network-live.cjs
 * Scope: real upstream request generator + response parser + real HTTPS.
 * The browser/extension transport is replaced with a strict Node fetch adapter.
 */
jest.mock("query-string", () => globalThis.__LIVE_QUERY_STRING__);
jest.mock("@streamparser/json", () =>
  jest.requireActual("../../node_modules/@streamparser/json/dist/cjs/index.js")
);
jest.mock("../libs/docInfo", () => ({ getDocInfo: () => ({}) }));
jest.mock("../libs/fetch", () => ({
  fetchData: (...args) => globalThis.__LIVE_FETCH_DATA__(...args),
  fetchStream: () => {
    throw new Error("Streaming is outside this live smoke test.");
  },
}));

const { TextEncoder, TextDecoder } = require("node:util");
globalThis.TextEncoder = TextEncoder;
globalThis.TextDecoder = TextDecoder;
const { handleTranslate } = require("../apis/trans");
const {
  DEFAULT_API_LIST,
  OPT_TRANS_MICROSOFT,
  OPT_TRANS_GOOGLE,
} = require("../config");

if (process.env.KISS_NETWORK_LIVE !== "1") {
  throw new Error(
    "Run this opt-in live test with node src/scripts/test-network-live.cjs"
  );
}

const nativeFetch = globalThis.fetch;
const allowedOrigin = "https://edge.microsoft.com";
const audit = [];
let outgoingRequests = 0;

async function restrictedFetch(input, init = {}) {
  const url = new URL(String(input));
  const entry = { host: url.hostname, path: url.pathname, decision: "blocked" };
  audit.push(entry);
  // An exact HTTPS origin allowlist rejects all Google domains, lookalike
  // subdomains, alternate ports, HTTP, URL credentials, and every other host.
  if (url.origin !== allowedOrigin || url.username || url.password) {
    throw new Error(`LIVE_NETWORK_BLOCKED: ${url.origin}`);
  }
  entry.decision = "allowed";
  outgoingRequests += 1;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await nativeFetch(url.href, {
      ...init,
      signal: controller.signal,
      // Do not permit a redirect to bypass the origin check.
      redirect: "manual",
      credentials: "omit",
    });
    entry.status = response.status;
    if (response.status >= 300 && response.status < 400) {
      throw new Error(`LIVE_REDIRECT_BLOCKED: HTTP ${response.status}`);
    }
    if (!response.ok)
      throw new Error(`Microsoft returned HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    entry.error = error.cause?.code || error.code || error.message;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

globalThis.fetch = restrictedFetch;
globalThis.__LIVE_FETCH_DATA__ = restrictedFetch;

async function translate(apiType, text, from, to) {
  const apiSetting = {
    ...DEFAULT_API_LIST.find((item) => item.apiType === apiType),
    key: "",
    useStream: false,
    useContext: false,
    fetchInterval: 0,
    fetchLimit: 1,
    httpTimeout: 25000,
  };
  const result = [];
  for await (const item of handleTranslate([text], {
    from,
    to,
    fromLang: from,
    toLang: to,
    langMap: () => "",
    glossary: "",
    apiSetting,
    textFormat: "text",
    usePool: false,
    docInfo: {},
  })) {
    result.push(item);
  }
  if (result.length !== 1 || typeof result[0]?.result?.[0] !== "string") {
    throw new Error("Upstream parser did not return exactly one translation.");
  }
  return result[0].result[0];
}

test("real Microsoft EN/中文 translation works while Google requests are rejected at the network boundary", async () => {
  const translations = [];
  try {
    // Exercise the actual upstream Google provider, not just a domain helper.
    await expect(
      translate(
        OPT_TRANS_GOOGLE,
        "This is a synthetic connection test.",
        "en",
        "zh-CN"
      )
    ).rejects.toThrow("LIVE_NETWORK_BLOCKED");
    for (const url of [
      "https://translate.google.com/",
      "https://www.gstatic.com/",
      "https://generativelanguage.googleapis.com/",
      "https://edge.microsoft.com.evil.example/",
      "http://edge.microsoft.com/",
    ]) {
      await expect(restrictedFetch(url)).rejects.toThrow(
        "LIVE_NETWORK_BLOCKED"
      );
    }
    expect(outgoingRequests).toBe(0);

    const examples = [
      {
        from: "en",
        to: "zh-Hans",
        source: "I read a short article and learn one new word every day.",
      },
      {
        from: "zh-Hans",
        to: "en",
        source: "我每天读一篇短文章，并学习一个新词。",
      },
    ];
    for (const example of examples) {
      const translation = await translate(
        OPT_TRANS_MICROSOFT,
        example.source,
        example.from,
        example.to
      );
      expect(translation.trim()).not.toBe("");
      expect(translation).not.toBe(example.source);
      if (example.to === "zh-Hans")
        expect(translation).toMatch(/[\u3400-\u9fff]/);
      else expect(translation).toMatch(/[A-Za-z]/);
      translations.push({ ...example, translation });
    }
    expect(outgoingRequests).toBe(2);
    expect(
      audit
        .filter((item) => item.decision === "allowed")
        .every(
          (item) => item.host === "edge.microsoft.com" && item.status === 200
        )
    ).toBe(true);
  } finally {
    console.log(
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          scope:
            "Live upstream handleTranslate/genTransReq/parseTransRes; restricted Node HTTPS transport",
          allowedOrigin,
          redirects: "blocked",
          outgoingRequests,
          audit,
          translations,
        },
        null,
        2
      )
    );
  }
}, 65000);
