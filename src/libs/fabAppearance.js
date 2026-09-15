export const FAB_APPEARANCE_DEFAULTS = Object.freeze({
  idleColor: "#146C5F",
  busyColor: "#F9E5A6",
  doneColor: "#254D32",
});

export const isFabColor = (value) =>
  typeof value === "string" &&
  value.length === 7 &&
  /^#[0-9a-fA-F]{6}$/.test(value);

export function normalizeFabColors(fab = {}) {
  return Object.fromEntries(
    Object.entries(FAB_APPEARANCE_DEFAULTS).map(([key, fallback]) => [
      key,
      isFabColor(fab?.[key]) ? fab[key].toUpperCase() : fallback,
    ])
  );
}

export function getFabAppearance(fab = {}, phase = "idle") {
  const colors = normalizeFabColors(fab);
  const backgroundColor = ["preparing", "queued", "translating"].includes(phase)
    ? colors.busyColor
    : phase === "done"
      ? colors.doneColor
      : colors.idleColor;
  const linear = [1, 3, 5].map((offset) => {
    const channel =
      parseInt(backgroundColor.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance =
    linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  // Choose the stronger WCAG contrast of pure black/white; at least 4.5:1.
  const color =
    (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05)
      ? "#000000"
      : "#FFFFFF";
  return { backgroundColor, color };
}
