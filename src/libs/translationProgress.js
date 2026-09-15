// Per-Translator state. This store never uses page-controlled DOM events and
// contains no source text, settings, URLs or provider errors.
export const IDLE_TRANSLATION_PROGRESS = Object.freeze({
  phase: "idle",
  enabled: false,
  queued: 0,
  active: 0,
  completed: 0,
});
export const isTranslationBusy = ({ phase }) =>
  ["preparing", "queued", "translating"].includes(phase);

export function translationProgressLabel(state) {
  switch (state.phase) {
    case "preparing":
      return "正在准备翻译，查找可译内容";
    case "queued":
      return `正在处理待译内容（${state.queued} 项）`;
    case "translating":
      return `正在翻译，等待服务返回（${state.active} 项；已处理 ${state.completed} 段）`;
    case "done":
      return state.completed
        ? `当前阅读范围处理完成（${state.completed} 段）；滚动后继续翻译`
        : "翻译已开启，当前阅读范围没有待处理内容";
    case "error":
      return "部分翻译未完成，请查看段落错误或切换服务";
    case "stopped":
      return "翻译已停止，点击可重新开始";
    default:
      return "点击翻译当前网页";
  }
}

export function createTranslationProgress() {
  let generation = 0;
  let enabled = false;
  let preparing = false;
  let stopped = false;
  let failed = false;
  let completed = 0;
  let prepareTimer;
  let snapshot = IDLE_TRANSLATION_PROGRESS;
  const tasks = new Set();
  const requests = new Set();
  const listeners = new Set();
  const publish = () => {
    const active = requests.size;
    const queued = Math.max(0, tasks.size - active);
    const phase = !enabled
      ? stopped
        ? "stopped"
        : "idle"
      : active
        ? "translating"
        : tasks.size
          ? "queued"
          : preparing
            ? "preparing"
            : failed
              ? "error"
              : "done";
    const next = { phase, enabled, queued, active, completed };
    if (Object.keys(next).every((key) => next[key] === snapshot[key])) return;
    snapshot = Object.freeze(next);
    listeners.forEach((listener) => listener());
  };
  const reset = (nextEnabled, wasStopped) => {
    generation++;
    clearTimeout(prepareTimer);
    tasks.clear();
    requests.clear();
    enabled = nextEnabled;
    stopped = wasStopped;
    failed = false;
    completed = 0;
    preparing = nextEnabled;
    publish();
    if (nextEnabled) {
      const current = generation;
      // An observer may find no eligible nodes. A bounded preparation state
      // must not become an endless spinner on empty/hidden/non-text pages.
      prepareTimer = setTimeout(() => {
        if (current !== generation) return;
        preparing = false;
        publish();
      }, 150);
    }
  };
  const add = (set, isRequest) => {
    if (!enabled) return () => {};
    if (snapshot.phase === "error") failed = false;
    const current = generation;
    const token = {};
    set.add(token);
    preparing = false;
    publish();
    return (outcome = "success") => {
      if (current !== generation || !set.delete(token)) return;
      if (outcome === "error") failed = true;
      if (isRequest && outcome === "success") completed++;
      publish();
    };
  };
  return {
    readonly: Object.freeze({
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    }),
    start: (nextEnabled = true) => reset(nextEnabled, false),
    stop: () => reset(false, true),
    task: () => add(tasks, false),
    request: () => add(requests, true),
    error: () => {
      if (enabled) {
        failed = true;
        preparing = false;
        publish();
      }
    },
  };
}
