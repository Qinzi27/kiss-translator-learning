import { sendBgMsg } from "./msg";
import { isExt } from "./client";
import { MSG_WEB_AI_TRANSLATE, MSG_WEB_AI_CANCEL } from "../config/msg";

// Page-local serial queue. Website submissions must never use TaskPool's
// automatic retry, and only an active job is sent to the background worker.
const waiting = [];
let active;
let generation = 0;
const abortError = () => new DOMException("后台网页翻译已取消。", "AbortError");

export function cancelWebAiClientTasks() {
  generation += 1;
  active?.cancel();
  for (const job of [...waiting]) job.cancel();
}

async function drain() {
  if (active || !waiting.length) return;
  const job = waiting.shift();
  active = job;
  try {
    const response = await Promise.race([
      sendBgMsg(MSG_WEB_AI_TRANSLATE, {
        ...job.args,
        requestId: job.requestId,
      }),
      job.cancelled,
    ]);
    if (job.isCancelled) throw abortError();
    if (response?.error)
      throw Object.assign(new Error(response.error), {
        code: response.code,
        tabId: response.tabId,
      });
    if (typeof response?.trText !== "string" || !response.trText.trim())
      throw new Error("后台网页没有返回有效译文。");
    job.resolve(response.trText);
  } catch (error) {
    job.reject(error);
    // A login, changed DOM or queue error requires a deliberate retry by the user.
    for (const queued of [...waiting]) {
      if (queued.generation === job.generation) queued.cancel();
    }
  } finally {
    job.cleanup();
    active = undefined;
    drain();
  }
}

export function requestWebAiTranslation(args, { signal } = {}) {
  if (!isExt)
    return Promise.reject(
      new Error(
        "后台网页翻译需要加载 Chrome / Edge 扩展；当前 Web 演示不支持该通道。"
      )
    );
  if (signal?.aborted) return Promise.reject(abortError());
  if (waiting.length >= 100)
    return Promise.reject(
      new Error("后台网页待译段落过多，请先翻译当前可见内容。")
    );
  return new Promise((resolve, reject) => {
    let rejectCancelled;
    const cancelled = new Promise((_, rejectCancel) => {
      rejectCancelled = rejectCancel;
    });
    // Pending jobs may be cancelled before their race is attached.
    cancelled.catch(() => {});
    const job = {
      args,
      resolve,
      reject,
      cancelled,
      requestId: crypto.randomUUID(),
      isCancelled: false,
      generation,
    };
    job.cancel = () => {
      if (job.isCancelled) return;
      job.isCancelled = true;
      rejectCancelled(abortError());
      const index = waiting.indexOf(job);
      if (index !== -1) {
        waiting.splice(index, 1);
        reject(abortError());
        job.cleanup();
      }
      if (active === job)
        Promise.resolve(
          sendBgMsg(MSG_WEB_AI_CANCEL, { requestId: job.requestId })
        ).catch(() => {});
    };
    const timer = setTimeout(job.cancel, 15 * 60 * 1000);
    job.cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", job.cancel);
    };
    signal?.addEventListener("abort", job.cancel, { once: true });
    waiting.push(job);
    drain();
  });
}
