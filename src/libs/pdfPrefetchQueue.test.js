import {
  createPdfPrefetchQueue,
  getPdfTranslationTasks,
} from "./pdfPrefetchQueue";

const page = (number, count = 1) => ({
  number,
  paragraphs: Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    text: `${number}:${i}`,
  })),
});
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
function harness() {
  const requests = [];
  const onResult = jest.fn();
  const onError = jest.fn();
  const controller = new AbortController();
  const queue = createPdfPrefetchQueue({
    signal: controller.signal,
    onResult,
    onError,
    run: jest.fn(
      (task) =>
        new Promise((resolve, reject) =>
          requests.push({ task, resolve, reject })
        )
    ),
  });
  return { queue, requests, onResult, onError, controller };
}

test("current page leads and only two following pages are prefetched", () => {
  const tasks = getPdfTranslationTasks(
    [page(1), page(2), page(3), page(4), page(5)],
    2
  );
  expect(tasks.map((task) => task.pageNumber)).toEqual([2, 3, 4]);
});

test("full-document runs still put the current page first", () => {
  expect(
    getPdfTranslationTasks([page(1), page(2), page(3)], 2, {
      allPages: true,
    }).map((task) => task.pageNumber)
  ).toEqual([2, 1, 3]);
});

test("one of two slots keeps translating the current page while the other prefetches future pages", async () => {
  const h = harness();
  h.queue.replace(getPdfTranslationTasks([page(1, 3), page(2), page(3)], 1));
  await flush();
  expect(h.requests.map((r) => r.task.key)).toEqual(["1-p0", "2-p0"]);
  h.requests[0].resolve("translated");
  await flush();
  expect(h.requests.map((r) => r.task.key)).toEqual(["1-p0", "2-p0", "1-p1"]);
  h.requests[2].resolve("current continues despite slow future page");
  await flush();
  expect(h.requests.map((r) => r.task.key)).toEqual([
    "1-p0",
    "2-p0",
    "1-p1",
    "1-p2",
  ]);
  h.controller.abort();
});

test("turning a page reprioritizes pending work and reuses its in-flight prefetch", async () => {
  const h = harness();
  const pages = [page(1), page(2), page(3), page(4), page(5)];
  h.queue.replace(getPdfTranslationTasks(pages, 1));
  await flush();
  h.queue.replace(getPdfTranslationTasks(pages, 2));
  h.requests[0].resolve("old page");
  await flush();
  expect(h.requests.map((r) => r.task.key)).toEqual(["1-p0", "2-p0", "3-p0"]);
  h.requests[1].resolve("prefetched current page");
  await flush();
  expect(h.requests.map((r) => r.task.key)).toEqual([
    "1-p0",
    "2-p0",
    "3-p0",
    "4-p0",
  ]);
  h.controller.abort();
});

test("stop settles immediately, discards queued tasks, and ignores late responses", async () => {
  const h = harness();
  h.queue.replace(getPdfTranslationTasks([page(1, 3), page(2)], 1));
  await flush();
  const idle = h.queue.waitForIdle();
  h.controller.abort();
  await idle;
  h.requests.forEach((r) => r.resolve("late"));
  await flush();
  expect(h.requests).toHaveLength(2);
  expect(h.onResult).not.toHaveBeenCalled();
});

test("an error prevents further submissions and late concurrent results", async () => {
  const h = harness();
  h.queue.replace(getPdfTranslationTasks([page(1, 3), page(2)], 1));
  await flush();
  h.requests[0].reject(new Error("quota exhausted"));
  await flush();
  h.requests[1].resolve("late");
  await h.queue.waitForIdle();
  expect(h.requests).toHaveLength(2);
  expect(h.onError).toHaveBeenCalledTimes(1);
  expect(h.onResult).not.toHaveBeenCalled();
  h.queue.close();
});

test("a pending current page uses both slots when there is no future page", async () => {
  const h = harness();
  h.queue.replace(getPdfTranslationTasks([page(1, 3)], 1));
  await flush();
  expect(h.requests.map((r) => r.task.key)).toEqual(["1-p0", "1-p1"]);
  h.controller.abort();
});

test("jumping ahead gives the next available slot to the new current page and drops queued old pages", async () => {
  const h = harness();
  const pages = [page(1, 3), page(2, 3), page(3), page(4), page(5)];
  h.queue.replace(getPdfTranslationTasks(pages, 1));
  await flush();
  h.queue.replace(getPdfTranslationTasks(pages, 4));
  h.requests[0].resolve("old current");
  await flush();
  expect(h.requests.map((r) => r.task.key)).toEqual(["1-p0", "2-p0", "4-p0"]);
  h.requests[1].resolve("old prefetch");
  await flush();
  expect(h.requests.map((r) => r.task.key)).toEqual([
    "1-p0",
    "2-p0",
    "4-p0",
    "5-p0",
  ]);
  h.controller.abort();
});
