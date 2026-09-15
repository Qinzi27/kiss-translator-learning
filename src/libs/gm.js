// Native APIs remain available only to the userscript's isolated implementation.
export const USERSCRIPT_SETTINGS_DISABLED =
  "安全版已停用油猴外置设置页：此网页不能读取或修改油猴配置，也不能代发网络请求。请使用 Chrome / Edge 扩展的内置选项页。";

/**
 * 获取原生的 GM (Greasemonkey) 对象。
 * 兼容不同的油猴脚本管理器环境（部分管理器将其暴露为独立变量，部分挂载于 globalThis）。
 * @returns {Object|undefined} 返回原生的 GM 对象，若不存在则返回 undefined
 */
export function getNativeGm() {
  if (typeof GM !== "undefined") {
    return GM;
  }

  return globalThis.GM;
}

/**
 * 通用方法：安全地获取并绑定对应的 GM API 接口。
 * 执行查找策略：
 * 1. 优先在传入的 fallbackObjects (例如沙盒桥接的 window.KISS_GM) 中查找。
 * 2. 其次在原生 GM Promise API (如 GM.setValue) 中查找。
 * 3. 最后回退查找旧版同步 API (如 GM_setValue)。
 * @param {string} method 新版 Promise 风格的 GM API 键名 (例如 "setValue")
 * @param {string} legacyMethod 旧版同步风格的 GM API 键名 (例如 "GM_setValue")
 * @param {Array<Object>} fallbackObjects 需要优先遍历的备选/代理对象数组
 * @returns {Function} 已绑定正确上下文 (this) 的可执行 GM API 函数
 * @throws {Error} 若在所有备选环境中均找不到该 API，则抛出异常
 */
export function getGmMethod(method, legacyMethod, fallbackObjects = []) {
  const gmObjects = [...fallbackObjects, getNativeGm()];
  for (const obj of gmObjects) {
    const api = obj?.[method];
    if (typeof api === "function") {
      // 必须绑定原始上下文，防止原生函数调用时丢失对象指针而报错 (Illegal invocation)
      return api.bind(obj);
    }
  }

  const legacyApi = globalThis[legacyMethod];
  if (typeof legacyApi === "function") {
    return legacyApi;
  }

  throw new Error(`GM API is not available: ${method}`);
}

// Kept as inert compatibility exports: stale bundles must not resurrect the
// public CustomEvent privilege bridge or expose GM on the page's window.
export const injectScript = () => {};
export const adaptScript = () => {
  throw new Error(USERSCRIPT_SETTINGS_DISABLED);
};
export const handlePing = async () => undefined;
