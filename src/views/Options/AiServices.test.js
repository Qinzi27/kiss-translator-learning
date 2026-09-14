import { act } from "react";
import { createRoot } from "react-dom/client";
import AiServices, { AI_SERVICE_TEST_TEXT } from "./AiServices";
import { AI_SERVICES, getLearningAiSlug } from "../../config/aiServices";
import { TRANSLATION_SKILL_CORE } from "../../config/translationSkill";
import { apiTranslate } from "../../apis";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let mockSetting;
let mockIsExt;
const mockPutRule = jest.fn();
const mockUpdateSetting = jest.fn((updater) => {
  mockSetting = updater(mockSetting);
});

jest.mock("../../hooks/Setting", () => ({
  useSetting: () => ({
    setting: mockSetting,
    updateSetting: mockUpdateSetting,
  }),
}));
jest.mock("../../hooks/Rules", () => ({
  useRules: () => ({
    list: [{ pattern: "*", apiSlug: "microsoft" }],
    isLoading: false,
    put: mockPutRule,
  }),
}));
jest.mock("../../libs/client", () => ({
  get isExt() {
    return mockIsExt;
  },
}));
jest.mock("../../apis", () => ({ apiTranslate: jest.fn() }));

function renderPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<AiServices />));
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function findButton(container, text) {
  return Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === text
  );
}

function choose(container, id) {
  const service = AI_SERVICES.find((item) => item.id === id);
  act(() =>
    container.querySelector(`button[aria-label="选择 ${service.name}"]`).click()
  );
}

function fill(container, label, value) {
  const input = container.querySelector(`[aria-label="${label}"]`);
  const prototype =
    input.tagName === "TEXTAREA"
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(container, text) {
  await act(async () => findButton(container, text).click());
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateSetting.mockImplementation((updater) => {
    mockSetting = updater(mockSetting);
  });
  mockIsExt = false;
  mockSetting = {
    networkPolicy: "normal",
    untouched: { flag: true },
    transApis: [{ apiSlug: "microsoft", apiName: "Existing service" }],
  };
  apiTranslate.mockResolvedValue({ trText: "这是翻译测试，请保留数字 2026。" });
});

afterEach(() => {
  document.body.innerHTML = "";
});

test("lists eight providers with official links and makes no automatic translation request", () => {
  const view = renderPage();
  const { container } = view;
  expect(
    container.querySelectorAll('button[aria-label^="选择 "]')
  ).toHaveLength(8);
  for (const service of AI_SERVICES) {
    expect(container.textContent).toContain(service.badge);
    const docs = container.querySelector(`a[href="${service.docsUrl}"]`);
    expect(docs).not.toBeNull();
    expect(docs.rel).toContain("noopener");
  }
  expect(container.querySelector('[aria-label="API 地址"]').readOnly).toBe(
    true
  );
  expect(container.querySelector('[aria-label="API Key"]').type).toBe(
    "password"
  );
  expect(container.textContent).toContain(
    "免费网页、API 试用额度与免费模型是不同权益"
  );
  expect(apiTranslate).not.toHaveBeenCalled();
  expect(mockUpdateSetting).not.toHaveBeenCalled();
  view.unmount();
});

test("saves only the service, retains other settings, and updates its stable slug", async () => {
  const view = renderPage();
  choose(view.container, "kimi");
  fill(view.container, "API Key", "synthetic-test-key");
  fill(view.container, "翻译偏好与术语", "workspace 译为工作区");
  await click(view.container, "保存服务");
  expect(mockSetting.transApis).toHaveLength(2);
  expect(mockSetting.transApis[0].apiSlug).toBe("microsoft");
  expect(mockSetting.networkPolicy).toBe("normal");
  expect(mockSetting.untouched).toEqual({ flag: true });
  expect(mockSetting.transApis[1]).toMatchObject({
    apiSlug: getLearningAiSlug("kimi", "api"),
    key: "synthetic-test-key",
    nobatchPrompt: TRANSLATION_SKILL_CORE,
    learningAi: { preferences: "workspace 译为工作区" },
  });
  fill(view.container, "服务名称（可选）", "我的 Kimi");
  await click(view.container, "保存服务");
  expect(mockSetting.transApis).toHaveLength(2);
  expect(mockSetting.transApis[1].apiName).toBe("我的 Kimi");
  expect(apiTranslate).not.toHaveBeenCalled();
  expect(mockPutRule).not.toHaveBeenCalled();
  view.unmount();
});

