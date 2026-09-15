import { mergeSyncedSettings, sanitizeSettings } from "./sanitizeSettings";

const service = (extra = {}) => ({
  apiSlug: "test-service", apiType: "OpenAI", apiName: "Test service",
  url: "https://example.test/v1/chat/completions", model: "test-model", ...extra,
});

test("sharing excludes keys, arbitrary request fields, scripts and hidden future fields", () => {
  const local = { uiLang: "zh", networkPolicy: "offline", prompts: [{ text: "PRIVATE" }],
    futureSetting: { token: "PRIVATE" }, subrulesList: ["https://example.test/PRIVATE"],
    transApis: [service({ key: "PRIVATE", customHeader: '{"X-Token":"PRIVATE"}',
      customBody: '{"session":"PRIVATE"}', reqHook: "PRIVATE", resHook: "PRIVATE",
      nobatchPrompt: "PRIVATE", hiddenCredential: "PRIVATE",
      learningAi: { providerId: "custom", transport: "api", preferences: "PRIVATE", token: "PRIVATE" } })] };
  const shared = sanitizeSettings(local);
  expect(JSON.stringify(shared)).not.toContain("PRIVATE");
  expect(shared).not.toHaveProperty("networkPolicy");
  expect(shared.transApis[0]).toMatchObject({ apiSlug: "test-service", url: local.transApis[0].url });
  expect(local.transApis[0].key).toBe("PRIVATE");
});

test.each([
  "https://user:password@example.test/v1/chat/completions",
  "https://example.test/translate?key=PRIVATE",
  "https://example.test/PRIVATE/translate",
  "https://example.test/translate#PRIVATE",
  "http://example.test/translate",
])("does not export a sensitive or unsafe endpoint %s", (url) => {
  expect(sanitizeSettings({ transApis: [service({ url })] }).transApis[0].url).toBe("");
});

test("applies safe remote preferences while retaining credentials only at the same destination", () => {
  const local = { networkPolicy: "offline", uiLang: "en", prompts: [{ local: true }],
    transApis: [service({ key: "LOCAL_ONLY", customHeader: "LOCAL_HEADER" })] };
  const remote = { networkPolicy: "normal", uiLang: "zh", prompts: [{ remote: true }],
    transApis: [service({ model: "another-model", key: "REMOTE_VALUE", reqHook: "REMOTE_SCRIPT" })] };
  const merged = mergeSyncedSettings(remote, local);
  expect(merged).toMatchObject({ networkPolicy: "offline", uiLang: "zh", prompts: [{ local: true }] });
  expect(merged.transApis[0]).toMatchObject({ key: "LOCAL_ONLY", model: "another-model", customHeader: "LOCAL_HEADER" });
  expect(JSON.stringify(merged)).not.toContain("REMOTE_");
});

test.each([
  { url: "https://other.test/v1/chat/completions" },
  { url: "https://example.test/v2/chat/completions" },
  { modelListUrl: "https://other.test/models" },
  { apiType: "Custom" },
  { learningAi: { providerId: "custom", transport: "api" } },
])("remote changes cannot rebind a local credential: %j", (change) => {
  const localApi = service({ key: "LOCAL_ONLY" });
  const merged = mergeSyncedSettings({ transApis: [service(change)] }, { transApis: [localApi] });
  expect(merged.transApis).toEqual([localApi]);
});

test("remote deletion retains local private services but can remove an unconfigured service", () => {
  const localApi = service({ key: "LOCAL_ONLY" });
  const merged = mergeSyncedSettings({ transApis: [] }, {
    transApis: [localApi, service({ apiSlug: "unconfigured" })],
  });
  expect(merged.transApis).toEqual([localApi]);
});

test("a new or renamed remote service never inherits another service's credential", () => {
  const merged = mergeSyncedSettings({ transApis: [service({ apiSlug: "new", key: "REMOTE_VALUE" })] }, {
    transApis: [service({ key: "LOCAL_ONLY" })],
  });
  expect(merged.transApis[0]).not.toHaveProperty("key");
  expect(merged.transApis[1].key).toBe("LOCAL_ONLY");
});

test("malformed records and ambiguous duplicate identities fail before applying settings", () => {
  expect(() => sanitizeSettings([])).toThrow("JSON 对象");
  expect(() => mergeSyncedSettings({ transApis: [service(), service()] }, {})).toThrow("重复");
});
