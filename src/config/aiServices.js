import { DEFAULT_API_LIST, OPT_TRANS_OPENAI } from "./api";
import { createTranslationSkillTemplate } from "./translationSkill";

// Official service documentation checked on 2026-09-14. Quotas belong to the
// provider account; a free chat website is not a free API subscription.
export const AI_SERVICES = [
  {
    id: "doubao", name: "豆包 · 火山方舟", badge: "有限试用",
    billingNote: "API 试用额度和适用模型以方舟控制台为准，用完按量付费。",
    url: "https://ark.cn-beijing.volces.com/api/v3/chat/completions", model: "",
    modelHint: "填写控制台接入点 ID，例如 ep-…",
    docsUrl: "https://www.volcengine.com/docs/82379/1494384",
    pricingUrl: "https://www.volcengine.com/product/ark",
    webUrl: "https://www.doubao.com/chat/", webSupported: true,
  },
  {
    id: "kimi", name: "Kimi · 月之暗面", badge: "API 按量付费",
    billingNote: "网页账户权益与 API 分开；默认关闭思考，使用模型要求的温度。",
    url: "https://api.moonshot.cn/v1/chat/completions", model: "kimi-k2.6",
    docsUrl: "https://platform.kimi.com/docs/guide/migrating-from-openai-to-kimi",
    pricingUrl: "https://platform.kimi.ai/docs/pricing/chat",
    webUrl: "https://www.kimi.com/", webSupported: true,
  },
  {
    id: "deepseek", name: "DeepSeek", badge: "API 按量付费",
    billingNote: "API 按 Token 计费，网页可用额度不等于 API 额度。",
    url: "https://api.deepseek.com/chat/completions", model: "deepseek-v4-flash",
    docsUrl: "https://api-docs.deepseek.com/api_samples/chat_curl/",
    pricingUrl: "https://api-docs.deepseek.com/quick_start/pricing/",
    webUrl: "https://chat.deepseek.com/",
  },
  {
    id: "qwen", name: "千问 · 阿里云百炼", badge: "限期试用",
    billingNote: "北京地域新人有适用模型的限期额度；使用匹配该地域的 API Key。",
    url: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", model: "qwen-flash",
    docsUrl: "https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions",
    pricingUrl: "https://help.aliyun.com/zh/model-studio/new-free-quota",
    webUrl: "https://www.qianwen.com/",
  },
  {
    id: "glm", name: "智谱 GLM", badge: "有免费模型",
    billingNote: "预选 GLM-4.7-Flash 免费模型，需要 API Key；换模型后请重新确认价格。",
    url: "https://open.bigmodel.cn/api/paas/v4/chat/completions", model: "glm-4.7-flash",
    docsUrl: "https://docs.bigmodel.cn/cn/guide/models/free/glm-4.7-flash",
    pricingUrl: "https://bigmodel.cn/pricing", webUrl: "https://bigmodel.cn/",
  },
  {
    id: "hunyuan", name: "腾讯混元 · TokenHub", badge: "新人体验额度",
    billingNote: "新用户使用 TokenHub。领取与启用条件以控制台为准，用完按量计费。",
    url: "https://tokenhub.tencentmaas.com/v1/chat/completions", model: "",
    modelHint: "复制控制台中的模型服务 ID；不使用旧 hunyuan-lite 名称",
    docsUrl: "https://cloud.tencent.com/document/product/1823/130079",
    pricingUrl: "https://cloud.tencent.com/document/product/1823/130053",
    webUrl: "https://cloud.tencent.com/product/tokenhub",
  },
  {
    id: "siliconflow", name: "硅基流动", badge: "可选免费模型",
    billingNote: "官方翻译示例使用 Qwen2.5-7B-Instruct；先在当前控制台确认免费价格和实名要求。",
    url: "https://api.siliconflow.cn/v1/chat/completions", model: "Qwen/Qwen2.5-7B-Instruct",
    docsUrl: "https://docs.siliconflow.cn/docs/usercases/use-siliconcloud-in-bob",
    pricingUrl: "https://siliconflow.cn/pricing", webUrl: "https://cloud.siliconflow.cn/",
  },
  {
    id: "openrouter", name: "OpenRouter", badge: "免费模型 / 限额",
    billingNote: "预选固定 Qwen 免费模型，需要 API Key，有每日请求限制；网关可达性以实际网络为准。",
    url: "https://openrouter.ai/api/v1/chat/completions", model: "qwen/qwen3-next-80b-a3b-instruct:free",
    docsUrl: "https://openrouter.ai/docs/quickstart",
    pricingUrl: "https://openrouter.ai/qwen/qwen3-next-80b-a3b-instruct:free",
    webUrl: "https://openrouter.ai/",
  },
];

