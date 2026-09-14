import { translateInWebAi } from "./webAiBridge";
import { getSettingWithDefault } from "./storage";
import { browser } from "./browser";

export function createWebAiMessageHandlers({
  runtimeId = browser?.runtime?.id,
  getSetting = getSettingWithDefault,
  translate = translateInWebAi,
} = {}) {
  const controllers = new Map();
  const ownerKey = (args, sender) => {
    if (!runtimeId || sender?.id !== runtimeId)
      throw new Error("拒绝来自其他扩展或网页的后台翻译请求。");
    if (
      typeof args?.requestId !== "string" ||
      !/^[\w-]{8,80}$/.test(args.requestId)
    )
      throw new Error("无效的网页翻译请求标识。");
    return `${sender.tab?.id ?? "options"}:${sender.frameId ?? 0}:${args.requestId}`;
  };
  return {
    translate: async (args, sender) => {
      let key;
      let controller;
      try {
        key = ownerKey(args, sender);
        if (controllers.has(key))
          throw new Error("本次翻译已经提交，不能重复发送。");
        controller = new AbortController();
        // Reserve before reading storage, so a quick cancellation cannot race past it.
        controllers.set(key, controller);
        const setting = await getSetting();
        if (controller.signal.aborted)
          throw new DOMException("后台网页翻译已取消。", "AbortError");
        const api = setting.transApis?.find(
          (item) => item.apiSlug === args.apiSlug && !item.isDisabled
        );
        if (api?.learningAi?.transport !== "web")
          throw new Error("请先在 AI 翻译向导保存后台网页配置，再开始翻译。");
        const trText = await translate(
          {
            providerId: api.learningAi.providerId,
            text: args.text,
            fromLang: args.fromLang,
            toLang: args.toLang,
            preferences: api.learningAi.preferences || "",
            glossary: args.glossary || "",
            senderTabUrl: sender.tab?.url,
          },
          { signal: controller.signal }
        );
        return { trText };
      } catch (error) {
        return {
          error: error.message || "后台网页翻译失败。",
          code: error.code || error.name,
          ...(Number.isInteger(error.tabId) && { tabId: error.tabId }),
        };
      } finally {
        if (key && controller && controllers.get(key) === controller)
          controllers.delete(key);
      }
    },
    cancel: (args, sender) => {
      const key = ownerKey(args, sender);
      controllers.get(key)?.abort();
      return { cancelled: true };
    },
  };
}
