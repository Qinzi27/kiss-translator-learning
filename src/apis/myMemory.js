import { fetchData } from "../libs/fetch";

// Anonymous public GET API: https://mymemory.translated.net/doc/spec.php
// Its q limit is 500 UTF-8 bytes, not JavaScript string length.
const ENDPOINT = "https://api.mymemory.translated.net/get";
const MAX_BYTES = 500;
const MIN_INTERVAL = 1000;
let requestQueue = Promise.resolve();
let lastRequestAt = null;
let blockedUntil = 0;
let limitEpoch = 0;

function limitError(
  message = "MyMemory 达到免费额度或请求限制，已停止待发任务；请稍后手动重试。"
) {
  const error = new Error(message);
  error.code = "MYMEMORY_LIMIT";
  return error;
}

function aborted() {
  const error = new Error("MyMemory 翻译已取消。");
  error.name = "AbortError";
  return error;
}

function checkAbort(signal) {
  if (signal?.aborted) throw aborted();
}

function wait(ms, signal) {
  checkAbort(signal);
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener("abort", cancel);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const cancel = () => {
      clearTimeout(timer);
      cleanup();
      reject(aborted());
    };
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

// Reject a cancelled queued caller promptly. Its queued callback still checks
// the signal before sending; cancellation never releases another active fetch.
function withCancellation(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", cancel);
    const cancel = () => {
      cleanup();
      reject(aborted());
    };
    signal.addEventListener("abort", cancel, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      }
    );
    if (signal.aborted) cancel();
  });
}

function language(value, allowAuto = false) {
  const supported = {
    en: "en",
    "en-US": "en",
    "en-GB": "en",
    zh: "zh-CN",
    "zh-CN": "zh-CN",
    "zh-Hans": "zh-CN",
    "zh-TW": "zh-TW",
    "zh-Hant": "zh-TW",
  };
  if (allowAuto && value === "auto") return "auto";
  if (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(supported, value)
  )
    return supported[value];
  throw new Error("MyMemory 学习版仅支持中文和英文互译。");
}

function detect(text) {
  // Deliberately local and simple; this is not a general language detector.
  if (/\p{Script=Han}/u.test(text)) return "zh-CN";
  if (/[A-Za-z]/.test(text)) return "en";
  if (/\p{Letter}/u.test(text))
    throw new Error(
      "MyMemory 无法将这段文本识别为中文或英文，请手动选择源语言。"
    );
  return null;
}

const escapeText = (value) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function decodeEntities(value) {
  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: "\u00a0",
  };
  return value.replace(
    /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
    (entity, code) => {
      if (code[0] !== "#") return named[code.toLowerCase()] || entity;
      const point =
        code[1].toLowerCase() === "x"
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
      return point > 0 &&
        point <= 0x10ffff &&
        !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point)
        : entity;
    }
  );
}