export const CUSTOM_AI_SERVICE = {
  id: "custom", name: "自定义 AI API", badge: "自备服务",
  billingNote: "支持 OpenAI Chat Completions 兼容协议。填写自己的服务地址、Key 和模型。",
  url: "", model: "", modelHint: "服务商提供的准确模型 ID",
};

export const getLearningAiSlug = (providerId, transport = "api") =>
  `learning-ai-${providerId}-${transport}`;

export function normalizeAiEndpoint(value) {
  let url;
  try { url = new URL(String(value).trim()); } catch {
    throw new Error("请填写完整的 API 地址，例如 https://example.com/v1。");
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error("API 地址须为 HTTP(S)，不能包含用户名、密码、查询参数或锚点。");
  if (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw new Error("远程 API 请使用 HTTPS；HTTP 仅用于本机服务。");
  let path = url.pathname.replace(/\/+$/, "");
  if (!path) path = "/v1/chat/completions";
  else if (!path.endsWith("/chat/completions")) path += "/chat/completions";
  url.pathname = path;
  return url.href;
}

export function buildLearningAiApi({ providerId, transport = "api", key = "", model, url,
  preferences = "", apiName = "" } = {}) {
  const provider = [...AI_SERVICES, CUSTOM_AI_SERVICE].find((item) => item.id === providerId);
  if (!provider) throw new Error("请选择已支持的服务，或使用自定义 API。");
  if (!["api", "web"].includes(transport)) throw new Error("请选择 API 或后台网页方式。");
  if (transport === "web" && !provider.webSupported) throw new Error("该服务暂未提供后台网页适配。");
  const prompt = createTranslationSkillTemplate({ preferences });
  const endpoint = transport === "web" ? provider.webUrl : normalizeAiEndpoint(providerId === "custom" ? url : provider.url);
  const modelId = String(model ?? provider.model).trim();
  if (transport === "api" && !modelId) throw new Error("请填写模型或接入点 ID。");
  if (modelId.length > 200) throw new Error("模型 ID 过长。");
  if (transport === "api" && !String(key).trim() && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(endpoint).hostname))
    throw new Error("请填写该服务的 API Key；免费模型通常也需要 Key。");
  const api = {
    ...DEFAULT_API_LIST.find((item) => item.apiType === OPT_TRANS_OPENAI),
    apiSlug: getLearningAiSlug(providerId, transport), apiType: OPT_TRANS_OPENAI,
    apiName: String(apiName).trim() || `${provider.name} · ${transport === "web" ? "后台网页" : "AI 翻译"}`,
    url: endpoint, model: modelId, key: transport === "api" ? String(key).trim() : "",
    modelListUrl: "", isDisabled: false, sortOrder: -1,
    useBatchFetch: false, useStream: false, streamRenderMode: "disabled", useContext: false,
    fetchLimit: 1, fetchInterval: transport === "web" ? 1000 : 300,
    httpTimeout: transport === "web" ? 150 : 90, maxTokens: 4096,
    temperature: providerId === "kimi" ? 0.6 : 0.2,
    thinkingMode: "auto", thinkingEffort: "_default",
    reqHook: "", resHook: "", customHeader: "", customBody: "",
    learningAi: { providerId, transport, preferences, skillVersion: 1 },
    nobatchPrompt: prompt.systemPrompt, nobatchUserPrompt: prompt.userPrompt,
  };
  delete api.nobatchPromptSlug;
  return api;
}

export function upsertLearningAiApi(previous = [], api) {
  const exists = previous.some((item) => item.apiSlug === api.apiSlug);
  return exists ? previous.map((item) => item.apiSlug === api.apiSlug ? api : item) : [...previous, api];
}

// Apply only to the explicitly configured learning services, never to imported
// upstream providers. This keeps the skill and non-streaming output contract stable.
export function resolveLearningAiApi(api) {
  if (!api?.learningAi) return api;
  const next = buildLearningAiApi({ ...api.learningAi, ...api });
  return { ...api, ...next, apiSlug: api.apiSlug, sortOrder: api.sortOrder };
}

export function learningAiBodyOptions(api) {
  const id = api.learningAi?.providerId;
  if (id === "kimi") return { temperature: 0.6, thinking: { type: "disabled" } };
  if (id === "deepseek" || id === "glm") return { thinking: { type: "disabled" } };
  if (id === "qwen") return { enable_thinking: false };
  if (id === "hunyuan" && /^hy3(?:$|-)/i.test(api.model)) return { thinking: { type: "disabled" } };
  if (id === "siliconflow" && /Qwen3/i.test(api.model)) return { enable_thinking: false };
  return {};
}
