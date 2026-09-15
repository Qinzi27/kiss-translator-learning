// Synthetic tasks and fake timers only; no service is contacted.
jest.mock("../config", () => ({
  DEFAULT_FETCH_INTERVAL: 0,
  DEFAULT_FETCH_LIMIT: 1,
}));
jest.mock("./log", () => ({ kissLog: jest.fn() }));

let pool;
let clearFetchPool;
beforeEach(() => {
  jest.useFakeTimers();
  jest.resetModules();
  const module = require("./pool");
  pool = module.getFetchPool(0, 1);
  clearFetchPool = module.clearFetchPool;
});
afterEach(() => {
  clearFetchPool();
  jest.clearAllTimers();
  jest.useRealTimers();
});

const observe = (promise) =>
  promise.then(
    (value) => ({ value }),
    (error) => ({ error })
  );
async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}
async function advance(ms) {
  jest.advanceTimersByTime(ms);
  await flush();
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test("clearing a queued task rejects it without calling the service", async () => {
  const service = jest.fn();
  const result = observe(pool.push(service, { text: "synthetic" }));
  clearFetchPool();
  expect((await result).error).toMatchObject({ name: "AbortError" });
  await advance(5000);
  expect(service).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

test("failure then backoff then clear never resends the old service and a new task runs", async () => {
  const oldService = jest
    .fn()
    .mockRejectedValue(new Error("synthetic service failure"));
  const oldResult = observe(pool.push(oldService));
  await advance(0);
  expect(oldService).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(1);

  clearFetchPool();
  expect((await oldResult).error).toMatchObject({ name: "AbortError" });
  expect(jest.getTimerCount()).toBe(0);
  const nextService = jest.fn().mockResolvedValue("new service result");
  const nextResult = observe(pool.push(nextService));
  await advance(5000);
  expect(await nextResult).toEqual({ value: "new service result" });
  expect(oldService).toHaveBeenCalledTimes(1);
  expect(nextService).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test("clearing a running task rejects immediately; its later failure cannot retry or block the next generation", async () => {
  const pending = deferred();
  const oldService = jest.fn(() => pending.promise);
  const oldResult = observe(pool.push(oldService));
  await advance(0);
  expect(oldService).toHaveBeenCalledTimes(1);
  clearFetchPool();
  expect((await oldResult).error).toMatchObject({ name: "AbortError" });

  const nextService = jest.fn().mockResolvedValue("new result");
  const nextResult = observe(pool.push(nextService));
  await advance(0);
  // The old network operation still exists, so it retains its concurrency slot.
  expect(nextService).not.toHaveBeenCalled();
  pending.reject(new Error("late old failure"));
  await flush();
  await advance(5000);
  expect(await nextResult).toEqual({ value: "new result" });
  expect(oldService).toHaveBeenCalledTimes(1);
  expect(nextService).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test("late success from a cleared running task is not delivered and repeated clear remains safe", async () => {
  const pending = deferred();
  const result = observe(pool.push(() => pending.promise));
  await advance(0);
  clearFetchPool();
  clearFetchPool();
  pending.resolve("stale text");
  await flush();
  expect((await result).error).toMatchObject({ name: "AbortError" });
  const next = observe(pool.push(() => "fresh text"));
  await advance(0);
  expect(await next).toEqual({ value: "fresh text" });
});

test("clear cancels a retry already requeued behind another running task", async () => {
  const retryService = jest.fn().mockRejectedValue(new Error("retry later"));
  const retryResult = observe(pool.push(retryService));
  await advance(0);
  const pending = deferred();
  const runningResult = observe(pool.push(() => pending.promise));
  await advance(0);
  await advance(1001); // Retry leaves its timer but cannot obtain the sole slot.
  clearFetchPool();
  expect((await retryResult).error.name).toBe("AbortError");
  expect((await runningResult).error.name).toBe("AbortError");
  pending.resolve("late");
  await flush();
  await advance(5000);
  expect(retryService).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test("normal failures still retry twice and then deliver a successful result", async () => {
  const service = jest
    .fn()
    .mockRejectedValueOnce(new Error("first"))
    .mockRejectedValueOnce(new Error("second"))
    .mockResolvedValue("translated");
  const result = observe(pool.push(service, { text: "synthetic" }));
  await advance(0);
  await advance(1001);
  await advance(1001);
  expect(await result).toEqual({ value: "translated" });
  expect(service).toHaveBeenCalledTimes(3);
  expect(service).toHaveBeenLastCalledWith({ text: "synthetic" });
  expect(jest.getTimerCount()).toBe(0);
});

test("exhausting retries rejects once and releases the slot for another task", async () => {
  const failure = new Error("persistent synthetic failure");
  const service = jest.fn().mockRejectedValue(failure);
  const result = observe(pool.push(service));
  await advance(0);
  await advance(1001);
  await advance(1001);
  expect((await result).error).toBe(failure);
  expect(service).toHaveBeenCalledTimes(3);
  const next = observe(pool.push(() => "next"));
  await advance(0);
  expect(await next).toEqual({ value: "next" });
});

test("explicit transport aborts are final and never retried", async () => {
  const abort = Object.assign(new Error("cancelled by caller"), {
    name: "AbortError",
  });
  const service = jest.fn().mockRejectedValue(abort);
  const result = observe(pool.push(service));
  await advance(0);
  expect((await result).error).toBe(abort);
  await advance(5000);
  expect(service).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test("clear during a service call cannot schedule a retry from its synchronous exception", async () => {
  const service = jest.fn(() => {
    clearFetchPool();
    throw new Error("late synchronous failure");
  });
  const result = observe(pool.push(service));
  await advance(5000);
  expect((await result).error).toMatchObject({ name: "AbortError" });
  expect(service).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});