test("sets the global apiSlug only after saving a valid current draft", async () => {
  const view = renderPage();
  await click(view.container, "设为全局服务");
  expect(mockPutRule).not.toHaveBeenCalled();
  expect(mockUpdateSetting).not.toHaveBeenCalled();
  fill(view.container, "模型 / 接入点 ID", "ep-synthetic");
  fill(view.container, "API Key", "synthetic-test-key");
  await click(view.container, "设为全局服务");
  expect(mockPutRule).toHaveBeenCalledWith("*", {
    apiSlug: getLearningAiSlug("doubao", "api"),
  });
  expect(mockSetting.transApis[1].model).toBe("ep-synthetic");
  expect(mockSetting.networkPolicy).toBe("normal");
  expect(apiTranslate).not.toHaveBeenCalled();
  view.unmount();
});

test("sends only the disclosed synthetic sentence on explicit test without saving or caching", async () => {
  const view = renderPage();
  choose(view.container, "deepseek");
  fill(view.container, "API Key", "synthetic-test-key");
  expect(apiTranslate).not.toHaveBeenCalled();
  await click(view.container, "测试接口");
  expect(apiTranslate).toHaveBeenCalledTimes(1);
  expect(apiTranslate).toHaveBeenCalledWith(
    expect.objectContaining({
      text: AI_SERVICE_TEST_TEXT,
      fromLang: "en",
      toLang: "zh-CN",
      useCache: false,
      usePool: false,
      apiSetting: expect.objectContaining({
        apiSlug: getLearningAiSlug("deepseek", "api"),
        nobatchPrompt: TRANSLATION_SKILL_CORE,
      }),
    })
  );
  expect(mockUpdateSetting).not.toHaveBeenCalled();
  expect(
    view.container.querySelector('output[aria-label="测试译文"]').textContent
  ).toContain("2026");
  view.unmount();
});

test("preserves separate provider drafts without sharing their API keys", () => {
  const view = renderPage();
  choose(view.container, "kimi");
  fill(view.container, "API Key", "synthetic-kimi-key");
  choose(view.container, "deepseek");
  expect(view.container.querySelector('[aria-label="API Key"]').value).toBe("");
  choose(view.container, "kimi");
  expect(view.container.querySelector('[aria-label="API Key"]').value).toBe(
    "synthetic-kimi-key"
  );
  expect(apiTranslate).not.toHaveBeenCalled();
  view.unmount();
});

test("restores a saved service draft and its translation preferences", () => {
  mockSetting.transApis.push({
    apiSlug: getLearningAiSlug("kimi", "api"),
    apiName: "Saved Kimi",
    key: "synthetic-saved-key",
    model: "saved-model",
    url: "https://example.com/old-override",
    learningAi: {
      providerId: "kimi",
      transport: "api",
      preferences: "忠实原文",
    },
  });
  const view = renderPage();
  choose(view.container, "kimi");
  expect(
    view.container.querySelector('[aria-label="模型 / 接入点 ID"]').value
  ).toBe("saved-model");
  expect(view.container.querySelector('[aria-label="API 地址"]').value).toBe(
    AI_SERVICES.find((service) => service.id === "kimi").url
  );
  expect(
    view.container.querySelector('[aria-label="翻译偏好与术语"]').value
  ).toBe("忠实原文");
  expect(view.container.querySelector('[aria-label="API Key"]').type).toBe(
    "password"
  );
  view.unmount();
});

