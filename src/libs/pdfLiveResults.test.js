import {
  isPdfTranslationTextAllowed,
  mergePdfLiveResults,
  PDF_LIVE_RESULT_LIMITS,
} from "./pdfLiveResults";

const item = (text = "译文", contextId = "context") => ({
  text,
  contextId,
  label: "测试服务",
  direction: "en → zh-CN",
  signature: "signature",
  revision: 1,
});
const charge = (value) => {
  const text = JSON.stringify(value);
  return Math.max(new TextEncoder().encode(text).byteLength, text.length * 2);
};

test("valid results retain their metadata without mutating old state", () => {
  const old = { "1-a": item("旧译文") };
  const update = item("新译文", "new-context");
  const result = mergePdfLiveResults(
    old,
    { "1-a": update, "2-b": item("第二页") },
    1
  );
  expect(result["1-a"]).toEqual(update);
  expect(result["2-b"].text).toBe("第二页");
  expect(old).toEqual({ "1-a": item("旧译文") });
});

test("a rejected oversized response retains the old translation and never silently truncates it", () => {
  const original = { "1-a": item("已完成译文") };
  const tooLong = "x".repeat(PDF_LIVE_RESULT_LIMITS.maxTranslationChars + 1);
  expect(isPdfTranslationTextAllowed(tooLong)).toBe(false);
  const result = mergePdfLiveResults(
    original,
    { "1-a": item(tooLong), "1-b": item(tooLong) },
    1
  );
  expect(result).toEqual(original);
  expect(
    isPdfTranslationTextAllowed(
      "x".repeat(PDF_LIVE_RESULT_LIMITS.maxTranslationChars)
    )
  ).toBe(true);
  for (const text of [undefined, {}, "", " \n "])
    expect(isPdfTranslationTextAllowed(text)).toBe(false);
});

test("the 80-page bound protects the visible page and the most recently visited pages", () => {
  let results = {};
  for (let page = 1; page <= 80; page++)
    results = mergePdfLiveResults(
      results,
      { [`${page}-a`]: item(`第${page}页`) },
      page
    );
  results = mergePdfLiveResults(results, {}, 1);
  results = mergePdfLiveResults(results, { "81-a": item("预取页") }, 1);
  expect(Object.keys(results)).toHaveLength(80);
  expect(results["1-a"].text).toBe("第1页");
  expect(results["2-a"]).toBeUndefined();
  expect(results["81-a"].text).toBe("预取页");
});

test("restoring a large cache snapshot also obeys the page limit", () => {
  const restored = Object.fromEntries(
    Array.from({ length: 200 }, (_, index) => [
      `${index + 1}-a`,
      item("恢复译文"),
    ])
  );
  const bounded = mergePdfLiveResults({}, restored, 1);
  expect(Object.keys(bounded)).toHaveLength(80);
  expect(bounded["1-a"]).toBeDefined();
  expect(bounded["200-a"]).toBeDefined();
});

test("the byte bound evicts old pages before the visible page", () => {
  const long = "译".repeat(16000);
  const entries = Object.fromEntries(
    Array.from({ length: 4 }, (_, page) =>
      Array.from({ length: 70 }, (_, paragraph) => [
        `${page + 1}-${paragraph}`,
        item(long),
      ])
    ).flat()
  );
  const results = mergePdfLiveResults({}, entries, 1);
  expect(charge(results)).toBeLessThanOrEqual(PDF_LIVE_RESULT_LIMITS.maxBytes);
  expect(results["1-0"]).toBeDefined();
  expect(results["2-0"]).toBeUndefined();
  expect(results["4-69"]).toBeDefined();
});

test("a dense current page evicts its oldest paragraphs while preserving the latest result", () => {
  const entries = Object.fromEntries(
    Array.from({ length: 280 }, (_, index) => [
      `1-${index}`,
      item("x".repeat(16000)),
    ])
  );
  const results = mergePdfLiveResults({}, entries, 1);
  expect(charge(results)).toBeLessThanOrEqual(PDF_LIVE_RESULT_LIMITS.maxBytes);
  expect(results["1-0"]).toBeUndefined();
  expect(results["1-279"]).toBeDefined();
  expect(Object.keys(results).length).toBeGreaterThan(200);
});

test("malformed restored entries and oversized metadata cannot bypass the payload bound", () => {
  const circular = item("循环对象");
  circular.self = circular;
  const old = { "1-a": item("安全旧文") };
  const result = mergePdfLiveResults(
    old,
    {
      invalid: item(),
      "201-a": item(),
      "1-b": { text: "x", metadata: "x".repeat(5 * 1024 * 1024) },
      "1-c": circular,
      "1-a": item(" "),
    },
    1
  );
  expect(result).toEqual(old);
  expect(charge(result)).toBeLessThanOrEqual(PDF_LIVE_RESULT_LIMITS.maxBytes);
});
