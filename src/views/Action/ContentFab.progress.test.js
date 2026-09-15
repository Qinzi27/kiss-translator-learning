/* eslint-disable testing-library/no-container, testing-library/no-unnecessary-act */
// Real Translator + ContentFab lifecycle; deterministic providers/viewport.
// Synthetic jsdom clicks exercise state wiring, not trusted browser-input guards.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ContentFabContent } from "./ContentFab";
import { Translator } from "../../libs/translator";
import { DEFAULT_API_SETTING } from "../../config";
import { GLOBLA_RULE } from "../../config/rules";
import { apiTranslate } from "../../apis";
import { tryDetectLang } from "../../libs/detect";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("../../apis", () => ({
  apiTranslate: jest.fn(),
  apiMicrosoftDict: jest.fn(),
  apiYoudaoDict: jest.fn(),
}));
jest.mock("../../hooks/Setting", () => ({
  SettingProvider: ({ children }) => children,
}));
jest.mock("../../hooks/M3Theme", () => ({
  __esModule: true,
  default: ({ children }) => children,
}));
jest.mock("../../libs/detect", () => ({ tryDetectLang: jest.fn() }));
jest.mock("../../libs/msg", () => ({ sendBgMsg: jest.fn() }));
jest.mock("../../libs/log", () => ({
  ...jest.requireActual("../../libs/log"),
  kissLog: jest.fn(),
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));
jest.mock("../../libs/webAiClient", () => ({
  cancelWebAiClientTasks: jest.fn(),
}));
jest.mock("../../hooks/I18n", () => ({ useI18n: () => (key) => key }));
jest.mock("../../hooks/WindowSize", () => ({
  __esModule: true,
  default: () => ({ w: 800, h: 600 }),
}));
jest.mock("../../hooks/useFullscreenDetect", () => ({
  useFullscreenDetect: () => ({ isVideoFullscreen: false }),
}));
jest.mock("../../components/TouchTranslateControl", () => () => null);
jest.mock("./Draggable", () => {
  const React = require("react");
  return (props) =>
    React.createElement("div", null, props.handler, props.children);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function drain() {
  for (let n = 0; n < 12; n++) {
    jest.runOnlyPendingTimers();
    await Promise.resolve();
    await Promise.resolve();
  }
}

let translator, root, container, article;
let oldIO, oldSheet, oldMatchMedia, oldScroll, oldQueue;
beforeEach(() => {
  oldQueue = global.queueMicrotask;
  jest.useFakeTimers();
  global.queueMicrotask = oldQueue;
  apiTranslate
    .mockReset()
    .mockResolvedValue({ trText: "已经完成的译文", isSame: false });
  tryDetectLang.mockReset().mockResolvedValue("en");
  oldIO = global.IntersectionObserver;
  oldSheet = global.CSSStyleSheet;
  oldMatchMedia = window.matchMedia;
  oldScroll = window.scrollBy;
  global.IntersectionObserver = class {
    constructor(callback) {
      this.callback = callback;
    }
    observe(target) {
      this.callback([{ target, isIntersecting: true }]);
    }
    unobserve() {}
    disconnect() {}
  };
  global.CSSStyleSheet = class {
    replaceSync() {}
  };
  window.matchMedia = jest.fn(() => ({ matches: true }));
  window.scrollBy = jest.fn();
  article = document.createElement("main");
  article.id = "fab-progress-article";
  article.innerHTML =
    "<p>This original paragraph must remain while a translation is pending.</p>";
  container = document.createElement("div");
  document.body.append(article, container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => {
    root.unmount();
    translator?.stop();
  });
  article.remove();
  container.remove();
  translator = null;
  jest.clearAllTimers();
  jest.useRealTimers();
  global.queueMicrotask = oldQueue;
  global.IntersectionObserver = oldIO;
  global.CSSStyleSheet = oldSheet;
  window.matchMedia = oldMatchMedia;
  window.scrollBy = oldScroll;
});

function engine(rule = {}) {
  return new Translator({
    rule: {
      ...GLOBLA_RULE,
      rootsSelector: "#fab-progress-article",
      transOpen: "false",
      fromLang: "en",
      apiSlug: "first",
      ...rule,
    },
    setting: {
      preInit: false,
      minLength: 0,
      transInterval: 20,
      rootMargin: 0,
      mouseHoverSetting: {},
      customStyles: [],
      transApis: ["first", "second", "third"].map((apiSlug) => ({
        ...DEFAULT_API_SETTING,
        apiSlug,
      })),
    },
  });
}
function mount(rule = {}, fabClickAction = 1) {
  translator = engine(rule);
  act(() =>
    root.render(
      <ContentFabContent
        fabConfig={{ fabClickAction }}
        translationProgress={translator.translationProgress}
        processActions={() => translator.toggle()}
      />
    )
  );
}
const fab = () => container.querySelector(".kt-content-fab");
const click = async () => {
  await act(async () => {
    fab().click();
  });
};
const advance = async () => {
  await act(async () => {
    await drain();
  });
};
const state = () => fab().getAttribute("data-translation-state");

test("click reacts immediately, stays busy through a slow response, and completes only after DOM rendering", async () => {
  const pending = deferred();
  apiTranslate.mockReturnValueOnce(pending.promise);
  mount();
  expect(state()).toBe("idle");
  await click();
  expect(["preparing", "queued"]).toContain(state());
  expect(fab().getAttribute("aria-busy")).toBe("true");
  expect(fab().style.getPropertyValue("--kt-fab-fill")).toBe("#F9E5A6");
  expect(
    container.querySelector(".kt-content-fab-progress-ring")
  ).not.toBeNull();
  await advance();
  expect(apiTranslate).toHaveBeenCalledTimes(1);
  expect(state()).toBe("translating");
  expect(fab().disabled).toBe(false);
  expect(fab().title).toContain("点击停止翻译");
  await act(async () => {
    pending.resolve({ trText: "服务完成译文", isSame: false });
    await drain();
  });
  expect(state()).toBe("done");
  expect(fab().getAttribute("aria-busy")).toBe("false");
  expect(
    container.querySelector('[data-testid="CheckRoundedIcon"]')
  ).not.toBeNull();
  expect(article.querySelector(".kiss-translator-inner").textContent).toBe(
    "服务完成译文"
  );
  expect(container.querySelector('[role="status"]').textContent).toContain(
    "处理完成"
  );
});

test("slow language detection reports queued work before a provider is invoked", async () => {
  const detect = deferred();
  tryDetectLang.mockReturnValueOnce(detect.promise);
  mount({ fromLang: "auto" });
  await click();
  await advance();
  expect(apiTranslate).not.toHaveBeenCalled();
  expect(state()).toBe("queued");
  await act(async () => {
    detect.resolve("en");
    await drain();
  });
  expect(apiTranslate).toHaveBeenCalledTimes(1);
  expect(state()).toBe("done");
});

test("stopping and restarting rejects a prior slow response without clearing the newer busy state", async () => {
  const old = deferred(),
    next = deferred();
  apiTranslate
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(next.promise);
  mount();
  await click();
  await advance();
  await click();
  expect(state()).toBe("stopped");
  expect(fab().getAttribute("aria-busy")).toBe("false");
  await click();
  await advance();
  expect(state()).toBe("translating");
  await act(async () => {
    old.resolve({ trText: "obsolete" });
    await drain();
  });
  expect(state()).toBe("translating");
  expect(article.textContent).not.toContain("obsolete");
  await act(async () => {
    next.resolve({ trText: "current" });
    await drain();
  });
  expect(state()).toBe("done");
});

test("failures are visible, contain no provider details, and a new successful run clears the error", async () => {
  apiTranslate.mockRejectedValueOnce(
    new Error("Synthetic error with private provider detail")
  );
  mount();
  await click();
  await advance();
  expect(state()).toBe("error");
  expect(
    container.querySelector('[data-testid="ErrorOutlineRoundedIcon"]')
  ).not.toBeNull();
  expect(fab().getAttribute("aria-busy")).toBe("false");
  expect(fab().title).not.toContain("private provider");
  await click();
  expect(state()).toBe("stopped");
  await click();
  await advance();
  expect(state()).toBe("done");
});

test("switching providers retains old text, resets progress, and ignores the replaced provider's delayed refresh", async () => {
  mount();
  await click();
  await advance();
  const second = deferred(),
    third = deferred();
  apiTranslate
    .mockReturnValueOnce(second.promise)
    .mockReturnValueOnce(third.promise);
  await act(async () => {
    translator.updateRule({ apiSlug: "second" });
    await drain();
  });
  expect(state()).toBe("translating");
  expect(article.textContent).toContain("已经完成的译文");
  await act(async () => {
    translator.updateRule({ apiSlug: "third" });
    await drain();
  });
  await act(async () => {
    second.reject(new Error("obsolete failure"));
    await drain();
  });
  expect(state()).toBe("translating");
  await act(async () => {
    third.resolve({ trText: "第三个服务的新译文" });
    await drain();
  });
  expect(state()).toBe("done");
  expect(article.textContent).toContain("第三个服务的新译文");
});

test("a new page engine starts idle and cannot inherit a previous engine's late completion", async () => {
  const pending = deferred();
  apiTranslate.mockReturnValueOnce(pending.promise);
  mount();
  await click();
  await advance();
  act(() => {
    translator.stop();
  });
  article.innerHTML =
    "<p>A new page has not been authorized for translation.</p>";
  mount();
  await act(async () => {
    pending.resolve({ trText: "old page" });
    await drain();
  });
  expect(state()).toBe("idle");
  expect(apiTranslate).toHaveBeenCalledTimes(1);
  expect(article.textContent).not.toContain("old page");
});

test("an enabled empty page stops spinning and menu mode retains its original toggle action", async () => {
  article.innerHTML = "";
  mount({}, 0);
  act(() => translator.enable());
  await advance();
  expect(state()).toBe("done");
  expect(apiTranslate).not.toHaveBeenCalled();
  await click();
  expect(fab().getAttribute("aria-expanded")).toBe("true");
  expect(state()).toBe("done");
  const item = Array.from(container.querySelectorAll('[role="menuitem"]')).find(
    (el) => el.textContent === "popup_translate_page"
  );
  await act(async () => item.click());
  expect(state()).toBe("stopped");
});

test("rescan resets pending counters and a previous request cannot end the new run", async () => {
  const old = deferred(),
    next = deferred();
  apiTranslate
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(next.promise);
  mount();
  await click();
  await advance();
  await act(async () => {
    translator.rescan();
    await drain();
  });
  expect(state()).toBe("translating");
  expect(translator.translationProgress.getSnapshot().active).toBe(1);
  await act(async () => {
    old.reject(new Error("previous scan"));
    await drain();
  });
  expect(state()).toBe("translating");
  await act(async () => {
    next.resolve({ trText: "new scan" });
    await drain();
  });
  expect(state()).toBe("done");
});

test("stopping before DOMContentLoaded prevents a destroyed engine from starting later", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(document, "readyState");
  Object.defineProperty(document, "readyState", {
    configurable: true,
    value: "loading",
  });
  try {
    mount({ transOpen: "true" });
    act(() => translator.stop());
    await act(async () => {
      document.dispatchEvent(new Event("DOMContentLoaded"));
      await drain();
    });
    expect(apiTranslate).not.toHaveBeenCalled();
    expect(state()).toBe("stopped");
  } finally {
    if (descriptor) Object.defineProperty(document, "readyState", descriptor);
    else delete document.readyState;
  }
});

test("a scanning error shows failure instead of eventually claiming ready", async () => {
  mount({ rootsSelector: "[" });
  await click();
  await advance();
  expect(state()).toBe("error");
  expect(apiTranslate).not.toHaveBeenCalled();
  expect(fab().getAttribute("aria-busy")).toBe("false");
  await click();
  expect(state()).toBe("stopped");
});

test("a language-detection failure settles queued state without a stuck spinner", async () => {
  tryDetectLang.mockRejectedValueOnce(new Error("detection failed"));
  mount({ fromLang: "auto" });
  await click();
  await advance();
  expect(state()).toBe("error");
  expect(apiTranslate).not.toHaveBeenCalled();
  expect(fab().getAttribute("aria-busy")).toBe("false");
});