test("accepts a local custom base URL with no key while keeping offline policy", async () => {
  mockSetting.networkPolicy = "offline";
  const view = renderPage();
  expect(findButton(view.container, "测试接口").disabled).toBe(true);
  await click(view.container, "自定义兼容 API");
  fill(view.container, "API 地址", "http://127.0.0.1:11434/v1");
  fill(view.container, "模型 / 接入点 ID", "local-model");
  await click(view.container, "测试接口");
  expect(apiTranslate).toHaveBeenCalledWith(
    expect.objectContaining({
      apiSetting: expect.objectContaining({
        url: "http://127.0.0.1:11434/v1/chat/completions",
        key: "",
      }),
    })
  );
  expect(mockSetting.networkPolicy).toBe("offline");
  view.unmount();
});

test("blocks a remote custom test under offline policy without sending a request", async () => {
  mockSetting.networkPolicy = "offline";
  const view = renderPage();
  await click(view.container, "自定义兼容 API");
  fill(view.container, "API 地址", "https://example.com/v1");
  fill(view.container, "API Key", "synthetic-test-key");
  fill(view.container, "模型 / 接入点 ID", "test-model");
  await click(view.container, "测试接口");
  expect(apiTranslate).not.toHaveBeenCalled();
  expect(view.container.textContent).toContain("已阻止远程请求");
  expect(mockSetting.networkPolicy).toBe("offline");
  view.unmount();
});

test("web mode requires the extension and exposes only a manual unparameterized official link", async () => {
  const view = renderPage();
  await click(view.container, "后台网页 · 实验性");
  expect(findButton(view.container, "测试后台网页").disabled).toBe(true);
  expect(view.container.textContent).toContain("需安装 Chrome / Edge 扩展");
  expect(view.container.querySelector('[aria-label="API Key"]')).toBeNull();
  const login = Array.from(view.container.querySelectorAll("a")).find(
    (link) => link.textContent === "打开官网并登录"
  );
  expect(login.href).toBe(
    AI_SERVICES.find((item) => item.id === "doubao").webUrl
  );
  expect(new URL(login.href).search).toBe("");
  expect(apiTranslate).not.toHaveBeenCalled();
  choose(view.container, "deepseek");
  expect(findButton(view.container, "后台网页 · 实验性").disabled).toBe(true);
  expect(view.container.querySelector('[aria-label="API Key"]')).not.toBeNull();
  view.unmount();
});

test("tests background web mode only after explicit click and stores no API key", async () => {
  mockIsExt = true;
  const view = renderPage();
  fill(view.container, "API Key", "synthetic-api-only-key");
  await click(view.container, "后台网页 · 实验性");
  expect(apiTranslate).not.toHaveBeenCalled();
  expect(findButton(view.container, "测试后台网页").disabled).toBe(true);
  await click(view.container, "保存服务");
  expect(findButton(view.container, "测试后台网页").disabled).toBe(false);
  await click(view.container, "测试后台网页");
  expect(apiTranslate).toHaveBeenCalledWith(
    expect.objectContaining({
      text: AI_SERVICE_TEST_TEXT,
      apiSetting: expect.objectContaining({
        key: "",
        learningAi: expect.objectContaining({ transport: "web" }),
      }),
    })
  );
  expect(mockSetting.transApis[1].key).toBe("");
  fill(view.container, "翻译偏好与术语", "使用简体中文");
  expect(findButton(view.container, "测试后台网页").disabled).toBe(true);
  view.unmount();
});

test("redacts the entered API key from a provider error", async () => {
  const view = renderPage();
  choose(view.container, "kimi");
  fill(view.container, "API Key", "  synthetic-error-key  ");
  apiTranslate.mockRejectedValueOnce(
    new Error("invalid key synthetic-error-key")
  );
  await click(view.container, "测试接口");
  expect(view.container.textContent).not.toContain("synthetic-error-key");
  expect(view.container.textContent).toContain("[已隐藏密钥]");
  view.unmount();
});
