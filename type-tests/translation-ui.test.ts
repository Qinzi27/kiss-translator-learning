// Compile-only contracts, checked with tsc --noEmit, not executed by Jest.
import {
  createTranslationProgress,
  isTranslationBusy,
  translationProgressLabel,
} from "../src/libs/translationProgress";
import type {
  TranslationPhase,
  TranslationProgressSnapshot,
  TranslationProgressStore,
  TranslationTaskOutcome,
} from "../src/libs/translationProgress";
import {
  getFabAppearance,
  isFabColor,
  normalizeFabColors,
} from "../src/libs/fabAppearance";
import type {
  FabAppearance,
  FabColors,
  FabColorSettings,
} from "../src/libs/fabAppearance";

const controller = createTranslationProgress();
const store: TranslationProgressStore = controller.readonly;
const snapshot: TranslationProgressSnapshot = store.getSnapshot();
const phase: TranslationPhase = snapshot.phase;
const busy: boolean = isTranslationBusy(snapshot);
const label: string = translationProgressLabel(snapshot);
const unsubscribe: () => void = store.subscribe(() => undefined);
unsubscribe();

controller.start();
controller.start(false);
controller.stop();
controller.error();
const finish = controller.request();
const cancelled: TranslationTaskOutcome = "cancelled";
finish();
finish("success");
finish("error");
finish(cancelled);
controller.task()();

// @ts-expect-error Read-only consumers cannot start a translation.
store.start();
// @ts-expect-error Snapshots are immutable.
snapshot.active = 10;
// @ts-expect-error The read-only store methods cannot be replaced.
store.getSnapshot = () => snapshot;
// @ts-expect-error Phases must come from the documented state machine.
const invalidPhase: TranslationPhase = "loading";
// @ts-expect-error Completion outcomes distinguish cancellation from failure.
finish("failed");
// @ts-expect-error A listener is a function, never a page-controlled object.
store.subscribe({});
const invalidSnapshot: TranslationProgressSnapshot = {
  ...snapshot,
  // @ts-expect-error Counts must be numeric.
  active: "1",
};

// Saved/imported settings are unknown until each color has been validated.
const imported: unknown = { idleColor: "#aBcD12", busyColor: false };
const settings: FabColorSettings = { idleColor: imported, doneColor: null };
const colors: FabColors = normalizeFabColors(imported);
normalizeFabColors(settings);
normalizeFabColors(null);
normalizeFabColors(123);
normalizeFabColors();
const appearance: FabAppearance = getFabAppearance(imported, phase);
getFabAppearance(imported, "future-phase");
if (isFabColor(imported)) {
  const normalized: string = imported.toUpperCase();
  void normalized;
}
const foreground: "#000000" | "#FFFFFF" = appearance.color;
// @ts-expect-error Normalized colors cannot contain unvalidated non-strings.
colors.busyColor = false;
// @ts-expect-error Appearance foreground is one of the two contrast choices.
const invalidForeground: FabAppearance["color"] = "#FF0000";

void [
  busy,
  label,
  invalidPhase,
  invalidSnapshot,
  foreground,
  invalidForeground,
];
