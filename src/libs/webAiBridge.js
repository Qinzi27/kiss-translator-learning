import { browser as extensionBrowser } from "./browser";
import { applyNetworkPolicy, resolveNetworkPolicy } from "./networkPolicy";
import { buildManualTranslationPrompt } from "../config/translationSkill";
import { webAiDomAdapter } from "./webAiDomAdapter";

export const WEB_AI_PROVIDERS = Object.freeze({
  doubao: Object.freeze({
    id: "doubao",
    label: "豆包网页（实验性）",
    origin: "https://www.doubao.com",
    url: "https://www.doubao.com/chat/",
    experimental: true,
  }),
  kimi: Object.freeze({
    id: "kimi",
    label: "Kimi 网页（实验性）",
    origin: "https://www.kimi.com",
    url: "https://www.kimi.com/",
    experimental: true,
  }),
});

const MAX_QUEUE = 3;
const jobs = [];
let currentJob;

export class WebAiBridgeError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = "WebAiBridgeError";
    this.code = code;
    Object.assign(this, details);
  }
}
const cancelledError = (message = "后台网页翻译已取消；没有自动重试。") =>
  new WebAiBridgeError(message, "WEB_AI_CANCELLED");

export function cancelWebAiTranslations(reason) {
  if (currentJob) currentJob.cancel(cancelledError(reason));
  for (const job of [...jobs]) job.cancel(cancelledError(reason));
}

const randomId = () => {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
};

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason || cancelledError());
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason || cancelledError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

function withAbort(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || cancelledError());
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

async function runJob(job) {
  const { input, dependencies, controller } = job;
  const provider = WEB_AI_PROVIDERS[input.providerId];
  const api = dependencies.browser || extensionBrowser;
  const policy = dependencies.getNetworkPolicy || resolveNetworkPolicy;
  const buildPrompt = dependencies.buildPrompt || buildManualTranslationPrompt;
  const pollMs = dependencies.pollMs ?? 750;
  const sleep = dependencies.sleep || wait;
  const nonce = (dependencies.randomId || randomId)();
  const begin = `KISS_TRANSLATION_BEGIN_${nonce}`;
  const end = `KISS_TRANSLATION_END_${nonce}`;
  const instructionTag = `KISS_WEB_AI_INSTRUCTION_${nonce}`;
  const prompt = `${instructionTag}\nTransport envelope: place the final translation between the exact delimiter lines below. Do not repeat this instruction tag, explain the delimiters, or include any other text outside the envelope. These delimiters are transport metadata, not source text.\n${begin}\n[translation only]\n${end}\n\n${buildPrompt(input)}`;
  let tabId;
  let keepTab = false;
  const check = () => {
    if (controller.signal.aborted) throw job.cancelReason || cancelledError();
  };
  const bounded = (promise) => withAbort(promise, controller.signal);
  const gate = async () => {
    check();
    applyNetworkPolicy(provider.url, {}, await bounded(policy()));
    check();
  };
  const invoke = async (action) => {
    check();
    const tab = await bounded(api.tabs.get(tabId));
    check();
    if (!tab.url || new URL(tab.url).origin !== provider.origin) {
      throw new WebAiBridgeError(
        "AI 网页跳转到了其他地址，已停止操作。请打开后台标签检查登录状态。",
        "WEB_AI_ORIGIN_CHANGED"
      );
    }
    const results = await bounded(
      api.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        func: webAiDomAdapter,
        args: [
          {
            action,
            requestId: nonce,
            deadline: job.deadline,
            providerId: provider.id,
            prompt: action === "prepare" ? prompt : undefined,
            begin,
            end,
            instructionTag,
          },
        ],
      })
    );
    check();
    const result = results?.find((item) => item.frameId === 0)?.result;
    if (!result)
      throw new WebAiBridgeError(
        "无法读取后台 AI 网页，请确认扩展有该网站权限。",
        "WEB_AI_DOM_UNAVAILABLE"
      );
    if (result.state === "error")
      throw new WebAiBridgeError(result.error, result.code);
    return result;
  };
  // Frequent tabs.get / executeScript calls keep MV3 workers active while polling.
  // A lightweight API call also covers a slow navigation/prompt preparation.
  const keepAlive = setInterval(() => {
    Promise.resolve(api?.runtime?.getPlatformInfo?.()).catch(() => {});
  }, 15000);
  try {
    if (!api?.tabs?.create || !api?.scripting?.executeScript)
      throw new WebAiBridgeError(
        "网页自动翻译仅支持安装后的 Chrome / Edge 扩展。",
        "WEB_AI_EXTENSION_REQUIRED"
      );
    await gate();
    const tab = await bounded(
      api.tabs.create({ url: provider.url, active: false }).then((created) => {
        if (controller.signal.aborted) {
          Promise.resolve(api.tabs.remove(created.id)).catch(() => {});
          throw job.cancelReason || cancelledError();
        }
        return created;
      })
    );
    tabId = tab.id;
    check();
    // Only this newly created tab is used: existing user tabs and drafts are never queried.
    while (true) {
      await gate();
      const tabState = await bounded(api.tabs.get(tabId));
      check();
      if (tabState.status !== "complete") {
        await sleep(pollMs, controller.signal);
        continue;
      }
      const ready = await invoke("probe");
      if (ready.state === "ready") break;
      await sleep(pollMs, controller.signal);
    }
    const prepared = await invoke("prepare");
    if (prepared.state !== "prepared")
      throw new WebAiBridgeError(
        "AI 输入框尚未就绪或页面结构已变化，请打开后台标签检查。",
        "WEB_AI_DOM_UNAVAILABLE"
      );
    while (true) {
      await sleep(pollMs, controller.signal);
      await gate(); // Re-read saved policy immediately before every attempt to send.
      const submitted = await invoke("submit");
      if (submitted.state === "sent") break;
    }
    let previous = "";
    while (true) {
      await sleep(pollMs, controller.signal);
      await gate();
      const result = await invoke("read");
      if (result.state === "complete" && result.translation === previous)
        return result.translation;
      previous = result.state === "complete" ? result.translation : "";
    }
  } catch (error) {
    if (controller.signal.aborted) error = job.cancelReason || error;
    const wrapped =
      error instanceof WebAiBridgeError
        ? error
        : new WebAiBridgeError(
            error.message || "后台网页翻译失败。",
            error.code || "WEB_AI_FAILED"
          );
    wrapped.providerId = provider.id;
    // Login/challenge and DOM failures stay inspectable; cancellation and network
    // restrictions close our tab to stop background work. Never focus it automatically.
    keepTab = ![
      "WEB_AI_CANCELLED",
      "WEB_AI_TIMEOUT",
      "NETWORK_POLICY_BLOCKED",
    ].includes(wrapped.code);
    if (keepTab && tabId != null) wrapped.tabId = tabId;
    throw wrapped;
  } finally {
    clearInterval(keepAlive);
    if (!keepTab && tabId != null) {
      try {
        await api.tabs.remove(tabId);
      } catch {
        /* User may have closed it. */
      }
    }
  }
}

