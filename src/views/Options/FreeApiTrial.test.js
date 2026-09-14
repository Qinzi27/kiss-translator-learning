import { act } from "react";
import { createRoot } from "react-dom/client";
import FreeApiTrial, { FREE_API_TRIAL_SAMPLES } from "./FreeApiTrial";
import { DEFAULT_API_LIST, OPT_TRANS_MYMEMORY } from "../../config/api";
import { apiTranslate } from "../../apis";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockSetting;
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
    put: mockPutRule,
  }),
}));
jest.mock("../../apis", () => ({ apiTranslate: jest.fn() }));
const preset = DEFAULT_API_LIST.find(
  (api) => api.apiType === OPT_TRANS_MYMEMORY
);

function renderCard() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<FreeApiTrial />));
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}
function button(container, label) {
  return Array.from(container.querySelectorAll("button")).find(
    (item) => item.textContent === label
  );
}
async function click(container, label) {
  await act(async () => button(container, label).click());
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSetting = {
    networkPolicy: "normal",
    untouched: "keep",
    transApis: [{ apiSlug: "microsoft", key: "existing-secret" }],
  };
  mockUpdateSetting.mockImplementation((updater) => {
    mockSetting = updater(mockSetting);
  });
  apiTranslate.mockResolvedValue({ trText: "图书馆早上九点开门。" });
});
afterEach(() => {
  document.body.innerHTML = "";
});

test("shows a bounded synthetic sample without requests, saves, or global service changes", () => {
  const view = renderCard();
  expect(view.container.textContent).toContain("MyMemory · 免Key试用");
  expect(view.container.textContent).toContain("不是聊天 AI，不使用 Skill");
  expect(view.container.textContent).toContain("每次请求最多 500 字节");
  expect(view.container.textContent).toContain("服务商可能留存请求文本");
  const docs = view.container.querySelector(
    'a[href="https://mymemory.translated.net/doc/spec.php"]'
  );
  expect(docs).not.toBeNull();
  expect(docs.rel).toContain("noopener");
  for (const sample of Object.values(FREE_API_TRIAL_SAMPLES))
    expect(new Blob([sample.text]).size).toBeLessThanOrEqual(500);
  expect(apiTranslate).not.toHaveBeenCalled();
  expect(mockUpdateSetting).not.toHaveBeenCalled();
  expect(mockPutRule).not.toHaveBeenCalled();
  view.unmount();
});

test("click tests the no-key preset and displays the actual response without saving", async () => {
  const view = renderCard();
  await click(view.container, "测试免费接口");
  expect(apiTranslate).toHaveBeenCalledTimes(1);
  expect(apiTranslate).toHaveBeenCalledWith(
    expect.objectContaining({
      ...FREE_API_TRIAL_SAMPLES.enToZh,
      apiSetting: expect.objectContaining({
        apiType: OPT_TRANS_MYMEMORY,
        url: preset.url,
        key: "",
        reqHook: "",
        resHook: "",
      }),
      useCache: false,
      usePool: false,
    })
  );
  expect(
    view.container.querySelector('[data-testid="free-api-result"]').textContent
  ).toBe("图书馆早上九点开门。");
  expect(mockUpdateSetting).not.toHaveBeenCalled();
  expect(mockPutRule).not.toHaveBeenCalled();
  view.unmount();
});

test("switching direction does not submit; clicking then requests Chinese to English", async () => {
  const view = renderCard();
  await click(view.container, "中文 → 英文");
  expect(apiTranslate).not.toHaveBeenCalled();
  expect(
    view.container.querySelector('[data-testid="free-api-source"]').textContent
  ).toBe(FREE_API_TRIAL_SAMPLES.zhToEn.text);
  await click(view.container, "测试免费接口");
  expect(apiTranslate).toHaveBeenCalledWith(
    expect.objectContaining(FREE_API_TRIAL_SAMPLES.zhToEn)
  );
  view.unmount();
});

