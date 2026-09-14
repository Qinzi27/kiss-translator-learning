// Acceptance at the real Translator DOM boundary. Provider replies and viewport
// observation are deterministic mocks; this is not a browser or network test.
jest.mock("../apis", () => ({
  apiMicrosoftDict: jest.fn(),
  apiTranslate: jest.fn(),
  apiYoudaoDict: jest.fn(),
}));
jest.mock("./msg", () => ({ sendBgMsg: jest.fn() }));
jest.mock("./detect", () => ({ tryDetectLang: jest.fn() }));

const { apiTranslate } = require("../apis");
const { tryDetectLang } = require("./detect");
const { GLOBLA_RULE } = require("../config/rules");
const { Translator } = require("./translator");

const wrapperSelector = ".kiss-translator-wrapper";
const translatedSelector = ".kiss-translator-inner";

async function drain() {
  for (let index = 0; index < 4; index += 1) {
    jest.runOnlyPendingTimers();
    await Promise.resolve();
    await Promise.resolve();
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

describe("one-click page translation acceptance with real Translator", () => {
  let translator;
  let originalIntersectionObserver;
  let originalCSSStyleSheet;
  let originalScrollBy;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    apiTranslate.mockReset();
    apiTranslate.mockResolvedValue({ trText: "这是中文译文。", isSame: false });
    tryDetectLang.mockReset();
    tryDetectLang.mockResolvedValue("en");
    document.documentElement.innerHTML = "<head></head><body></body>";
    // jsdom omits the browser UA display:inline value for anchors. Make that
    // fixture value explicit so the link belongs to the surrounding paragraph.
    document.body.innerHTML =
      '<main id="root"><p id="paragraph">Read a useful article with an <a id="original-link" href="#details" style="display: inline">original link</a> and keep this final sentence.</p></main>';
    originalIntersectionObserver = global.IntersectionObserver;
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
    originalCSSStyleSheet = global.CSSStyleSheet;
    global.CSSStyleSheet = class {
      replaceSync() {}
    };
    originalScrollBy = window.scrollBy;
    window.scrollBy = jest.fn();
  });

  afterEach(() => {
    translator?.stop();
    translator = null;
    jest.clearAllTimers();
    jest.useRealTimers();
    global.IntersectionObserver = originalIntersectionObserver;
    global.CSSStyleSheet = originalCSSStyleSheet;
    window.scrollBy = originalScrollBy;
  });

  function create(rule = {}) {
    translator = new Translator({
      rule: { ...GLOBLA_RULE, rootsSelector: "#root", fromLang: "en", ...rule },
      setting: {
        preInit: false,
        minLength: 0,
        transInterval: 0,
        rootMargin: 0,
        mouseHoverSetting: {},
        customStyles: [],
        transApis: [],
      },
    });
    return translator;
  }

  test("one toggle appends translation below original nodes; the next restores text and link events", async () => {
    const paragraph = document.getElementById("paragraph");
    const originalNodes = [...paragraph.childNodes];
    const originalMarkup = paragraph.innerHTML;
    const link = document.getElementById("original-link");
    const onClick = jest.fn((event) => event.preventDefault());
    link.addEventListener("click", onClick);
    create();
    await drain();
    expect(apiTranslate).not.toHaveBeenCalled();
    expect(translator.rule.transOpen).toBe("false");

    translator.toggle();
    await drain();

    const wrapper = paragraph.querySelector(wrapperSelector);
    expect(apiTranslate).toHaveBeenCalledTimes(1);
    expect(translator.rule.transOpen).toBe("true");
    expect(paragraph.querySelectorAll(wrapperSelector)).toHaveLength(1);
    expect(wrapper.querySelector(translatedSelector).textContent).toBe(
      "这是中文译文。"
    );
    expect(wrapper.firstElementChild.tagName).toBe("BR");
    expect(originalNodes[originalNodes.length - 1].nextSibling).toBe(wrapper);
    expect([...paragraph.childNodes].slice(0, originalNodes.length)).toEqual(
      originalNodes
    );
    expect(document.getElementById("original-link")).toBe(link);
    link.click();
    expect(onClick).toHaveBeenCalledTimes(1);

    translator.toggle();

    expect(translator.rule.transOpen).toBe("false");
    expect(paragraph.querySelector(wrapperSelector)).toBeNull();
    expect(paragraph.innerHTML).toBe(originalMarkup);
    expect([...paragraph.childNodes]).toEqual(originalNodes);
    link.click();
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  test("repeated enable commands share a pending request and switching off rejects its late answer", async () => {
    const pending = deferred();
    apiTranslate.mockReturnValueOnce(pending.promise);
    const originalMarkup = document.getElementById("paragraph").innerHTML;
    create();

    translator.enable();
    translator.enable();
    await drain();
    translator.enable();
    expect(apiTranslate).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll(wrapperSelector)).toHaveLength(1);

    translator.toggle();
    expect(document.querySelector(wrapperSelector)).toBeNull();
    pending.resolve({
      trText: "This late answer must stay discarded",
      isSame: false,
    });
    await drain();

    expect(apiTranslate).toHaveBeenCalledTimes(1);
    expect(document.querySelector(wrapperSelector)).toBeNull();
    expect(document.getElementById("paragraph").innerHTML).toBe(originalMarkup);
  });

  test("rapid on-off-on toggles keep the new answer when the old request finishes last", async () => {
    const first = deferred();
    const second = deferred();
    apiTranslate
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    create();

    translator.toggle();
    await drain();
    translator.toggle();
    translator.toggle();
    await drain();
    expect(apiTranslate).toHaveBeenCalledTimes(2);

    second.resolve({ trText: "新一轮正确译文", isSame: false });
    await drain();
    const currentWrapper = document.querySelector(wrapperSelector);
    expect(currentWrapper.querySelector(translatedSelector).textContent).toBe(
      "新一轮正确译文"
    );
    first.resolve({ trText: "旧一轮过期译文", isSame: false });
    await drain();

    expect(document.querySelectorAll(wrapperSelector)).toHaveLength(1);
    expect(document.querySelector(wrapperSelector)).toBe(currentWrapper);
    expect(currentWrapper.querySelector(translatedSelector).textContent).toBe(
      "新一轮正确译文"
    );
    expect(translator.rule.transOpen).toBe("true");
    translator.toggle();
    expect(document.querySelector(wrapperSelector)).toBeNull();
  });

  test("switching off during source detection prevents the translation request", async () => {
    const pending = deferred();
    tryDetectLang.mockReturnValueOnce(pending.promise);
    create({ fromLang: "auto" });

    translator.toggle();
    await drain();
    expect(tryDetectLang).toHaveBeenCalledTimes(1);
    translator.toggle();
    pending.resolve("en");
    await drain();

    expect(apiTranslate).not.toHaveBeenCalled();
    expect(document.querySelector(wrapperSelector)).toBeNull();
    expect(translator.rule.transOpen).toBe("false");
  });

  test("restoring leaves a host-page update to an original text node intact", async () => {
    const paragraph = document.getElementById("paragraph");
    const originalTail = paragraph.lastChild;
    create();
    translator.toggle();
    await drain();
    expect(document.querySelector(wrapperSelector)).not.toBeNull();

    originalTail.textContent =
      " The website updated this sentence during reading.";
    translator.toggle();
    await drain();

    expect(document.querySelector(wrapperSelector)).toBeNull();
    expect(paragraph.lastChild).toBe(originalTail);
    expect(paragraph.textContent).toContain(
      "The website updated this sentence during reading."
    );
    expect(apiTranslate).toHaveBeenCalledTimes(1);
  });
});
