import {
  DEFAULT_INPUT_RULE,
  DEFAULT_MOUSE_HOVER_SETTING,
  DEFAULT_SETTING,
  DEFAULT_SUBTITLE_SETTING,
  DEFAULT_TRANBOX_SETTING,
} from "./setting";
import { DEFAULT_API_LIST, OPT_TRANS_MICROSOFT } from "./api";
import { GLOBAL_KEY } from "./rules";
import { UI_LANGS, I18N } from "./i18n";

describe("translation box defaults", () => {
  test("uses a supported Simplified Chinese UI with local rules and short-text line breaks", () => {
    expect(DEFAULT_SETTING.uiLang).toBe("zh");
    expect(UI_LANGS.some(([key]) => key === DEFAULT_SETTING.uiLang)).toBe(true);
    expect(I18N.translate[DEFAULT_SETTING.uiLang]).toBeTruthy();
    expect(DEFAULT_SETTING.injectRules).toBe(false);
    expect(DEFAULT_SETTING.networkPolicy).toBe("normal");
    expect(DEFAULT_SETTING.newlineLength).toBeLessThan(
      DEFAULT_SETTING.minLength
    );
  });

  test("translates language variants by default", () => {
    expect(DEFAULT_SETTING.translateVariants).toBe(true);
  });

  test("does not convert LaTeX in translations by default", () => {
    expect(DEFAULT_SETTING.parseLatex).toBe(false);
  });

  test("does not read the clipboard automatically by default", () => {
    expect(DEFAULT_SETTING.autoTranslateClipboard).toBe(false);
  });

  test("uses Microsoft for every default translation entry point", () => {
    expect(DEFAULT_INPUT_RULE.apiSlug).toBe(OPT_TRANS_MICROSOFT);
    expect(DEFAULT_TRANBOX_SETTING.apiSlugs).toEqual([OPT_TRANS_MICROSOFT]);
    expect(DEFAULT_SUBTITLE_SETTING.apiSlug).toBe(OPT_TRANS_MICROSOFT);
  });

  test("does not ignore any language by default", () => {
    expect(DEFAULT_TRANBOX_SETTING.skipLangs).toEqual([]);
  });

  test("does not remember the subtitle position by default", () => {
    expect(DEFAULT_SUBTITLE_SETTING.rememberPosition).toBe(false);
    expect(DEFAULT_SUBTITLE_SETTING.positionRatio).toBe(0.05);
  });

  test("follows the current page rule for hover bubbles by default", () => {
    expect(DEFAULT_MOUSE_HOVER_SETTING.apiSlug).toBe(GLOBAL_KEY);
  });

  test("includes every current API without legacy deletion markers", () => {
    expect(DEFAULT_SETTING.transApis).toBe(DEFAULT_API_LIST);
    expect(DEFAULT_SETTING).not.toHaveProperty("deletedTransApiSlugs");
  });
});
