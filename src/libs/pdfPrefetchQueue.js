export const PDF_PREFETCH_PAGES = 2;
export const PDF_TRANSLATION_CONCURRENCY = 2;

export function getPdfTranslationTasks(
  pages,
  pageNumber,
  { allPages = false } = {}
) {
  const current = pages.find((page) => page.number === pageNumber);
  const rest = allPages
    ? pages.filter((page) => page !== current)
    : pages.filter(
        (page) =>
          page.number > pageNumber &&
          page.number <= pageNumber + PDF_PREFETCH_PAGES
      );
  return [current, ...rest].filter(Boolean).flatMap((page) =>
    page.paragraphs.map((paragraph) => ({
      key: `${page.number}-${paragraph.id}`,
      pageNumber: page.number,
      paragraph,
    }))
  );
}

// One authorized document/provider/direction run. Replacing priorities never
// submits the same paragraph twice and does not restart a prefetched page that
// the user just turned to. Already running work may finish; queued old pages go.
export function createPdfPrefetchQueue({
  run,
  onResult,
  onStart = () => {},
  onError = () => {},
  signal,
}) {
  let pending = [];
  let stopped = !!signal?.aborted;
  let failed = false;
  const active = new Map();
  let priorityPage;
  const completed = new Set();
  const waiters = new Set();
  const settle = () => {
    if (!stopped && (pending.length || active.size)) return;
    for (const resolve of waiters) resolve();
    waiters.clear();
  };
  const stop = () => {
    stopped = true;
    pending = [];
    signal?.removeEventListener("abort", stop);
    settle();
  };
  const nextTask = () => {
    // Keep one slot on the current page while the other warms a future page.
    // If no future work exists both slots can serve the current page.
    const foregroundActive = Array.from(active.values()).some(
      (task) => task.pageNumber === priorityPage
    );
    const preferred = pending.findIndex((task) =>
      foregroundActive
        ? task.pageNumber !== priorityPage
        : task.pageNumber === priorityPage
    );
    return pending.splice(preferred < 0 ? 0 : preferred, 1)[0];
  };
  const launch = (task) => {
    active.set(task.key, task);
    Promise.resolve()
      .then(async () => {
        if (stopped || failed) return;
        onStart(task);
        const result = await run(task);
        if (stopped || failed) return;
        completed.add(task.key);
        onResult(task, result);
      })
      .catch((error) => {
        if (stopped || failed) return;
        failed = true;
        pending = [];
        onError(error);
      })
      .finally(() => {
        active.delete(task.key);
        pump();
        settle();
      });
  };
  const pump = () => {
    while (
      !stopped &&
      !failed &&
      pending.length &&
      active.size < PDF_TRANSLATION_CONCURRENCY
    )
      launch(nextTask());
  };
  signal?.addEventListener("abort", stop, { once: true });
  return {
    replace(tasks) {
      if (stopped || failed) return;
      priorityPage = tasks[0]?.pageNumber;
      const seen = new Set();
      pending = tasks.filter((task) => {
        if (
          seen.has(task.key) ||
          active.has(task.key) ||
          completed.has(task.key)
        )
          return false;
        seen.add(task.key);
        return true;
      });
      pump();
      settle();
    },
    waitForIdle() {
      if (stopped || (!pending.length && !active.size))
        return Promise.resolve();
      return new Promise((resolve) => waiters.add(resolve));
    },
    close: stop,
  };
}
