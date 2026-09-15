export const NETWORK_POLICY_NORMAL = "normal";
export const NETWORK_POLICY_NO_GOOGLE = "no-google";
export const NETWORK_POLICY_OFFLINE = "offline";
export const NETWORK_POLICIES = [
  [NETWORK_POLICY_NORMAL, "常规联网"],
  [NETWORK_POLICY_NO_GOOGLE, "屏蔽谷歌"],
  [NETWORK_POLICY_OFFLINE, "仅本机离线"],
];

const GOOGLE_DOMAINS = [
  "googleapis.com",
  "googleapis.cn",
  "googleusercontent.com",
  "gstatic.com",
  "gstatic.cn",
  "googlevideo.com",
  "youtube.com",
  "youtu.be",
];
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export class NetworkPolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = "NetworkPolicyError";
    this.code = "NETWORK_POLICY_BLOCKED";
  }
}

export const normalizeNetworkPolicy = (value = NETWORK_POLICY_NORMAL) => {
  if (!NETWORK_POLICIES.some(([key]) => key === value)) {
    throw new NetworkPolicyError(
      "联网策略无效，请在常规设置中重新选择联网策略。"
    );
  }
  return value;
};

// Read only local storage; never call an API or trust request-supplied overrides.
export const resolveNetworkPolicy = async () => {
  let setting;
  try {
    // Lazy local module load avoids a storage → GM → request import cycle.
    const { getSettingWithDefault } = require("./storage");
    setting = await getSettingWithDefault();
  } catch {
    throw new NetworkPolicyError(
      "无法读取本地联网策略，已停止发送请求，请重试。"
    );
  }
  return normalizeNetworkPolicy(setting?.networkPolicy);
};

export const isGoogleHostname = (hostname) => {
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  // Includes google.com, google.cn, google.co.uk and google.com.hk, with subdomains.
  return (
    /(^|\.)google\.(?:[a-z]{2,3}|(?:com|co)\.[a-z]{2})$/.test(host) ||
    GOOGLE_DOMAINS.some(
      (domain) => host === domain || host.endsWith(`.${domain}`)
    )
  );
};

export function applyNetworkPolicy(
  input,
  init = {},
  mode = NETWORK_POLICY_NORMAL
) {
  const policy = normalizeNetworkPolicy(mode);

  const raw = String(input?.url ?? input).trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new NetworkPolicyError("请求仅接受完整的 HTTP(S) 服务地址。");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new NetworkPolicyError("请求仅允许 HTTP(S) 地址。");
  }

  const authority = raw.match(/^https?:\/\/([^/?#]*)/i)?.[1] || "";
  const writtenHost = authority.startsWith("[")
    ? authority.slice(0, authority.indexOf("]") + 1)
    : authority.split(":")[0];
  const explicitLoopback = !url.username && !url.password &&
    LOOPBACK_HOSTS.has(url.hostname.toLowerCase()) &&
    LOOPBACK_HOSTS.has(writtenHost.toLowerCase());
  if (url.username || url.password) {
    throw new NetworkPolicyError("服务地址不能包含用户名或密码，请使用服务的授权设置。");
  }
  if (url.protocol === "http:" && !explicitLoopback) {
    throw new NetworkPolicyError("已阻止不安全的远程 HTTP 请求，请将服务地址改为 HTTPS；HTTP 仅允许明确的本机回环地址。");
  }

  if (policy === NETWORK_POLICY_OFFLINE) {
    // Check the written host as well: URL canonicalizes 127.1, integer IPs and
    // encoded hostnames. Only these three explicit loopback spellings are accepted.
    if (!explicitLoopback) {
      throw new NetworkPolicyError(
        "仅本机离线模式已阻止远程请求。请选择运行在 localhost、127.0.0.1 或 [::1] 的本地服务。"
      );
    }
  } else if (policy === NETWORK_POLICY_NO_GOOGLE && isGoogleHostname(url.hostname)) {
    throw new NetworkPolicyError(
      "屏蔽谷歌模式已阻止此谷歌域名请求。请手动选择微软翻译或本地服务；不会自动切换服务。"
    );
  }

  // Also protects normal mode against HTTPS → HTTP credential downgrades.
  return { ...init, redirect: "error" };
}

export async function fetchUnderNetworkPolicy(input, init, policy) {
  const guardedInit = applyNetworkPolicy(input, init, policy);
  try {
    return await fetch(input, guardedInit);
  } catch (error) {
    if (error?.name === "AbortError")
      throw error;
    throw new Error(
      "安全联网请求未完成：请检查所选服务是否运行、跨域配置及网络连接；为防止凭据泄漏，禁止 HTTP 重定向。"
    );
  }
}

// All built-in direct HTTP helpers use this entry point, including Options and subtitles.
export async function policyFetch(input, init = {}) {
  return fetchUnderNetworkPolicy(input, init, await resolveNetworkPolicy());
}
