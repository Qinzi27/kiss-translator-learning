// Actual Translator DOM lifecycle with deterministic provider/viewport replies.
// This does not claim real browser animation or provider/network validation.
jest.mock("../apis", () => ({
  apiMicrosoftDict: jest.fn(),
  apiTranslate: jest.fn(),
  apiYoudaoDict: jest.fn(),
}));
jest.mock("./msg", () => ({ sendBgMsg: jest.fn() }));
jest.mock("./detect", () => ({ tryDetectLang: jest.fn() }));
jest.mock("./webAiClient", () => ({ cancelWebAiClientTasks: jest.fn() }));

const { apiTranslate } = require("../apis");
const { tryDetectLang } = require("./detect");
const { cancelWebAiClientTasks } = require("./webAiClient");
const { DEFAULT_API_SETTING } = require("../config");
const { GLOBLA_RULE } = require("../config/rules");
const { Translator } = require("./translator");
const wrapperSelector = ".kiss-translator-wrapper";
const innerSelector = ".kiss-translator-inner";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((finish, fail) => {
    resolve = finish;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function drain() {
  for (let index = 0; index < 8; index += 1) {
    jest.runOnlyPendingTimers();
    await Promise.resolve();
    await Promise.resolve();
  }
}

describe("retaining completed translations while changing services", () => {
  let translator;
  let oldIO;
  let oldSheet;
  let oldScroll;
  let oldMatchMedia;
  let oldQueueMicrotask;
  let observers;

  beforeEach(() => {
    oldQueueMicrotask = global.queueMicrotask;
    jest.useFakeTimers();
    // Keep native microtask ordering with jsdom's MutationObserver. Jest 27's
    // fake queueMicrotask drains inside timers before the native observer,
    // incorrectly exposing the translator's own temporary DOM changes.
    global.queueMicrotask = oldQueueMicrotask;
    jest.clearAllMocks();
    apiTranslate.mockReset();
    apiTranslate.mockResolvedValue({ trText: "原有译文", isSame: false });
    tryDetectLang.mockReset();
    tryDetectLang.mockResolvedValue("en");
    document.documentElement.innerHTML = "<head></head><body></body>";
    document.body.innerHTML =
      '<main id="root"><p id="paragraph">Read an article with an <a id="source-link" href="#details" style="display:inline">original link</a> and preserve the final sentence.</p></main>';
    oldIO = global.IntersectionObserver;
    observers = [];
    global.IntersectionObserver = class {
      constructor(callback, options) {
        this.callback = callback;
        this.options = options;
        observers.push(this);
      }
      observe(target) {
        this.callback([{ target, isIntersecting: true }]);
      }
      unobserve() {}
      disconnect() {}
    };
    oldSheet = global.CSSStyleSheet;
    global.CSSStyleSheet = class {
      replaceSync() {}
    };
    oldScroll = window.scrollBy;
    window.scrollBy = jest.fn();
    oldMatchMedia = window.matchMedia;
    window.matchMedia = jest.fn(() => ({ matches: true }));
  });

  afterEach(() => {
    translator?.stop();
    translator = null;
    jest.clearAllTimers();
    jest.useRealTimers();
    global.queueMicrotask = oldQueueMicrotask;
    global.IntersectionObserver = oldIO;
    global.CSSStyleSheet = oldSheet;
    window.scrollBy = oldScroll;
    window.matchMedia = oldMatchMedia;
  });

  async function start(rule = {}) {
    translator = new Translator({
      rule: {
        ...GLOBLA_RULE,
        transOpen: "true",
        rootsSelector: "#root",
        fromLang: "en",
        apiSlug: "first",
        ...rule,
      },
      setting: {
        preInit: false,
        minLength: 0,
        transInterval: 0,
        rootMargin: 0,
        mouseHoverSetting: {},
        customStyles: [],
        transApis: ["first", "second", "third"].map((apiSlug) => ({
          ...DEFAULT_API_SETTING,
          apiSlug,
          apiName: apiSlug,
          rootMargin: apiSlug === "second" ? 400 : 0,
          transAllnow: apiSlug === "third",
        })),
      },
    });
    await drain();
    expect(document.querySelector(innerSelector).textContent).toBe("原有译文");
    return document.querySelector(wrapperSelector);
  }

  test("preserves the same wrapper and original link while a new provider with a different viewport margin responds", async () => {
    const source = document.getElementById("source-link");
    const originalNodes = [...document.getElementById("paragraph").childNodes];
    const click = jest.fn((event) => event.preventDefault());
    source.addEventListener("click", click);
    const wrapper = await start();
    const inner = wrapper.querySelector(innerSelector);
    const pending = deferred();
    apiTranslate.mockReturnValueOnce(pending.promise);
    translator.updateRule({ apiSlug: "second" });
    await drain();

    expect(document.querySelector(wrapperSelector)).toBe(wrapper);
    expect(inner.textContent).toBe("原有译文");
    expect(wrapper.getAttribute("aria-busy")).toBe("true");
    expect(apiTranslate).toHaveBeenCalledTimes(2);
    expect(observers.at(-1).options.rootMargin).toBe("400px 0px 400px 0px");
    expect(apiTranslate.mock.calls[1][0].apiSetting.apiSlug).toBe("second");

    pending.resolve({ trText: "新的成功译文", isSame: false });
    await drain();
    expect(document.querySelector(wrapperSelector)).toBe(wrapper);
    expect(wrapper.querySelector(innerSelector)).toBe(inner);
    expect(inner.textContent).toBe("新的成功译文");
    expect(wrapper.hasAttribute("aria-busy")).toBe(false);
    expect(document.getElementById("source-link")).toBe(source);
    expect(
      [...document.getElementById("paragraph").childNodes].slice(
        0,
        originalNodes.length
      )
    ).toEqual(originalNodes);
    source.click();
    expect(click).toHaveBeenCalledTimes(1);
    expect(cancelWebAiClientTasks).toHaveBeenCalledTimes(1);
  });

  test("a failed or empty replacement leaves old text and a small error title", async () => {
    const wrapper = await start();
    apiTranslate.mockRejectedValueOnce(new Error("Service unavailable"));
    translator.updateRule({ apiSlug: "second" });
    await drain();
    expect(wrapper.querySelector(innerSelector).textContent).toBe("原有译文");
    expect(wrapper.dataset.kissRefreshState).toBe("error");
    expect(wrapper.title).toContain("保留原译文");
    apiTranslate.mockResolvedValueOnce({ trText: "", isSame: false });
    translator.updateRule({ apiSlug: "third" });
    await drain();
    expect(document.querySelectorAll(wrapperSelector)).toHaveLength(1);
    expect(wrapper.querySelector(innerSelector).textContent).toBe("原有译文");
    expect(wrapper.title).toContain("有效译文");
  });

  test("a later service selection wins even when the older request resolves last", async () => {
    const wrapper = await start();
    const second = deferred();
    const third = deferred();
    apiTranslate
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise);
    translator.updateRule({ apiSlug: "second" });
    await drain();
    const oldSignal = apiTranslate.mock.calls[1][0].signal;
    translator.updateRule({ apiSlug: "third" });
    await drain();
    expect(oldSignal.aborted).toBe(true);
    expect(wrapper.querySelector(innerSelector).textContent).toBe("原有译文");
    third.resolve({ trText: "第三服务译文", isSame: false });
    await drain();
    second.resolve({ trText: "已经过期的第二服务译文", isSame: false });
    await drain();
    expect(apiTranslate).toHaveBeenCalledTimes(3);
    expect(document.querySelectorAll(wrapperSelector)).toHaveLength(1);
    expect(document.querySelector(wrapperSelector)).toBe(wrapper);
    expect(wrapper.querySelector(innerSelector).textContent).toBe(
      "第三服务译文"
    );
  });

  test("closing while a replacement is pending aborts it and never restores the late answer", async () => {
    await start();
    const pending = deferred();
    apiTranslate.mockReturnValueOnce(pending.promise);
    translator.updateRule({ apiSlug: "second" });
    await drain();
    const signal = apiTranslate.mock.calls[1][0].signal;
    translator.disable();
    expect(signal.aborted).toBe(true);
    pending.resolve({ trText: "不可重插的译文", isSame: false });
    await drain();
    expect(document.querySelector(wrapperSelector)).toBeNull();
    expect(document.getElementById("source-link")).not.toBeNull();
    expect(cancelWebAiClientTasks).toHaveBeenCalledTimes(2);
  });

  test("target-language changes retain the old text and apply the requested language", async () => {
    const wrapper = await start();
    const pending = deferred();
    apiTranslate.mockReturnValueOnce(pending.promise);
    translator.updateRule({ toLang: "zh-TW" });
    await drain();
    expect(wrapper.querySelector(innerSelector).textContent).toBe("原有译文");
    expect(apiTranslate.mock.calls[1][0].toLang).toBe("zh-TW");
    pending.resolve({ trText: "新的繁體譯文", isSame: false });
    await drain();
    expect(wrapper.querySelector(innerSelector).textContent).toBe(
      "新的繁體譯文"
    );
    expect(wrapper.querySelector(innerSelector).lang).toBe("zh-TW");
  });

  test("translation-only mode keeps original nodes recoverable after switching", async () => {
    const link = document.getElementById("source-link");
    const wrapper = await start({ transOnly: "true" });
    apiTranslate.mockResolvedValueOnce({
      trText: "替换后的译文",
      isSame: false,
    });
    translator.updateRule({ apiSlug: "second" });
    await drain();
    expect(wrapper.querySelector(innerSelector).textContent).toBe(
      "替换后的译文"
    );
    expect(document.getElementById("source-link")).toBeNull();
    translator.disable();
    expect(document.getElementById("source-link")).toBe(link);
    expect(document.querySelector(wrapperSelector)).toBeNull();
  });

  test("a host-page source update prevents a stale translation from being committed", async () => {
    const wrapper = await start();
    const pending = deferred();
    apiTranslate.mockReturnValueOnce(pending.promise);
    translator.updateRule({ apiSlug: "second" });
    await drain();
    document.getElementById("source-link").firstChild.textContent =
      "updated original link";
    pending.resolve({ trText: "过期来源对应的译文", isSame: false });
    await drain();
    expect(wrapper.querySelector(innerSelector).textContent).not.toBe(
      "过期来源对应的译文"
    );
    expect(document.getElementById("source-link").textContent).toBe(
      "updated original link"
    );
    translator.disable();
    expect(document.getElementById("source-link").textContent).toBe(
      "updated original link"
    );
  });

  test("motion waits for a successful reply, wipes old text, then fades new text in", async () => {
    const wrapper = await start();
    const inner = wrapper.querySelector(innerSelector);
    window.matchMedia.mockReturnValue({ matches: false });
    const outgoing = deferred();
    const incoming = deferred();
    const cancelOut = jest.fn();
    inner.animate = jest
      .fn()
      .mockReturnValueOnce({ finished: outgoing.promise, cancel: cancelOut })
      .mockReturnValueOnce({ finished: incoming.promise, cancel: jest.fn() });
    const pending = deferred();
    apiTranslate.mockReturnValueOnce(pending.promise);
    translator.updateRule({ apiSlug: "second" });
    await drain();
    expect(inner.animate).not.toHaveBeenCalled();
    pending.resolve({ trText: "动画后的新译文", isSame: false });
    await drain();
    expect(inner.animate).toHaveBeenCalledTimes(1);
    expect(inner.textContent).toBe("原有译文");
    expect(inner.animate.mock.calls[0][0][1].clipPath).toBe(
      "inset(0 0 0 100%)"
    );
    outgoing.resolve();
    await drain();
    expect(inner.textContent).toBe("动画后的新译文");
    expect(inner.animate).toHaveBeenCalledTimes(2);
    incoming.resolve();
    await drain();
    expect(cancelOut).toHaveBeenCalledTimes(1);
  });

  test("reduced motion replaces text without requesting an animation", async () => {
    const wrapper = await start();
    const inner = wrapper.querySelector(innerSelector);
    inner.animate = jest.fn();
    apiTranslate.mockResolvedValueOnce({
      trText: "无动画的译文",
      isSame: false,
    });
    translator.updateRule({ apiSlug: "second" });
    await drain();
    expect(inner.textContent).toBe("无动画的译文");
    expect(inner.animate).not.toHaveBeenCalled();
    expect(window.matchMedia).toHaveBeenCalledWith(
      "(prefers-reduced-motion: reduce)"
    );
  });

  test("closing during the outgoing animation cancels it without committing new text", async () => {
    const wrapper = await start();
    const inner = wrapper.querySelector(innerSelector);
    window.matchMedia.mockReturnValue({ matches: false });
    const outgoing = deferred();
    const cancel = jest.fn();
    inner.animate = jest
      .fn()
      .mockReturnValue({ finished: outgoing.promise, cancel });
    apiTranslate.mockResolvedValueOnce({
      trText: "关闭后不可显示",
      isSame: false,
    });
    translator.updateRule({ apiSlug: "second" });
    await drain();
    expect(inner.animate).toHaveBeenCalledTimes(1);
    translator.disable();
    expect(cancel).toHaveBeenCalledTimes(1);
    outgoing.resolve();
    await drain();
    expect(document.querySelector(wrapperSelector)).toBeNull();
    expect(inner.textContent).toBe("原有译文");
    expect(document.getElementById("source-link")).not.toBeNull();
  });

  test("completed offscreen paragraphs refresh too without being removed", async () => {
    document
      .getElementById("root")
      .insertAdjacentHTML(
        "beforeend",
        '<p id="second-paragraph">A separate paragraph away from the current viewport.</p>'
      );
    await start();
    const wrappers = [...document.querySelectorAll(wrapperSelector)];
    expect(wrappers).toHaveLength(2);
    observers[0].callback([
      { target: document.getElementById("paragraph"), isIntersecting: false },
      {
        target: document.getElementById("second-paragraph"),
        isIntersecting: false,
      },
    ]);
    await drain();
    const pending = deferred();
    apiTranslate.mockReturnValue(pending.promise);
    translator.updateRule({ apiSlug: "third" });
    await drain();
    expect([...document.querySelectorAll(wrapperSelector)]).toEqual(wrappers);
    expect(apiTranslate).toHaveBeenCalledTimes(4);
    pending.resolve({ trText: "整个已有译文已更新", isSame: false });
    await drain();
    expect(
      wrappers.map(
        (wrapper) => wrapper.querySelector(innerSelector).textContent
      )
    ).toEqual(["整个已有译文已更新", "整个已有译文已更新"]);
  });

  test("changing original wrapping while loading preserves the replacement and source link", async () => {
    const link = document.getElementById("source-link");
    const wrapper = await start();
    const pending = deferred();
    apiTranslate.mockReturnValueOnce(pending.promise);
    translator.updateRule({ apiSlug: "second" });
    await drain();
    translator.updateRule({ wrapOriginal: "true", transOrder: "translation-first" });
    await drain();
    expect(wrapper.querySelector(innerSelector).textContent).toBe("原有译文");
    expect(document.getElementById("source-link")).toBe(link);
    expect(document.getElementById("paragraph").firstElementChild).toBe(wrapper);
    expect(apiTranslate).toHaveBeenCalledTimes(2);
    pending.resolve({ trText: "新布局的新译文", isSame: false });
    await drain();
    expect(wrapper.querySelector(innerSelector).textContent).toBe("新布局的新译文");
    translator.disable();
    expect(document.getElementById("source-link")).toBe(link);
    expect(link.parentElement.id).toBe("paragraph");
  });
});
