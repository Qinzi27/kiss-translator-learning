// Compile-time opt-in only. No text, URL, settings, provider data or networking.
// Measurements begin inside common.run(), after its static imports evaluated.
const MAX_RUNS = 4;
const MAX_STEPS = 32;
const STEP_NAMES = new Set([
  "migration",
  "settings",
  "iframe-ready",
  "rules",
  "words",
  "fab-settings",
  "manager",
]);
const OUTCOMES = new Set(["ready", "skipped", "error"]);
const retained = [];
let sequence = 0;

export function beginStartupProfile() {
  if (process.env.REACT_APP_STARTUP_PROFILE !== "true") return undefined;
  let clock;
  try {
    clock = globalThis.performance;
    if (
      !["now", "mark", "measure", "clearMarks", "clearMeasures"].every(
        (name) => typeof clock?.[name] === "function"
      )
    )
      return undefined;
  } catch {
    return undefined;
  }
  const prefix = `kiss-startup:${++sequence}`;
  let start;
  try {
    start = clock.now();
    clock.mark(`${prefix}:start`);
  } catch {
    return undefined;
  }
  const record = { clock, prefix, names: [], disposed: false };
  retained.push(record);
  while (retained.length > MAX_RUNS) {
    const old = retained.shift();
    old.disposed = true;
    try {
      old.clock.clearMarks(`${old.prefix}:start`);
      old.names.forEach((name) => old.clock.clearMeasures(name));
    } catch {
      /* Diagnostics must never affect translation. */
    }
  }
  let finished = false;
  let committed = false;
  let count = 0;
  const pending = new Set();
  const measure = (label, since) => {
    if (record.disposed) return;
    const name = `${prefix}:${label}`;
    try {
      const end = clock.now();
      clock.measure(name, { start: since, end });
      record.names.push(name);
      // Local diagnostic console only; this branch is absent when not opted in.
      console.info(
        "[KISS startup profile]",
        JSON.stringify({ name, duration: end - since })
      );
    } catch {
      /* Missing/overridden timing APIs are non-fatal. */
    }
  };
  return Object.freeze({
    step(label) {
      if (
        record.disposed ||
        finished ||
        !STEP_NAMES.has(label) ||
        count >= MAX_STEPS
      )
        return () => {};
      let since;
      try {
        since = clock.now();
      } catch {
        return () => {};
      }
      const index = ++count;
      const end = (incomplete = false) => {
        if (!pending.delete(end)) return;
        measure(`${label}:${index}${incomplete ? ":incomplete" : ""}`, since);
      };
      pending.add(end);
      return () => end();
    },
    finish(outcome = "skipped") {
      if (finished) return;
      finished = true;
      pending.forEach((end) => end(true));
      measure(`total:${OUTCOMES.has(outcome) ? outcome : "skipped"}`, start);
    },
    fabCommitted() {
      if (committed) return;
      committed = true;
      // React layout commit, NOT the browser's first paint or interactivity.
      measure("fab-commit", start);
    },
  });
}