test("offline blocks testing, and explicit policy switch still requires a separate test click", async () => {
  mockSetting.networkPolicy = "offline";
  const view = renderCard();
  expect(button(view.container, "测试免费接口").disabled).toBe(true);
  await click(view.container, "测试免费接口");
  expect(apiTranslate).not.toHaveBeenCalled();
  expect(mockUpdateSetting).not.toHaveBeenCalled();
  await click(view.container, "切到屏蔽谷歌模式");
  expect(mockSetting.networkPolicy).toBe("no-google");
  expect(mockSetting.transApis).toEqual([
    { apiSlug: "microsoft", key: "existing-secret" },
  ]);
  expect(mockSetting.untouched).toBe("keep");
  expect(apiTranslate).not.toHaveBeenCalled();
  expect(mockPutRule).not.toHaveBeenCalled();
  expect(button(view.container, "测试免费接口").disabled).toBe(false);
  await click(view.container, "测试免费接口");
  expect(apiTranslate).toHaveBeenCalledTimes(1);
  view.unmount();
});

test("add appends only the preset and leaves offline policy and global selection intact", async () => {
  mockSetting.networkPolicy = "offline";
  const view = renderCard();
  await click(view.container, "添加到翻译服务");
  expect(mockSetting.transApis).toEqual([
    { apiSlug: "microsoft", key: "existing-secret" },
    preset,
  ]);
  expect(mockSetting.networkPolicy).toBe("offline");
  expect(mockSetting.untouched).toBe("keep");
  expect(button(view.container, "添加到翻译服务").disabled).toBe(true);
  expect(view.container.textContent).toContain("请刷新阅读页面");
  expect(apiTranslate).not.toHaveBeenCalled();
  expect(mockPutRule).not.toHaveBeenCalled();
  view.unmount();
});

test("existing same-slug settings are preserved, while a trial never sends their key or URL", async () => {
  const existing = {
    ...preset,
    apiName: "My custom name",
    key: "do-not-send",
    url: "https://custom.example.test/",
    reqHook: "private-hook",
  };
  mockSetting.transApis.push(existing);
  const view = renderCard();
  await click(view.container, "添加到翻译服务");
  expect(mockUpdateSetting).not.toHaveBeenCalled();
  expect(mockSetting.transApis[1]).toBe(existing);
  await click(view.container, "测试免费接口");
  const request = apiTranslate.mock.calls[0][0];
  expect(request.apiSetting.url).toBe(preset.url);
  expect(request.apiSetting.key).toBe("");
  expect(request.apiSetting.reqHook).toBe("");
  expect(JSON.stringify(request)).not.toContain("do-not-send");
  view.unmount();
});

test("API errors and empty responses are shown without fallback or persistence", async () => {
  const view = renderCard();
  apiTranslate.mockRejectedValueOnce(new Error("今日免费额度已用完"));
  await click(view.container, "测试免费接口");
  expect(view.container.textContent).toContain("今日免费额度已用完");
  expect(
    view.container.querySelector('[data-testid="free-api-result"]')
  ).toBeNull();
  apiTranslate.mockResolvedValueOnce({ trText: " " });
  await click(view.container, "测试免费接口");
  expect(view.container.textContent).toContain("免费接口返回了空译文");
  expect(apiTranslate).toHaveBeenCalledTimes(2);
  expect(mockUpdateSetting).not.toHaveBeenCalled();
  view.unmount();
});

test("in-flight test cannot duplicate and unmount aborts it", async () => {
  let finish;
  apiTranslate.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const view = renderCard();
  await click(view.container, "测试免费接口");
  expect(button(view.container, "正在测试免费接口…").disabled).toBe(true);
  await click(view.container, "正在测试免费接口…");
  expect(apiTranslate).toHaveBeenCalledTimes(1);
  const signal = apiTranslate.mock.calls[0][0].signal;
  view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ trText: "late response" }));
});

test("returned markup is shown as text", async () => {
  apiTranslate.mockResolvedValue({ trText: '<img src=x onerror="alert(1)">' });
  const view = renderCard();
  await click(view.container, "测试免费接口");
  expect(
    view.container.querySelector('[data-testid="free-api-result"]').textContent
  ).toContain("<img");
  expect(view.container.querySelector("img")).toBeNull();
  view.unmount();
});
