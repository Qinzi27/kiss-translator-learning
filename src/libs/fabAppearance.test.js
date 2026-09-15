import {
  FAB_APPEARANCE_DEFAULTS,
  getFabAppearance,
  isFabColor,
  normalizeFabColors,
} from "./fabAppearance";

test.each([
  "red",
  "#fff",
  "#12345678",
  "#12345G",
  "#123456\n",
  " #123456",
  "#123456 ",
  "var(--color)",
  "url(https://example.test/)",
  "#123456;position:fixed",
  null,
  123456,
  {},
])("rejects non-six-digit CSS value %p before producing styles", (value) => {
  expect(isFabColor(value)).toBe(false);
  expect(normalizeFabColors({ idleColor: value }).idleColor).toBe(
    FAB_APPEARANCE_DEFAULTS.idleColor
  );
  expect(
    getFabAppearance({ busyColor: value }, "translating").backgroundColor
  ).toBe(FAB_APPEARANCE_DEFAULTS.busyColor);
});

test("normalizes valid mixed-case values without mutating saved data", () => {
  const saved = {
    idleColor: "#aBcD12",
    busyColor: "#ffffff",
    doneColor: "#000000",
    x: 0,
  };
  expect(normalizeFabColors(saved)).toEqual({
    idleColor: "#ABCD12",
    busyColor: "#FFFFFF",
    doneColor: "#000000",
  });
  expect(saved.idleColor).toBe("#aBcD12");
  expect(normalizeFabColors(null)).toEqual(FAB_APPEARANCE_DEFAULTS);
});

test.each(["preparing", "queued", "translating"])(
  "phase %s uses the visibly contrasting busy palette",
  (phase) => {
    expect(getFabAppearance({}, phase)).toEqual({
      backgroundColor: "#F9E5A6",
      color: "#000000",
    });
  }
);

test("completed and stopped/error states retain distinct shape-compatible colors", () => {
  expect(getFabAppearance({}, "done")).toEqual({
    backgroundColor: "#254D32",
    color: "#FFFFFF",
  });
  for (const phase of ["idle", "stopped", "error", "unknown"])
    expect(getFabAppearance({}, phase)).toEqual({
      backgroundColor: "#146C5F",
      color: "#FFFFFF",
    });
});

test.each([
  ["#000000", "#FFFFFF"],
  ["#FFFFFF", "#000000"],
  ["#777777", "#000000"],
  ["#0000FF", "#FFFFFF"],
  ["#FFFF00", "#000000"],
  ["#FF0000", "#000000"],
])(
  "chooses readable foreground for custom background %s",
  (backgroundColor, color) => {
    expect(getFabAppearance({ idleColor: backgroundColor })).toEqual({
      backgroundColor,
      color,
    });
  }
);