async function drain() {
  if (currentJob) return;
  const job = jobs.shift();
  if (!job) return;
  currentJob = job;
  try {
    job.resolve(await runJob(job));
  } catch (error) {
    job.reject(error);
    // A cancellation can be a rapid A → B switch. Never let A's late rejection
    // cancel B. Only actionable website failures clear that provider's backlog.
    const requiresAttention =
      [
        "WEB_AI_LOGIN_REQUIRED",
        "WEB_AI_VERIFICATION_REQUIRED",
        "WEB_AI_DRAFT_PRESENT",
        "WEB_AI_DOM_UNAVAILABLE",
        "WEB_AI_ORIGIN_CHANGED",
        "WEB_AI_EDITOR_CHANGED",
        "WEB_AI_REQUEST_LOST",
        "WEB_AI_REQUEST_CONFLICT",
        "WEB_AI_FAILED",
      ].includes(error.code) && error.name !== "AbortError";
    if (requiresAttention) {
      for (const waiting of [...jobs]) {
        if (waiting.input.providerId === job.input.providerId) {
          waiting.cancel(
            cancelledError(
              "该网站需要处理登录或页面问题，同网站排队任务已取消，请处理后重新翻译。"
            )
          );
        }
      }
    }
  } finally {
    job.cleanup();
    currentJob = undefined;
    drain();
  }
}

/** Returns plain translation text. Sender authorization and saved-provider
 * selection belong in the background message handler, never in page input.
 * The timeout includes queue time; cancelling or timing out never retries Send.
 */
export function translateInWebAi(input, dependencies = {}) {
  const provider = WEB_AI_PROVIDERS[input?.providerId];
  if (!provider)
    return Promise.reject(
      new WebAiBridgeError("不支持的 AI 网页服务。", "WEB_AI_UNKNOWN_PROVIDER")
    );
  try {
    if (input.senderTabUrl) {
      const sender = new URL(input.senderTabUrl);
      if (
        Object.values(WEB_AI_PROVIDERS).some(
          (item) => sender.origin === item.origin
        )
      )
        throw new WebAiBridgeError(
          "AI 聊天网页内已停用网页翻译通道，避免递归提交。",
          "WEB_AI_RECURSION_BLOCKED"
        );
    }
    // Validate source/preferences before creating any tab or entering the queue.
    buildManualTranslationPrompt(input);
  } catch (error) {
    return Promise.reject(error);
  }
  if (jobs.length + (currentJob ? 1 : 0) >= MAX_QUEUE)
    return Promise.reject(
      new WebAiBridgeError(
        "后台网页翻译队列已满（最多 3 项），请等待完成后再试。",
        "WEB_AI_QUEUE_FULL"
      )
    );
  if (dependencies.signal?.aborted) return Promise.reject(cancelledError());
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timeoutMs = Math.min(
      180000,
      Math.max(1000, dependencies.timeoutMs ?? 120000)
    );
    const job = {
      input: { ...input },
      dependencies,
      controller,
      deadline: Date.now() + timeoutMs,
      resolve,
      reject,
    };
    job.cancel = (reason) => {
      job.cancelReason = reason;
      controller.abort(reason);
      const index = jobs.indexOf(job);
      if (index !== -1) {
        jobs.splice(index, 1);
        reject(reason);
        job.cleanup();
      }
    };
    const abort = () => job.cancel(cancelledError());
    const timer = setTimeout(
      () =>
        job.cancel(
          new WebAiBridgeError(
            "后台网页翻译超时（含排队时间），已关闭本次任务标签且不会自动重发。请确认网站可访问、已登录后重试。",
            "WEB_AI_TIMEOUT"
          )
        ),
      timeoutMs
    );
    job.cleanup = () => {
      clearTimeout(timer);
      dependencies.signal?.removeEventListener("abort", abort);
    };
    dependencies.signal?.addEventListener("abort", abort, { once: true });
    jobs.push(job);
    drain();
  });
}
