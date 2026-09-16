import { beginStartupProfile } from "./startupProfile";

const originalPerformance = Object.getOwnPropertyDescriptor(
  globalThis,
  "performance"
);
const originalFlag = process.env.REACT_APP_STARTUP_PROFILE;
let clock;
let entries;
let now;

beforeEach(() => {
  process.env.REACT_APP_STARTUP_PROFILE = "true";
  jest.spyOn(console, "info").mockImplementation(() => {});
  now = 10;
  entries = [];
  clock = {
    now: jest.fn(() => now),
    mark: jest.fn((name) => entries.push({ name, entryType: "mark" })),
    measure: jest.fn((name, { start, end }) =>
      entries.push({ name, entryType: "measure", duration: end - start })
    ),
    clearMarks: jest.fn((name) => {
      entries = entries.filter(
        (entry) => entry.name !== name || entry.entryType !== "mark"
      );
    }),
    clearMeasures: jest.fn((name) => {
      entries = entries.filter(
        (entry) => entry.name !== name || entry.entryType !== "measure"
      );
    }),
  };
  Object.defineProperty(globalThis, "performance", {
    configurable: true,
    value: clock,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  Object.defineProperty(globalThis, "performance", originalPerformance);
  if (originalFlag === undefined) delete process.env.REACT_APP_STARTUP_PROFILE;
  else process.env.REACT_APP_STARTUP_PROFILE = originalFlag;
});

test.each([undefined, "false", "1"])(
  "profiling stays disabled for flag %s",
  (flag) => {
    if (flag === undefined) delete process.env.REACT_APP_STARTUP_PROFILE;
    else process.env.REACT_APP_STARTUP_PROFILE = flag;
    expect(beginStartupProfile()).toBeUndefined();
    expect(clock.now).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();
    expect(entries).toEqual([]);
  }
);

test("records stage durations and the first layout commit, without page data", () => {
  const run = beginStartupProfile();
  const settingsDone = run.step("settings");
  now = 17;
  settingsDone();
  settingsDone();
  now = 20;
  run.finish("ready");
  now = 31;
  run.fabCommitted();
  run.fabCommitted();
  run.finish("error");
  expect(entries.filter((e) => e.entryType === "measure")).toEqual([
    {
      name: expect.stringMatching(/^kiss-startup:\d+:settings:1$/),
      entryType: "measure",
      duration: 7,
    },
    {
      name: expect.stringMatching(/^kiss-startup:\d+:total:ready$/),
      entryType: "measure",
      duration: 10,
    },
    {
      name: expect.stringMatching(/^kiss-startup:\d+:fab-commit$/),
      entryType: "measure",
      duration: 21,
    },
  ]);
});

test("overlapping runs keep their own commit association and interrupted step", () => {
  const first = beginStartupProfile();
  const firstName = entries.at(-1).name.replace(":start", "");
  const late = first.step("rules");
  now = 20;
  const second = beginStartupProfile();
  now = 22;
  second.fabCommitted();
  second.finish("ready");
  now = 30;
  first.finish("error");
  late();
  first.fabCommitted();
  expect(
    entries.find((e) => e.name === `${firstName}:fab-commit`).duration
  ).toBe(20);
  expect(
    entries.filter((e) => e.name.startsWith(`${firstName}:rules`))
  ).toEqual([
    {
      name: `${firstName}:rules:1:incomplete`,
      entryType: "measure",
      duration: 20,
    },
  ]);
});

test("keeps only four bounded runs, does not clear unrelated measurements, and ignores evicted callbacks", () => {
  entries.push({
    name: "unrelated-app-metric",
    entryType: "measure",
    duration: 1,
  });
  const first = beginStartupProfile();
  const oldName = entries.at(-1).name.replace(":start", "");
  const late = first.step("rules");
  for (let run = 0; run < 5; run++) {
    const profile = beginStartupProfile();
    for (let step = 0; step < 100; step++) profile.step("settings")();
    profile.step("https://private.invalid/article")();
    profile.finish("private-outcome");
    profile.fabCommitted();
  }
  late();
  first.finish("ready");
  first.fabCommitted();
  expect(entries.some((e) => e.name.startsWith(oldName + ":"))).toBe(false);
  expect(entries.filter((e) => e.name.startsWith("kiss-startup:")).length).toBe(
    4 * 35
  );
  expect(entries[0].name).toBe("unrelated-app-metric");
  expect(JSON.stringify(entries)).not.toContain("private");
});

test("unavailable and throwing performance capabilities are harmless", () => {
  Object.defineProperty(globalThis, "performance", {
    configurable: true,
    get() {
      throw new Error("blocked");
    },
  });
  expect(beginStartupProfile()).toBeUndefined();
  Object.defineProperty(globalThis, "performance", {
    configurable: true,
    value: {
      get now() {
        throw new Error("blocked");
      },
    },
  });
  expect(beginStartupProfile()).toBeUndefined();
  Object.defineProperty(globalThis, "performance", {
    configurable: true,
    value: { ...clock, measure: undefined },
  });
  expect(beginStartupProfile()).toBeUndefined();
  Object.defineProperty(globalThis, "performance", {
    configurable: true,
    value: clock,
  });
  const run = beginStartupProfile();
  clock.measure.mockImplementation(() => {
    throw new Error("unavailable");
  });
  expect(() => {
    run.step("settings")();
    run.finish("ready");
    run.fabCommitted();
  }).not.toThrow();
});
