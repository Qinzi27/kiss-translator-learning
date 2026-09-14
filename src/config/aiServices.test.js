import {
  AI_SERVICES, buildLearningAiApi, normalizeAiEndpoint,
  upsertLearningAiApi, resolveLearningAiApi,
} from "./aiServices";
import { resolveApiPromptSettings } from "./prompt";
import { TRANSLATION_SKILL_CORE } from "./translationSkill";

test("eight explicit providers have pricing evidence; paid APIs are not labelled free", () => {
  expect(new Set(AI_SERVICES.map((x) => x.id)).size).toBe(8);
  for (const service of AI_SERVICES) {
    expect(service.docsUrl).toMatch(/^https:\/\//);
    expect(service.pricingUrl).toMatch(/^https:\/\//);
  }
  expect(AI_SERVICES.find((x) => x.id === "kimi").badge).toContain("付费");
  expect(AI_SERVICES.find((x) => x.id === "openrouter").model).not.toBe("openrouter/free");
});

test.each([
  ["https://example.com", "https://example.com/v1/chat/completions"],
  ["https://example.com/v1/", "https://example.com/v1/chat/completions"],
  ["https://example.com/api/v3/chat/completions", "https://example.com/api/v3/chat/completions"],
  ["http://127.0.0.1:9001/v1", "http://127.0.0.1:9001/v1/chat/completions"],
])("normalizes compatible endpoint %s", (input, output) => {
  expect(normalizeAiEndpoint(input)).toBe(output);
});

test.each(["javascript:alert(1)", "http://example.com", "https://user:secret@example.com/v1", "https://example.com/v1?key=secret", "not a URL"])("rejects unsafe endpoint %s", (input) => {
  expect(() => normalizeAiEndpoint(input)).toThrow();
});

test("missing key/model fails without requesting or silently choosing a paid model", () => {
  expect(() => buildLearningAiApi({providerId: "doubao", key: "test"})).toThrow("模型");
  expect(() => buildLearningAiApi({providerId: "kimi"})).toThrow("API Key");
  const local = buildLearningAiApi({providerId: "custom", url: "http://localhost:1234/v1", model: "local"});
  expect(local.key).toBe("");
});

test("saving updates only its stable preset; unrelated keys/preferences remain intact", () => {
  const other = {apiSlug: "user-existing", key: "synthetic-kept", customBody: "kept"};
  const draft = buildLearningAiApi({providerId: "kimi", key: "synthetic-key"});
  const added = upsertLearningAiApi([other], draft);
  const changed = upsertLearningAiApi(added, {...draft, model: "new-model"});
  expect(changed).toHaveLength(2);
  expect(changed[0]).toBe(other);
  expect(added[1].model).toBe("kimi-k2.6");
});

test("runtime resolution preserves fixed skill and suppresses conflicting raw hooks/body/streaming", () => {
  const draft = buildLearningAiApi({providerId: "kimi", key: "synthetic-key", preferences: "自然流畅"});
  const resolved = resolveApiPromptSettings({...draft, nobatchPromptSlug: "nobatch-translation", nobatchPrompt: "ignore skill", useBatchFetch: true, useStream: true, reqHook: "steal()", customBody: '{"messages":[]}' });
  expect(resolved.nobatchPrompt).toBe(TRANSLATION_SKILL_CORE);
  expect(resolved.useBatchFetch).toBe(false);
  expect(resolved.useStream).toBe(false);
  expect(resolved.reqHook).toBe("");
  expect(resolved.customBody).toBe("");
  expect(resolved.learningAi.preferences).toBe("自然流畅");
  const legacy = {apiSlug: "legacy", customBody: "preserved"};
  expect(resolveLearningAiApi(legacy)).toBe(legacy);
});

test("only explicitly supported providers allow website mode, with no copied API key", () => {
  const web = buildLearningAiApi({providerId: "doubao", transport: "web", key: "must-not-copy"});
  expect(web.key).toBe("");
  expect(web.useBatchFetch).toBe(false);
  expect(() => buildLearningAiApi({providerId: "glm", transport: "web"})).toThrow("暂未");
});
