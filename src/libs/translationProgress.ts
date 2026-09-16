// Per-Translator state. This store never uses page-controlled DOM events and
// contains no source text, settings, URLs or provider errors.
export type TranslationPhase =
  | "idle"
  | "preparing"
  | "queued"
  | "translating"
  | "done"
  | "error"
  | "stopped";

export interface TranslationProgressSnapshot {
  readonly phase: TranslationPhase;
  readonly enabled: boolean;
  readonly queued: number;
  readonly active: number;
  readonly completed: number;
}

export type TranslationTaskOutcome = "success" | "error" | "cancelled";
export type FinishTranslationTask = (outcome?: TranslationTaskOutcome) => void;
export type TranslationProgressListener = () => void;

// Consumers can observe progress, but only the owning Translator can change it.
export interface TranslationProgressStore {
  readonly getSnapshot: () => TranslationProgressSnapshot;
  readonly subscribe: (listener: TranslationProgressListener) => () => void;
}

export interface TranslationProgressController {
  readonly readonly: TranslationProgressStore;
  start(nextEnabled?: boolean): void;
  stop(): void;
  task(): FinishTranslationTask;
  request(): FinishTranslationTask;
  error(): void;
}

export const IDLE_TRANSLATION_PROGRESS: TranslationProgressSnapshot =
  Object.freeze({
    phase: "idle",
    enabled: false,
    queued: 0,
    active: 0,
    completed: 0,
  });
export const isTranslationBusy = ({
  phase,
}: Pick<TranslationProgressSnapshot, "phase">): boolean =>
  ["preparing", "queued", "translating"].includes(phase);

export function translationProgressLabel(
  state: TranslationProgressSnapshot
): string {
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

export function createTranslationProgress(): TranslationProgressController {
  let generation = 0;
  let enabled = false;
  let preparing = false;
  let stopped = false;
  let failed = false;
  let completed = 0;
  let prepareTimer: ReturnType<typeof setTimeout> | undefined;
  let snapshot = IDLE_TRANSLATION_PROGRESS;
  const tasks = new Set<object>();
  const requests = new Set<object>();
  const listeners = new Set<TranslationProgressListener>();
  const publish = () => {
    const active = requests.size;
    const queued = Math.max(0, tasks.size - active);
    const phase: TranslationPhase = !enabled
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
    const next: TranslationProgressSnapshot = {
      phase,
      enabled,
      queued,
      active,
      completed,
    };
    // These keys come only from the snapshot literal above, never external data.
    if (
      (Object.keys(next) as (keyof TranslationProgressSnapshot)[]).every(
        (key) => next[key] === snapshot[key]
      )
    )
      return;
    snapshot = Object.freeze(next);
    listeners.forEach((listener) => listener());
  };
  const reset = (nextEnabled: boolean, wasStopped: boolean) => {
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
  const add = (set: Set<object>, isRequest: boolean): FinishTranslationTask => {
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
      subscribe: (listener: TranslationProgressListener) => {
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
