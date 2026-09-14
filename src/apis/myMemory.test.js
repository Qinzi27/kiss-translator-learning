/** @jest-environment node */
// The provider is pure JS, including HTML handling: this suite has no document,
// DOMParser or Node DOM globals. Replies are fixtures, not real network calls.
jest.mock("../libs/fetch", () => ({ fetchData: jest.fn() }));

let fetchData;
let translateMyMemory;
const success = (text) => ({
  responseStatus: 200,
  responseDetails: "",
  quotaFinished: false,
  responseData: { translatedText: text },
});
const query = (call) => new URL(call[0]).searchParams.get("q");
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
async function flush() {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}
async function finish(promise) {
  let result;
  promise.then(
    (value) => {
      result = { value };
    },
    (error) => {
      result = { error };
    }
  );
  for (let index = 0; index < 100 && !result; index += 1) {
    await flush();
    if (!result) jest.runOnlyPendingTimers();
  }
  if (!result) throw new Error("Test did not settle");
  if (result.error) throw result.error;
  return result.value;
}

beforeEach(() => {
  jest.resetModules();
  jest.useFakeTimers();
  jest.setSystemTime(0);
  ({ fetchData } = require("../libs/fetch"));
  ({ translateMyMemory } = require("./myMemory"));
  fetchData.mockImplementation(async (url) =>
    success(new URL(url).searchParams.get("q"))
  );
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

test("uses only anonymous official GET parameters and the shared fetch/network-policy layer", async () => {
  fetchData.mockResolvedValueOnce(success("你好，世界！"));
  const controller = new AbortController();
  await expect(
    translateMyMemory("Hello, world!", {
      fromLang: "en",
      toLang: "zh-CN",
      signal: controller.signal,
      httpTimeout: 42,
    })
  ).resolves.toEqual({ text: "你好，世界！", from: "en" });
  expect(fetchData).toHaveBeenCalledTimes(1);
  const [url, init, options] = fetchData.mock.calls[0];
  expect(new URL(url).origin + new URL(url).pathname).toBe(
    "https://api.mymemory.translated.net/get"
  );
  expect([...new URL(url).searchParams.entries()]).toEqual([
    ["q", "Hello, world!"],
    ["langpair", "en|zh-CN"],
  ]);
  expect(init).toEqual({
    method: "GET",
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  expect(options).toEqual({
    useCache: false,
    usePool: false,
    httpTimeout: 42,
    signal: controller.signal,
    expect: "json",
  });
});

test.each([
  ["Hello", "auto", "zh-TW", "en|zh-TW", "en"],
  ["你好世界", "auto", "en", "zh-CN|en", "zh-CN"],
  ["傳統中文", "zh-Hant", "en", "zh-TW|en", "zh-TW"],
])(
  "supports the requested local direction for %s",
  async (text, fromLang, toLang, pair, from) => {
    const result = await translateMyMemory(text, { fromLang, toLang });
    expect(
      new URL(fetchData.mock.calls[0][0]).searchParams.get("langpair")
    ).toBe(pair);
    expect(result.from).toBe(from);
  }
);

test.each([
  ["Already English.", "en"],
  ["已经是中文。", "zh-CN"],
  ["<code>const English = 42;</code>", "zh-CN"],
])("keeps existing target text and code local: %s", async (text, toLang) => {
  await expect(
    translateMyMemory(text, { toLang, textFormat: "html" })
  ).resolves.toEqual({ text, from: toLang });
  expect(fetchData).not.toHaveBeenCalled();
});

test.each([
  ["", {}],
  [null, {}],
  ["hello", { toLang: "fr" }],
  ["hello", { fromLang: "de" }],
  ["Привет", {}],
  ["hello", { textFormat: "xml" }],
])(
  "rejects unsupported or empty input before any request",
  async (text, options) => {
    await expect(translateMyMemory(text, options)).rejects.toThrow();
    expect(fetchData).not.toHaveBeenCalled();
  }
);

test("UTF-8 chunks stay within 500 bytes and retain Chinese, emoji and combining characters exactly", async () => {
  const text = "中文😀e\u0301".repeat(180);
  const result = await finish(
    translateMyMemory(text, { fromLang: "zh-CN", toLang: "en" })
  );
  const segments = fetchData.mock.calls.map(query);
  expect(segments.length).toBeGreaterThan(3);
  expect(
    segments.every((segment) => Buffer.byteLength(segment, "utf8") <= 500)
  ).toBe(true);
  expect(segments.join("")).toBe(text);
  expect(result.text).toBe(text);
  expect(
    segments.every(
      (segment) => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(segment)
    )
  ).toBe(true);
});

test("splitting retains boundary spaces and line separators and never merges separate paragraphs", async () => {
  const text = `  ${"A longer sentence. ".repeat(45)}\n\nSecond paragraph.\r\n  Third paragraph.  `;
  const result = await finish(
    translateMyMemory(text, { fromLang: "en", toLang: "zh-CN" })
  );
  expect(result.text).toBe(text);
  expect(
    fetchData.mock.calls.map(query).every((value) => !/[\r\n]/.test(value))
  ).toBe(true);
  expect(fetchData.mock.calls.map(query)).toContain("Second paragraph.");
  expect(fetchData.mock.calls.map(query)).toContain("Third paragraph.");
});

test("protects original tags, quoted attributes, entities, placeholders and nested code/pre contents", async () => {
  const text =
    '<p data-note="x > y">Hello <a href="https://example.test/private?q=SECRET">world</a> &amp; {1} {{value}} [[2]] [3] ${name} %s.</p><pre><code>const SECRET_CODE = "<span>code words</span>";</code></pre><script>SECRET_SCRIPT()</script>\nFinal sentence.';
  fetchData.mockImplementation(async () => success("译文"));
  const result = await finish(
    translateMyMemory(text, {
      fromLang: "en",
      toLang: "zh-CN",
      textFormat: "html",
    })
  );
  expect(fetchData.mock.calls.map(query)).toEqual([
    "Hello",
    "world",
    "Final sentence.",
  ]);
  expect(result.text).toBe(
    '<p data-note="x > y">译文 <a href="https://example.test/private?q=SECRET">译文</a> &amp; {1} {{value}} [[2]] [3] ${name} %s.</p><pre><code>const SECRET_CODE = "<span>code words</span>";</code></pre><script>SECRET_SCRIPT()</script>\n译文'
  );
  expect(
    fetchData.mock.calls.every((call) => !call[0].includes("SECRET"))
  ).toBe(true);
});

test("does not create HTML nodes from remote translation or encoded remote markup", async () => {
  fetchData.mockResolvedValueOnce(
    success(
      "&lt;img src=x onerror=alert(1)&gt; & <script>evil()</script> &#39;word&#39;"
    )
  );
  const result = await translateMyMemory("<p>Hello</p>", {
    fromLang: "en",
    toLang: "zh-CN",
    textFormat: "html",
  });
  expect(result.text).toBe(
    "<p>&lt;img src=x onerror=alert(1)&gt; &amp; &lt;script&gt;evil()&lt;/script&gt; 'word'</p>"
  );
  expect(result.text).not.toContain("<img");
  expect(result.text).not.toContain("<script>");
});

test("preserves an unclosed code element through the end instead of sending its content", async () => {
  const result = await translateMyMemory(
    '<p>Hello</p><code>const SECRET = "keep";',
    { fromLang: "en", toLang: "zh-CN", textFormat: "html" }
  );
  expect(fetchData.mock.calls.map(query)).toEqual(["Hello"]);
  expect(result.text).toBe('<p>Hello</p><code>const SECRET = "keep";');
});

test.each([
  [null, /空响应/],
  ["<html>error</html>", /无效数据/],
  [success(""), /有效译文/],
  [{ responseData: { translatedText: "hello" } }, /未能完成/],
  [{ ...success("error"), responseStatus: 403 }, /403/],
  [{ ...success("error"), error: "service failure" }, /未能完成/],
  [{ ...success("error"), responseDetails: "NO QUERY SPECIFIED" }, /未能完成/],
  [success("INVALID LANGUAGE PAIR"), /未能完成/],
  [{ ...success("quota warning"), quotaFinished: true }, /额度/],
  [{ ...success("quota warning"), quotaFinished: "true" }, /额度/],
  [
    success(
      "MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY."
    ),
    /额度/,
  ],
  [{ ...success("error"), responseStatus: 429 }, /429/],
])(
  "rejects invalid/error/quota payloads even when fetch resolved",
  async (response, message) => {
    fetchData.mockResolvedValueOnce(response);
    await expect(
      translateMyMemory("Hello", { fromLang: "en", toLang: "zh-CN" })
    ).rejects.toThrow(message);
    expect(fetchData).toHaveBeenCalledTimes(1);
  }
);

test("reports HTTP errors without exposing query/source text or retrying", async () => {
  fetchData.mockRejectedValueOnce(
    new Error(
      JSON.stringify({
        status: 429,
        url: "https://example.test?q=PRIVATE_SOURCE",
        response: "secret",
      })
    )
  );
  const result = translateMyMemory("PRIVATE_SOURCE", {
    fromLang: "en",
    toLang: "zh-CN",
  });
  await expect(result).rejects.toMatchObject({
    code: "MYMEMORY_LIMIT",
    message: expect.stringContaining("429"),
  });
  await expect(result).rejects.not.toThrow("PRIVATE_SOURCE");
  expect(fetchData).toHaveBeenCalledTimes(1);
});

test("serializes concurrent calls and enforces at least one second between starts", async () => {
  const pending = deferred();
  fetchData.mockReturnValueOnce(pending.promise);
  const first = translateMyMemory("First", {
    fromLang: "en",
    toLang: "zh-CN",
    fetchInterval: 0,
  });
  const second = translateMyMemory("Second", {
    fromLang: "en",
    toLang: "zh-CN",
    fetchInterval: 0,
  });
  await flush();
  expect(fetchData).toHaveBeenCalledTimes(1);
  pending.resolve(success("第一"));
  await flush();
  expect(fetchData).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(999);
  await flush();
  expect(fetchData).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(1);
  await flush();
  expect(fetchData).toHaveBeenCalledTimes(2);
  await expect(first).resolves.toMatchObject({ text: "第一" });
  await expect(second).resolves.toMatchObject({ text: "Second" });
});

test("cancelling during a request rejects promptly and prevents all later chunks", async () => {
  const pending = deferred();
  const controller = new AbortController();
  fetchData.mockReturnValueOnce(pending.promise);
  const result = translateMyMemory("word ".repeat(300), {
    fromLang: "en",
    toLang: "zh-CN",
    signal: controller.signal,
  });
  const assertion = expect(result).rejects.toMatchObject({
    name: "AbortError",
  });
  await flush();
  expect(fetchData).toHaveBeenCalledTimes(1);
  expect(fetchData.mock.calls[0][2].signal).toBe(controller.signal);
  controller.abort();
  await assertion;
  pending.resolve(success("迟到译文"));
  await flush();
  jest.runOnlyPendingTimers();
  await flush();
  expect(fetchData).toHaveBeenCalledTimes(1);
});

test("cancelling the interval wait or an already-aborted call sends no additional request", async () => {
  const controller = new AbortController();
  const result = translateMyMemory("word ".repeat(300), {
    fromLang: "en",
    toLang: "zh-CN",
    signal: controller.signal,
  });
  const assertion = expect(result).rejects.toMatchObject({
    name: "AbortError",
  });
  await flush();
  expect(fetchData).toHaveBeenCalledTimes(1);
  controller.abort();
  await assertion;
  await expect(
    translateMyMemory("Hello", { signal: controller.signal })
  ).rejects.toMatchObject({ name: "AbortError" });
  jest.runOnlyPendingTimers();
  await flush();
  expect(fetchData).toHaveBeenCalledTimes(1);
});

test.each([
  [{ ...success("limited"), quotaFinished: true }],
  [{ ...success("limited"), responseStatus: 429 }],
  [new Error(JSON.stringify({ status: 429 }))],
])(
  "quota circuit rejects queued calls and requires a new manual call after the cooldown",
  async (response) => {
    if (response instanceof Error) fetchData.mockRejectedValueOnce(response);
    else fetchData.mockResolvedValueOnce(response);
    const first = translateMyMemory("First", {
      fromLang: "en",
      toLang: "zh-CN",
    });
    const second = translateMyMemory("Queued", {
      fromLang: "en",
      toLang: "zh-CN",
    });
    await expect(first).rejects.toMatchObject({ code: "MYMEMORY_LIMIT" });
    await expect(second).rejects.toMatchObject({ code: "MYMEMORY_LIMIT" });
    expect(fetchData).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(59999);
    await expect(
      translateMyMemory("Too early", { fromLang: "en", toLang: "zh-CN" })
    ).rejects.toMatchObject({ code: "MYMEMORY_LIMIT" });
    jest.advanceTimersByTime(1);
    await flush();
    expect(fetchData).toHaveBeenCalledTimes(1);
    await expect(
      translateMyMemory("Manual retry", { fromLang: "en", toLang: "zh-CN" })
    ).resolves.toMatchObject({ text: "Manual retry" });
    expect(fetchData).toHaveBeenCalledTimes(2);
  }
);

test("a normal service failure does not poison the queue or silently retry", async () => {
  fetchData.mockRejectedValueOnce(
    new Error(JSON.stringify({ status: 503, url: "secret" }))
  );
  await expect(
    translateMyMemory("Hello", { fromLang: "en", toLang: "zh-CN" })
  ).rejects.toThrow("503");
  expect(fetchData).toHaveBeenCalledTimes(1);
  await expect(
    finish(
      translateMyMemory("Manual retry", { fromLang: "en", toLang: "zh-CN" })
    )
  ).resolves.toMatchObject({ text: "Manual retry" });
  expect(fetchData).toHaveBeenCalledTimes(2);
});

test("rejects malformed UTF-16 before sending even the first chunk", async () => {
  await expect(
    translateMyMemory("a".repeat(1000) + "\uD800", {
      fromLang: "en",
      toLang: "zh-CN",
    })
  ).rejects.toThrow("Unicode");
  expect(fetchData).not.toHaveBeenCalled();
});