// Tokenize without DOMParser/document/Node so the adapter also runs in MV3.
// Only markup from the input is preserved; remote results are always escaped.
function pieces(text, isHtml) {
  const protectedToken =
    /\{\{[^{}\r\n]*\}\}|\{\d+\}|\[\[\d+\]\]|\[\d+\]|\$\{[^{}\r\n]+\}|%(?:\d+\$)?[sdif]|\r\n|\r|\n/g;
  const htmlToken =
    /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<![^>]*>|<\/?[a-zA-Z][\w:.-]*(?:"[^"]*"|'[^']*'|[^'"<>])*>|&(?:#x[\da-f]+|#\d+|[a-z][\da-z]+);|\{\{[^{}\r\n]*\}\}|\{\d+\}|\[\[\d+\]\]|\[\d+\]|\$\{[^{}\r\n]+\}|%(?:\d+\$)?[sdif]|\r\n|\r|\n/gi;
  const matcher = isHtml ? htmlToken : protectedToken;
  const result = [];
  let end = 0;
  let match;
  while ((match = matcher.exec(text))) {
    if (match.index > end)
      result.push({ value: text.slice(end, match.index), literal: false });
    let token = match[0];
    const block =
      isHtml && token.match(/^<(code|pre|script|style|textarea|kbd|samp)\b/i);
    if (block && !/\/\s*>$/.test(token)) {
      const name = block[1];
      const tags = new RegExp(
        `<\\/?${name}\\b(?:"[^"]*"|'[^']*'|[^'"<>])*>`,
        "gi"
      );
      tags.lastIndex = matcher.lastIndex;
      let depth = 1;
      let tag;
      while ((tag = tags.exec(text))) {
        if (/^<\//.test(tag[0])) depth -= 1;
        else if (
          !/^(script|style|textarea)$/i.test(name) &&
          !/\/\s*>$/.test(tag[0])
        )
          depth += 1;
        if (!depth) break;
      }
      matcher.lastIndex = depth ? text.length : tags.lastIndex;
      token = text.slice(match.index, matcher.lastIndex);
    }
    result.push({ value: token, literal: true });
    end = matcher.lastIndex;
  }
  if (end < text.length)
    result.push({ value: text.slice(end), literal: false });
  return result;
}

function byteLength(character) {
  const code = character.codePointAt(0);
  if (code >= 0xd800 && code <= 0xdfff)
    throw new Error("MyMemory 待译文本含有无效的 Unicode 字符。");
  return code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
}

function splitUtf8(text) {
  const chunks = [];
  let chunk = "";
  let size = 0;
  let boundary = 0;
  for (const character of text) {
    const bytes = byteLength(character);
    if (size + bytes > MAX_BYTES) {
      // Prefer an existing word/sentence boundary, retaining every source character.
      if (boundary > chunk.length / 2) {
        chunks.push(chunk.slice(0, boundary));
        chunk = chunk.slice(boundary);
        size = [...chunk].reduce((sum, item) => sum + byteLength(item), 0);
      } else {
        chunks.push(chunk);
        chunk = "";
        size = 0;
      }
      boundary = 0;
    }
    chunk += character;
    size += bytes;
    if (/[\s.!?。！？；;]/u.test(character)) boundary = chunk.length;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

function responseText(response) {
  if (!response || typeof response !== "object" || Array.isArray(response))
    throw new Error("MyMemory 返回了空响应或无效数据。");
  const status = Number(response.responseStatus);
  const warning = String(response.responseDetails || "");
  const value = response.responseData?.translatedText;
  if (
    response.quotaFinished === true ||
    response.quotaFinished === "true" ||
    /^(?:MYMEMORY WARNING|QUERY LENGTH LIMIT EXCEEDED)/i.test(
      String(value || "").trim()
    ) ||
    /quota|limit exceeded|too many requests/i.test(warning)
  ) {
    throw limitError();
  }
  if (status === 429)
    throw limitError(
      "MyMemory 请求过于频繁（429），已停止待发任务，请稍后手动重试。"
    );
  if (
    status !== 200 ||
    response.error ||
    warning.trim() ||
    /^(?:INVALID LANGUAGE PAIR|PLEASE SELECT TWO DISTINCT LANGUAGES|NO QUERY SPECIFIED|UNSUPPORTED LANGUAGE PAIR)/i.test(
      String(value || "")
    )
  )
    throw new Error(
      `MyMemory 服务未能完成翻译${Number.isFinite(status) ? `（${status}）` : ""}。`
    );
  if (typeof value !== "string" || !value.trim())
    throw new Error("MyMemory 未返回有效译文。");
  return decodeEntities(value).trim();
}

function requestError(error) {
  if (error?.name === "AbortError") return aborted();
  if (error?.code === "NETWORK_POLICY_BLOCKED") return error;
  let status = error?.status;
  try {
    status = status || JSON.parse(error?.message)?.status;
  } catch {
    /* No response status. */
  }
  if (Number(status) === 429)
    return limitError(
      "MyMemory 请求过于频繁（429），已停止待发任务，请稍后手动重试。"
    );
  if (Number(status) >= 400)
    return new Error(`MyMemory 请求失败（HTTP ${Number(status)}）。`);
  if (error?.name === "TimeoutError")
    return new Error("MyMemory 请求超时，请稍后手动重试。");
  // Do not include the lower-level error's URL: its query contains source text.
  return new Error("MyMemory 网络请求失败，请检查网络后手动重试。");
}

function request(text, { from, to, signal, httpTimeout, interval }) {
  if (Date.now() < blockedUntil) return Promise.reject(limitError());
  const epoch = limitEpoch;
  const job = requestQueue
    .then(async () => {
      checkAbort(signal);
      if (epoch !== limitEpoch || Date.now() < blockedUntil) throw limitError();
      if (lastRequestAt !== null)
        await wait(Math.max(0, lastRequestAt + interval - Date.now()), signal);
      checkAbort(signal);
      const params = new URLSearchParams({
        q: text,
        langpair: `${from}|${to}`,
      });
      lastRequestAt = Date.now();
      let response;
      try {
        response = await fetchData(
          `${ENDPOINT}?${params.toString()}`,
          {
            method: "GET",
            credentials: "omit",
            referrerPolicy: "no-referrer",
          },
          {
            useCache: false,
            usePool: false,
            httpTimeout,
            signal,
            expect: "json",
          }
        );
      } catch (error) {
        throw requestError(error);
      }
      checkAbort(signal);
      return responseText(response);
    })
    .catch((error) => {
      if (
        error?.code === "MYMEMORY_LIMIT" &&
        epoch === limitEpoch &&
        Date.now() >= blockedUntil
      ) {
        blockedUntil = Date.now() + 60000;
        limitEpoch += 1;
      }
      throw error;
    });
  requestQueue = job.catch(() => {});
  return withCancellation(job, signal);
}

/** Translate anonymously; sequential chunks are never retried or redirected to
 * another provider. Existing-target text, code, markup and placeholders stay local.
 * The shared queue serializes requests within this runtime, not across browsers.
 */
export async function translateMyMemory(
  text,
  {
    fromLang = "auto",
    toLang = "zh-CN",
    textFormat = "text",
    signal,
    httpTimeout = 30,
    fetchInterval = MIN_INTERVAL,
  } = {}
) {
  checkAbort(signal);
  if (typeof text !== "string" || !text.trim())
    throw new Error("MyMemory 待译文本不能为空。");
  if (textFormat !== "text" && textFormat !== "html")
    throw new Error("MyMemory 仅支持 text 或 html 文本格式。");
  const to = language(toLang);
  let from = language(fromLang, true);
  const tokens = pieces(text, textFormat === "html");
  const sourceText = tokens
    .filter((token) => !token.literal)
    .map((token) => token.value)
    .join(" ");
  if (from === "auto") from = detect(sourceText) || to;
  if (from.split("-")[0] === to.split("-")[0]) return { text, from };
  const interval = Number.isFinite(Number(fetchInterval))
    ? Math.min(60000, Math.max(MIN_INTERVAL, Number(fetchInterval)))
    : MIN_INTERVAL;
  // Prepare all chunks first so malformed UTF-16 is rejected before sending any text.
  const prepared = tokens.map((token) =>
    token.literal
      ? [token]
      : splitUtf8(token.value).map((value) => ({ value, literal: false }))
  );
  let output = "";
  for (const group of prepared) {
    for (const token of group) {
      checkAbort(signal);
      if (token.literal || !/\p{Letter}/u.test(token.value)) {
        output += token.value;
        continue;
      }
      const [, leading, content, trailing] = token.value.match(
        /^(\s*)([\s\S]*?)(\s*)$/
      );
      const translated = await request(content, {
        from,
        to,
        signal,
        httpTimeout,
        interval,
      });
      checkAbort(signal);
      output +=
        leading +
        (textFormat === "html" ? escapeText(translated) : translated) +
        trailing;
    }
  }
  return { text: output, from };
}
