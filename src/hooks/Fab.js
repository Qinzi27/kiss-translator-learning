import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_FAB, STOKEY_FAB } from "../config";
import { getFab, putFab } from "../libs/storage";
import { browser } from "../libs/browser";
import { isExt } from "../libs/client";
import {
  FAB_APPEARANCE_DEFAULTS,
  isFabColor,
  normalizeFabColors,
} from "../libs/fabAppearance";

const withDefaults = (value) => ({
  ...DEFAULT_FAB,
  ...(value && typeof value === "object" && !Array.isArray(value) ? value : {}),
  ...normalizeFabColors(value),
});

/** Save only the edited FAB fields so an open Options tab cannot restore stale coordinates. */
export function useFab() {
  const [fab, setFab] = useState(DEFAULT_FAB);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const mounted = useRef(false);
  const refreshId = useRef(0);
  const pendingSaves = useRef(0);
  const queue = useRef(Promise.resolve());

  const reload = useCallback(async () => {
    const id = ++refreshId.current;
    const value = await getFab();
    if (mounted.current && id === refreshId.current)
      setFab(withDefaults(value));
  }, []);

  useEffect(() => {
    mounted.current = true;
    const refresh = () => {
      reload()
        .catch(() => {
          if (mounted.current) setSaveError("无法读取按钮设置，请刷新后重试。");
        })
        .finally(() => {
          if (mounted.current) setIsLoading(false);
        });
    };
    const storageChanged = (changes, area) => {
      if (
        area === "local" &&
        Object.prototype.hasOwnProperty.call(changes, STOKEY_FAB)
      )
        refresh();
    };
    const webStorageChanged = (event) => {
      if (event.key === STOKEY_FAB || event.key === null) refresh();
    };
    refresh();
    if (isExt) browser?.storage?.onChanged?.addListener(storageChanged);
    else window.addEventListener("storage", webStorageChanged);
    window.addEventListener("focus", refresh);
    return () => {
      mounted.current = false;
      if (isExt) browser?.storage?.onChanged?.removeListener(storageChanged);
      else window.removeEventListener("storage", webStorageChanged);
      window.removeEventListener("focus", refresh);
    };
  }, [reload]);

  const updateFab = useCallback(
    (partialOrFn) => {
      pendingSaves.current += 1;
      setIsSaving(true);
      setSaveError("");
      const task = queue.current
        .then(async () => {
          const partial =
            typeof partialOrFn === "function"
              ? partialOrFn(withDefaults(await getFab()))
              : partialOrFn;
          if (!partial || typeof partial !== "object" || Array.isArray(partial))
            return false;
          const safePartial = { ...partial };
          for (const key of Object.keys(FAB_APPEARANCE_DEFAULTS)) {
            if (!Object.prototype.hasOwnProperty.call(safePartial, key))
              continue;
            if (isFabColor(safePartial[key]))
              safePartial[key] = safePartial[key].toUpperCase();
            else delete safePartial[key];
          }
          if (!Object.keys(safePartial).length) return false;
          // putFab reads the newest storage value before merging only this patch.
          await putFab(safePartial);
          await reload();
          return true;
        })
        .catch(() => {
          if (mounted.current) setSaveError("颜色或按钮设置未保存，请重试。");
          return false;
        })
        .finally(() => {
          pendingSaves.current -= 1;
          if (mounted.current && pendingSaves.current === 0) setIsSaving(false);
        });
      queue.current = task;
      return task;
    },
    [reload]
  );

  return { fab, updateFab, isLoading, isSaving, saveError };
}
