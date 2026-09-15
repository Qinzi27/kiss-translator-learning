// Sharing is deliberately an allowlist: new/unknown fields must never silently
// become part of a backup or cloud payload. Local storage remains the full copy.
const SETTING_FIELDS = [
  "version", "darkMode", "uiLang", "minLength", "maxLength", "newlineLength",
  "httpTimeout", "clearCache", "popupDefaultView", "fabClickAction",
  "contextMenuType", "translateVariants", "parseLatex", "transInterval",
  "langDetector", "preInit", "transAllnow", "logLevel", "rootMargin",
];
const API_FIELDS = [
  "apiSlug", "apiType", "apiName", "model", "isDisabled", "isPinned",
  "sortOrder", "useStream", "streamRenderMode", "useBatchFetch", "useContext",
  "fetchLimit", "fetchInterval", "httpTimeout", "maxTokens", "temperature",
  "thinkingMode", "thinkingEffort",
];
const PRIVATE_API_FIELDS = [
  "key", "customHeader", "customBody", "reqHook", "resHook", "systemPrompt",
  "nobatchPrompt", "nobatchUserPrompt", "subtitlePrompt", "dictPrompt",
];
// Unknown paths can embed credentials (for example /secret-token/translate).
// Only ordinary public API routes are shared; other endpoints stay local.
const PUBLIC_API_PATH = /^\/(?:v\d+(?:beta\d*)?\/)?(?:chat\/completions|messages|models|translate|translate_text|api\/(?:chat|generate|translate)|get)?\/?$/;
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const pickScalars = (value, fields) => {
  const result = {};
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) continue;
    const item = value[field];
    if (typeof item === "string" || typeof item === "boolean" ||
        (typeof item === "number" && Number.isFinite(item))) result[field] = item;
  }
  return result;
};

export const SETTINGS_SHARING_NOTICE =
  "导出和设置同步只包含常用偏好与服务骨架，不包含 API Key、自定义请求头/请求体、脚本、提示词、订阅地址或未知字段。含凭据或特殊路径的服务地址也不共享。新设备需重新填写；本机已有凭据服务不会被远端改址或删除。联网策略只在本机修改。";

export const SAFE_SETTINGS_EXPORT = "kiss-settings-safe-v1";
export const createSettingsExport = (setting) => ({
  ...sanitizeSettings(setting), settingsExportFormat: SAFE_SETTINGS_EXPORT,
});

export function shareableEndpoint(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash ||
        !PUBLIC_API_PATH.test(url.pathname) ||
        !(url.protocol === "https:" || (url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) return "";
    return url.href;
  } catch { return ""; }
}

function sanitizeApi(api) {
  const safe = pickScalars(api, API_FIELDS);
  for (const field of ["url", "modelListUrl"]) {
    if (Object.prototype.hasOwnProperty.call(api, field)) safe[field] = shareableEndpoint(api[field]);
  }
  if (isRecord(api.learningAi)) {
    safe.learningAi = pickScalars(api.learningAi, ["providerId", "transport", "skillVersion"]);
  }
  return safe;
}

export function sanitizeSettings(setting) {
  if (!isRecord(setting)) throw new Error("设置必须是 JSON 对象，已保留本机配置。");
  const safe = pickScalars(setting, SETTING_FIELDS);
  for (const field of ["touchModes", "skipLangs"]) {
    if (Array.isArray(setting[field])) {
      safe[field] = setting[field].filter((item) => typeof item === "string" ||
        (typeof item === "number" && Number.isFinite(item)));
    }
  }
  if (Array.isArray(setting.transApis)) {
    const slugs = new Set();
    safe.transApis = setting.transApis.filter((api) => isRecord(api) &&
      typeof api.apiSlug === "string" && api.apiSlug && typeof api.apiType === "string")
      .map((api) => {
        if (slugs.has(api.apiSlug)) throw new Error("同步设置含重复的服务标识，已保留本机配置。");
        slugs.add(api.apiSlug);
        return sanitizeApi(api);
      });
  }
  return safe;
}

function hasPrivateConfiguration(api) {
  return PRIVATE_API_FIELDS.some((field) => Boolean(api[field])) ||
    Boolean(api.learningAi?.preferences) ||
    ["url", "modelListUrl"].some((field) => api[field] && !shareableEndpoint(api[field]));
}

function sameCredentialDestination(local, remote) {
  if (local.apiType !== remote.apiType || !shareableEndpoint(local.url) ||
      shareableEndpoint(local.url) !== remote.url) return false;
  // A model discovery URL can receive the same Key, so protect it too.
  if ((shareableEndpoint(local.modelListUrl) || "") !== (remote.modelListUrl || "")) return false;
  return ["providerId", "transport"].every((field) =>
    local.learningAi?.[field] === remote.learningAi?.[field]);
}

export function mergeSyncedSettings(remote, local = {}) {
  const safe = sanitizeSettings(remote);
  const existing = isRecord(local) ? local : {};
  const result = { ...existing, ...safe };
  if (!Array.isArray(safe.transApis)) return result;
  const localApis = Array.isArray(existing.transApis) ? existing.transApis : [];
  const bySlug = new Map(localApis.map((api) => [api.apiSlug, api]));
  const seen = new Set();
  result.transApis = safe.transApis.map((api) => {
    seen.add(api.apiSlug);
    const previous = bySlug.get(api.apiSlug);
    if (!previous) return api;
    if (sameCredentialDestination(previous, api)) {
      return { ...previous, ...api,
        ...(previous.learningAi && { learningAi: { ...previous.learningAi, ...api.learningAi } }) };
    }
    return hasPrivateConfiguration(previous) ? previous : api;
  });
  for (const api of localApis) {
    if (!seen.has(api.apiSlug) && hasPrivateConfiguration(api)) result.transApis.push(api);
  }
  return result;
}
