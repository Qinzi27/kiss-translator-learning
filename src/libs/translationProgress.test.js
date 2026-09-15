import {
  createTranslationProgress,
  isTranslationBusy,
  translationProgressLabel,
} from "./translationProgress";

afterEach(() => jest.useRealTimers());

test("enabling without a request finishes bounded preparation and does not pretend to be loading", () => {
  jest.useFakeTimers();
  const progress = createTranslationProgress();
  const read = progress.readonly.getSnapshot;
  expect(read().phase).toBe("idle");
  progress.start();
  expect(read()).toMatchObject({ phase: "preparing", active: 0 });
  jest.runOnlyPendingTimers();
  expect(read()).toMatchObject({ phase: "done", active: 0, completed: 0 });
  expect(isTranslationBusy(read())).toBe(false);
  expect(translationProgressLabel(read())).toContain("没有待处理");
  progress.stop();
});

test("old completion cannot affect a stopped or newer run, and request failures are distinct", () => {
  const progress = createTranslationProgress();
  const read = progress.readonly.getSnapshot;
  progress.start();
  const oldTask = progress.task();
  const oldRequest = progress.request();
  progress.stop();
  oldTask();
  oldRequest("error");
  expect(read().phase).toBe("stopped");
  progress.start();
  const newTask = progress.task();
  const newRequest = progress.request();
  oldTask();
  oldRequest();
  expect(read()).toMatchObject({
    phase: "translating",
    active: 1,
    completed: 0,
  });
  newRequest("error");
  newTask();
  expect(read().phase).toBe("error");
  const retry = progress.request();
  expect(read().phase).toBe("translating");
  retry();
  expect(read()).toMatchObject({ phase: "done", completed: 1 });
  progress.stop();
});

test("the readonly stable snapshot has no text/config and unsubscribe releases listeners", () => {
  const progress = createTranslationProgress();
  const listener = jest.fn();
  const unsubscribe = progress.readonly.subscribe(listener);
  const old = progress.readonly.getSnapshot();
  expect(progress.readonly.getSnapshot()).toBe(old);
  progress.start();
  expect(Object.keys(progress.readonly.getSnapshot()).sort()).toEqual([
    "active",
    "completed",
    "enabled",
    "phase",
    "queued",
  ]);
  expect(Object.isFrozen(progress.readonly.getSnapshot())).toBe(true);
  unsubscribe();
  listener.mockClear();
  progress.stop();
  expect(listener).not.toHaveBeenCalled();
});
