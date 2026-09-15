import { useEffect, useId, useState } from "react";
import Button from "@mui/material/Button";
import TranslateRoundedIcon from "@mui/icons-material/TranslateRounded";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import {
  FAB_APPEARANCE_DEFAULTS,
  getFabAppearance,
  isFabColor,
  normalizeFabColors,
} from "../../libs/fabAppearance";
import "./FabAppearanceSetting.css";

const STATES = [
  ["idleColor", "空闲", "idle"],
  ["busyColor", "翻译中", "translating"],
  ["doneColor", "完成", "done"],
];

export default function FabAppearanceSetting({
  fab,
  updateFab,
  disabled = false,
  isSaving = false,
  saveError = "",
}) {
  const id = useId();
  const { idleColor, busyColor, doneColor } = normalizeFabColors(fab);
  const [draft, setDraft] = useState({ idleColor, busyColor, doneColor });
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setDraft({ idleColor, busyColor, doneColor });
  }, [idleColor, busyColor, doneColor]);

  const changeColor = (key, value) => {
    if (disabled) return;
    setDraft((previous) => ({ ...previous, [key]: value }));
    setNotice("");
    if (isFabColor(value)) updateFab({ [key]: value.toUpperCase() });
  };

  return (
    <section className="kt-fab-appearance" aria-labelledby={`${id}-title`}>
      <div className="kt-fab-appearance__header">
        <div>
          <h2 id={`${id}-title`}>悬浮翻译按钮颜色</h2>
          <p>
            选择颜色或输入六位色值后自动保存。扩展中已打开页面的按钮会同步更新；
            未更新时可刷新阅读页面。
          </p>
        </div>
        <Button
          variant="text"
          disabled={disabled}
          onClick={() => {
            setDraft({ ...FAB_APPEARANCE_DEFAULTS });
            updateFab({ ...FAB_APPEARANCE_DEFAULTS });
            setNotice("已恢复默认颜色。按钮位置和点击方式保持不变。");
          }}
        >
          恢复默认颜色
        </Button>
      </div>
      <div className="kt-fab-appearance__states">
        {STATES.map(([key, label, phase]) => {
          const invalid = !isFabColor(draft[key]);
          const previewColors = { ...normalizeFabColors(fab) };
          if (!invalid) previewColors[key] = draft[key];
          const errorId = `${id}-${key}-error`;
          return (
            <div className="kt-fab-appearance__state" key={key}>
              <div
                className="kt-fab-appearance__preview"
                style={getFabAppearance(previewColors, phase)}
                role="img"
                aria-label={`${label}按钮预览`}
              >
                {phase === "translating" ? (
                  <span
                    className="kt-fab-appearance__ring"
                    aria-hidden="true"
                  />
                ) : phase === "done" ? (
                  <CheckRoundedIcon aria-hidden="true" />
                ) : (
                  <TranslateRoundedIcon aria-hidden="true" />
                )}
              </div>
              <label
                className="kt-fab-appearance__label"
                htmlFor={`${id}-${key}`}
              >
                {label}
              </label>
              <div className="kt-fab-appearance__inputs">
                <input
                  type="color"
                  aria-label={`${label}颜色选择器`}
                  value={previewColors[key]}
                  disabled={disabled}
                  onChange={(event) => changeColor(key, event.target.value)}
                />
                <input
                  id={`${id}-${key}`}
                  type="text"
                  aria-label={`${label}颜色色值`}
                  aria-invalid={invalid}
                  aria-describedby={invalid ? errorId : undefined}
                  value={draft[key]}
                  maxLength={7}
                  spellCheck={false}
                  autoComplete="off"
                  disabled={disabled}
                  onChange={(event) => changeColor(key, event.target.value)}
                />
              </div>
              {invalid && (
                <span className="kt-fab-appearance__error" id={errorId}>
                  请输入 #RRGGBB 格式，如 #146C5F；当前输入尚未保存。
                </span>
              )}
            </div>
          );
        })}
      </div>
      <p className="kt-fab-appearance__hint">
        图标自动使用高对比的黑色或白色；翻译中显示进度环，完成显示勾号。
      </p>
      <div
        className="kt-fab-appearance__notice"
        role="status"
        aria-live="polite"
      >
        {disabled
          ? "正在读取已保存的按钮设置…"
          : saveError || (isSaving ? "正在保存颜色…" : notice)}
      </div>
    </section>
  );
}
