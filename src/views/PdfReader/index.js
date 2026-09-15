import { useEffect, useRef, useState } from "react";
import { getSettingWithDefault, getRulesWithDefault } from "../../libs/storage";
import { resolveApiPromptSettings } from "../../config/prompt";
import { apiTranslate } from "../../apis";
import { downloadPdf, openPdf, readPdfFile } from "../../libs/pdfDocument";
import { NETWORK_POLICIES } from "../../libs/networkPolicy";
import { consumePdfLaunch, getPdfSourceUrl } from "../../libs/pdfLaunch";
import {
  downloadMimePdf,
  getMimePdfSourceUrl,
} from "../../libs/pdfMimeHandler";
import {
  hashPdfDocument,
  createPdfTranslationContext,
  readPdfTranslationPage,
  writePdfTranslation,
  savePdfReadingState,
  loadPdfReadingState,
  getPdfTranslationSessionInfo,
} from "../../libs/pdfTranslationSession";
import {
  createPdfPrefetchQueue,
  getPdfTranslationTasks,
} from "../../libs/pdfPrefetchQueue";
import {
  mergePdfLiveResults,
  isPdfTranslationTextAllowed,
  PDF_LIVE_RESULT_LIMITS,
} from "../../libs/pdfLiveResults";
import PdfAccessControls from "./PdfAccessControls";
import "./reader.css";

function PdfCanvas({ pdf, number }) {
  const canvas = useRef(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let stopped = false;
    let task;
    let page;
    setError("");
    (async () => {
      try {
        page = await pdf.getPage(number);
        if (stopped) return;
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(
          1.5,
          Math.sqrt(8000000 / (base.width * base.height))
        );
        const viewport = page.getViewport({ scale });
        const target = canvas.current;
        target.width = Math.ceil(viewport.width);
        target.height = Math.ceil(viewport.height);
        task = page.render({
          canvasContext: target.getContext("2d"),
          viewport,
        });
        await task.promise;
      } catch (err) {
        if (!stopped) setError("本页预览未能绘制，右侧仍可阅读提取到的文字。");
      } finally {
        page?.cleanup();
      }
    })();
    return () => {
      stopped = true;
      task?.cancel();
      page?.cleanup();
    };
  }, [pdf, number]);
  return (
    <div className="pdf-sheet">
      {error && <p role="alert">{error}</p>}
      <canvas
        ref={canvas}
        aria-label={`PDF 原稿第 ${number} 页，文字在右侧双语栏`}
      />
    </div>
  );
}

const languageLabel = (value) => (value === "en" ? "英文" : "中文");
const blockKey = (page, paragraph) => `${page.number}-${paragraph.id}`;

export default function PdfReader() {
  const [setting, setSetting] = useState(null);
  const [service, setService] = useState("");
  const [fromLang, setFromLang] = useState("en");
  const [toLang, setToLang] = useState("zh-CN");
  const [url, setUrl] = useState(
    () => new URLSearchParams(window.location.hash.slice(1)).get("url") || ""
  );
  const [documentData, setDocumentData] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [results, setResults] = useState({});
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [showOriginal, setShowOriginal] = useState(true);
  const [showSource, setShowSource] = useState(true);
  const [autoPages, setAutoPages] = useState(false);
  const [autoRequest, setAutoRequest] = useState(null);
  const [activeContext, setActiveContext] = useState(null);
  const [cacheInfo] = useState(getPdfTranslationSessionInfo);
  const loadController = useRef(null);
  const translateController = useRef(null);
  const opened = useRef(null);
  const documentId = useRef(0);
  const alive = useRef(true);
  const interactionEpoch = useRef(0);
  const translateRef = useRef(null);
  const loadRef = useRef(null);
  const queueRef = useRef(null);
  const pageRef = useRef(pageNumber);
  const resultsRef = useRef(results);
  const cacheRestoreEpoch = useRef(0);
  const readingStateEpoch = useRef(0);
  const translationEpoch = useRef(0);
  pageRef.current = pageNumber;
  resultsRef.current = results;

  async function refreshSettings(initial = false) {
    try {
      const [next, rules] = await Promise.all([
        getSettingWithDefault(),
        getRulesWithDefault(),
      ]);
      if (!alive.current) return;
      setSetting(next);
      const apis = next.transApis.filter((api) => !api.isDisabled);
      setService((current) =>
        apis.some((api) => api.apiSlug === current)
          ? current
          : apis.find(
              (api) =>
                api.apiSlug ===
                rules?.find((rule) => rule.pattern === "*")?.apiSlug
            )?.apiSlug ||
            apis[0]?.apiSlug ||
            ""
      );
      if (!initial) setProgress("翻译服务与联网策略已刷新。");
    } catch {
      if (alive.current) setError("无法读取翻译设置，请刷新页面重试。");
    }
  }

  useEffect(() => {
    alive.current = true;
    refreshSettings(true);
    const epoch = interactionEpoch.current;
    consumePdfLaunch()
      .then(async (launch) => {
        const resume =
          launch || (await loadPdfReadingState().catch(() => null));
        if (!alive.current || interactionEpoch.current !== epoch || !resume)
          return;
        setUrl(resume.sourceUrl);
        // A trusted, one-use extension session authorizes this action. A URL
        // fragment alone must never trigger downloads or cloud translation.
        loadRef.current(resume.sourceUrl, {
          quick: launch ? launch.quick !== false : false,
          mimeStream: resume.mimeStream,
          resumePage: launch ? undefined : resume.pageNumber,
        });
      })
      .catch(() => {
        if (alive.current && interactionEpoch.current === epoch)
          setError("未能恢复当前 PDF，请选择文件或粘贴链接后读取。");
      });
    return () => {
      alive.current = false;
      loadController.current?.abort();
      translateController.current?.abort();
      queueRef.current?.queue.close();
      opened.current?.destroy();
    };
  }, []);

  function stop() {
    interactionEpoch.current++;
    translationEpoch.current++;
    loadController.current?.abort();
    translateController.current?.abort();
    queueRef.current?.queue.close();
    queueRef.current = null;
    cacheRestoreEpoch.current++;
    readingStateEpoch.current++;
    loadController.current = null;
    translateController.current = null;
    setBusy("");
    setAutoRequest(null);
    setAutoPages(false);
    setProgress(
      "已停止，保留已完成的译文。已发送的单次请求可能仍在服务端完成。"
    );
  }

  async function load(source, { quick = false, mimeStream, resumePage } = {}) {
    stop();
    const controller = new AbortController();
    loadController.current = controller;
    setBusy("load");
    setError("");
    setProgress("正在读取 PDF…");
    try {
      const bytes = mimeStream
        ? await downloadMimePdf(mimeStream, controller.signal)
        : typeof source === "string"
          ? await downloadPdf(source, controller.signal)
          : await readPdfFile(source, controller.signal);
      if (controller.signal.aborted) return;
      // PDF.js transfers/detaches this buffer, so fingerprint it first.
      const contentId = await hashPdfDocument(bytes).catch(() => null);
      if (controller.signal.aborted) return;
      const next = await openPdf(bytes, {
        signal: controller.signal,
        onProgress: (n, total) => {
          if (!controller.signal.aborted)
            setProgress(`正在提取文字 ${n} / ${total} 页`);
        },
      });
      if (controller.signal.aborted || !alive.current) {
        next.destroy();
        return;
      }
      const old = opened.current;
      opened.current = next;
      const id = ++documentId.current;
      const sourceUrl = mimeStream
        ? getMimePdfSourceUrl(source)
        : typeof source === "string"
          ? getPdfSourceUrl(source)
          : "";
      const requestedPage =
        resumePage ||
        (sourceUrl
          ? Number(
              new URLSearchParams(new URL(sourceUrl).hash.slice(1)).get("page")
            )
          : 1);
      const firstPage =
        Number.isSafeInteger(requestedPage) && requestedPage > 0
          ? Math.min(requestedPage, next.pages.length)
          : 1;
      if (!mimeStream)
        window.history.replaceState(
          null,
          "",
          window.location.pathname + window.location.search
        );
      setDocumentData({
        ...next,
        id,
        contentId,
        sourceUrl,
        isMimeHandler: !!mimeStream,
        name:
          typeof source === "string"
            ? sourceUrl.startsWith("file:")
              ? "本地 PDF"
              : "在线 PDF"
            : source.name,
      });
      setResults({});
      setActiveContext(null);
      setPageNumber(firstPage);
      setShowSource(false);
      setProgress(`已读取 ${next.pages.length} 页。选择服务后点击翻译。`);
      rememberPage(
        { contentId, sourceUrl, isMimeHandler: !!mimeStream, id },
        firstPage
      );
      if (quick) {
        setAutoPages(true);
        setAutoRequest({ documentId: id, page: firstPage });
      }
      old?.destroy();
    } catch (err) {
      if (!controller.signal.aborted && alive.current) {
        setError(err.message || "PDF 无法读取，请尝试其他文件。");
        setProgress("读取未完成，可以重试或选择其他文件。");
      }
    } finally {
      if (loadController.current === controller) {
        loadController.current = null;
        setBusy("");
      }
    }
  }

  loadRef.current = load;
  const enabledApis = (setting?.transApis || [])
    .filter((api) => !api.isDisabled)
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  const selectedApi = enabledApis.find((api) => api.apiSlug === service);
  const currentPage = documentData?.pages[pageNumber - 1];
  const direction = `${fromLang} → ${toLang}`;
  const selectedLabel = selectedApi?.apiName || selectedApi?.apiType || service;
  const translationSignature = `${service}:${direction}`;

  function rememberPage(doc, number) {
    const epoch = ++readingStateEpoch.current;
    if (doc.isMimeHandler) return;
    // Clear another document's resume nonce before a best-effort save. On page
    // turns the cache module can reuse the current matching nonce.
    if (!doc.sourceUrl || !window.location.hash.startsWith("#resume=")) {
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search
      );
    }
    if (!doc.sourceUrl) return;
    savePdfReadingState({
      documentId: doc.contentId,
      sourceUrl: doc.sourceUrl,
      pageNumber: number,
    })
      .then((saved) => {
        if (
          saved &&
          alive.current &&
          readingStateEpoch.current === epoch &&
          documentId.current === doc.id
        )
          window.history.replaceState(null, "", `#resume=${saved.resumeNonce}`);
      })
      .catch(() => {});
  }

  useEffect(() => {
    const epoch = ++cacheRestoreEpoch.current;
    if (!documentData || !selectedApi || !setting) return;
    const doc = documentData;
    let canceled = false;
    const apiSetting = resolveApiPromptSettings(
      { ...selectedApi, useContext: false },
      setting.prompts,
      setting.subtitleSetting
    );
    const valid = () =>
      !canceled &&
      alive.current &&
      cacheRestoreEpoch.current === epoch &&
      documentId.current === doc.id;
    (async () => {
      const contextId = await createPdfTranslationContext({
        documentId: doc.contentId,
        apiSetting: { ...apiSetting, networkPolicy: setting.networkPolicy },
        fromLang,
        toLang,
      });
      if (!valid()) return;
      setActiveContext(contextId);
      if (!contextId) return;
      const pages = doc.pages.filter(
        (page) => page.number >= pageNumber && page.number <= pageNumber + 2
      );
      for (const page of pages) {
        const cached = await readPdfTranslationPage({
          contextId,
          pageNumber: page.number,
          paragraphs: page.paragraphs,
        });
        if (!valid()) return;
        setResults((previous) => {
          if (!valid()) return previous;
          const updates = {};
          for (const paragraph of page.paragraphs) {
            const text = cached[paragraph.id];
            const key = blockKey(page, paragraph);
            if (!isPdfTranslationTextAllowed(text)) continue;
            // A completed live result is newer than a restore read started earlier.
            if (previous[key]?.contextId === contextId) continue;
            updates[key] = {
              text,
              contextId,
              label: selectedLabel,
              direction,
              signature: translationSignature,
              revision: (previous[key]?.revision || 0) + 1,
            };
          }
          return mergePdfLiveResults(previous, updates, pageRef.current);
        });
      }
    })().catch(() => {});
    return () => {
      canceled = true;
    };
  }, [
    documentData,
    selectedApi,
    setting,
    fromLang,
    toLang,
    pageNumber,
    selectedLabel,
    direction,
    translationSignature,
  ]);

  useEffect(() => {
    if (!autoRequest || busy || !setting || !documentData) return;
    if (
      autoRequest.documentId !== documentData.id ||
      autoRequest.page !== pageNumber
    )
      return;
    setAutoRequest(null);
    if (!selectedApi || fromLang === toLang) {
      setAutoPages(false);
      setError("请先选择可用的翻译服务和不同的原文、译文语言，再开始翻译。");
      return;
    }
    translateRef.current(false);
  }, [
    autoRequest,
    busy,
    setting,
    documentData,
    pageNumber,
    selectedApi,
    fromLang,
    toLang,
  ]);

  function changePage(number) {
    if (!documentData || busy === "load") return;
    setPageNumber(number);
    pageRef.current = number;
    setResults((previous) => mergePdfLiveResults(previous, {}, number));
    rememberPage(documentData, number);
    const current = queueRef.current;
    if (current && !current.controller.signal.aborted) {
      current.queue.replace(
        getPdfTranslationTasks(documentData.pages, number, {
          allPages: current.allPages,
        })
      );
    } else if (autoPages) {
      setAutoRequest({ documentId: documentData.id, page: number });
    }
  }

  async function translate(allPages) {
    if (!documentData || !selectedApi || busy) return;
    setAutoRequest(null);
    setAutoPages(!allPages);
    const controller = new AbortController();
    translateController.current = controller;
    const epoch = ++translationEpoch.current;
    setBusy("translate");
    setError("");
    const doc = documentData;
    const canCommit = () =>
      alive.current &&
      documentId.current === doc.id &&
      translationEpoch.current === epoch;
    const valid = () => canCommit() && !controller.signal.aborted;
    let completed = 0;
    let cacheHits = 0;
    let failure = null;
    let queue;
    try {
      // Reload the complete effective provider at the user's action boundary.
      const latest = await getSettingWithDefault();
      if (!valid()) return;
      const api = latest.transApis.find(
        (item) => item.apiSlug === service && !item.isDisabled
      );
      if (!api) throw new Error("该翻译服务已停用或删除，请刷新服务设置。");
      const apiSetting = resolveApiPromptSettings(
        { ...api, useContext: false },
        latest.prompts,
        latest.subtitleSetting
      );
      const contextId = await createPdfTranslationContext({
        documentId: doc.contentId,
        apiSetting: { ...apiSetting, networkPolicy: latest.networkPolicy },
        fromLang,
        toLang,
      }).catch(() => null);
      if (!valid()) return;
      setSetting(latest);
      setActiveContext(contextId);
      const pageReads = new Map();
      const label = api.apiName || api.apiType || service;
      queue = createPdfPrefetchQueue({
        signal: controller.signal,
        onStart: (task) => {
          if (valid())
            setProgress(
              `${task.pageNumber === pageRef.current ? "正在翻译" : "正在预翻译"}第 ${task.pageNumber} 页 · 已完成 ${completed} 段 · ${label}`
            );
        },
        run: async (task) => {
          const previous = resultsRef.current[task.key];
          if (contextId && previous?.contextId === contextId)
            return { trText: previous.text, cached: true };
          if (contextId) {
            if (!pageReads.has(task.pageNumber)) {
              const page = doc.pages.find(
                (item) => item.number === task.pageNumber
              );
              pageReads.set(
                task.pageNumber,
                readPdfTranslationPage({
                  contextId,
                  pageNumber: page.number,
                  paragraphs: page.paragraphs,
                }).catch(() => ({}))
              );
            }
            const cached = await pageReads.get(task.pageNumber);
            if (!valid()) throw new DOMException("已停止", "AbortError");
            if (isPdfTranslationTextAllowed(cached[task.paragraph.id]))
              return { trText: cached[task.paragraph.id], cached: true };
          }
          if (!valid()) throw new DOMException("已停止", "AbortError");
          return apiTranslate({
            text: task.paragraph.text,
            fromLang,
            toLang,
            apiSetting,
            signal: controller.signal,
            textFormat: "text",
            useCache: false,
            usePool: false,
            docInfo: { title: "PDF 学术阅读", description: "", summary: "" },
          });
        },
        onResult: (task, { trText, cached }) => {
          if (!valid()) return;
          if (!isPdfTranslationTextAllowed(trText))
            throw new Error(
              `服务译文为空或超过单段 ${PDF_LIVE_RESULT_LIMITS.maxTranslationChars} 字符限制，已保留旧译文。`
            );
          completed++;
          if (cached) cacheHits++;
          setResults((previous) => {
            if (!canCommit()) return previous;
            if (
              previous[task.key]?.contextId === contextId &&
              previous[task.key]?.text === trText
            )
              return previous;
            return mergePdfLiveResults(
              previous,
              {
                [task.key]: {
                  text: trText,
                  label,
                  direction,
                  contextId,
                  signature: translationSignature,
                  revision: (previous[task.key]?.revision || 0) + 1,
                },
              },
              pageRef.current
            );
          });
          if (contextId && !cached)
            void writePdfTranslation({
              contextId,
              pageNumber: task.pageNumber,
              paragraph: task.paragraph,
              translation: trText,
            }).catch(() => {});
        },
        onError: (err) => {
          failure = err;
          controller.abort();
        },
      });
      queueRef.current = { queue, controller, allPages };
      setAutoRequest(null);
      queue.replace(
        getPdfTranslationTasks(doc.pages, pageRef.current, { allPages })
      );
      await queue.waitForIdle();
      if (failure) throw failure;
      if (valid())
        setProgress(
          completed
            ? `已就绪 ${completed} 段（缓存命中 ${cacheHits} 段）。${allPages ? "" : "本页及后续两页缓冲完成。"}`
            : "没有可提取的文字，扫描件需要先进行 OCR。"
        );
    } catch (err) {
      if (canCommit() && (failure || !controller.signal.aborted)) {
        setAutoPages(false);
        setError(
          `已保留 ${completed} 段新译文。${err.message || "翻译失败，请检查服务配置。"}`
        );
        setProgress("翻译已停止，可切换服务后重试。");
      }
    } finally {
      queue?.close();
      if (translateController.current === controller) {
        queueRef.current = null;
        translateController.current = null;
        setBusy("");
      }
    }
  }
  translateRef.current = translate;

  return (
    <div className={`pdf-reader ${documentData ? "pdf-reading" : ""}`}>
      <header className="pdf-header">
        <a className="pdf-brand" href="options.html">
          <span className="pdf-brand-mark">译</span>
          <span>
            简约翻译<span className="pdf-brand-sub">PDF READER</span>
          </span>
        </a>
        <div className="pdf-header-right">
          <span className="pdf-badge">PDF.js · 本地解析</span>
          <a
            href="options.html#/ai-services"
            target="_blank"
            rel="noopener noreferrer"
          >
            配置翻译服务 ↗
          </a>
        </div>
      </header>
      <main>
        <section className="pdf-intro">
          <div>
            <p className="pdf-eyebrow">论文，也可以双语阅读</p>
            <h1>读原文，也读懂。</h1>
            <p>
              原稿保留在左侧，译文逐段追加在右侧。在线与本机翻译，沿用你的服务设置。
            </p>
          </div>
          <div className="pdf-engine-note">
            由 Mozilla PDF.js 驱动
            <br />
            <a
              href="https://github.com/mozilla/pdf.js"
              target="_blank"
              rel="noopener noreferrer"
            >
              开源组件 · Apache 2.0 ↗
            </a>
          </div>
        </section>
        <section className="pdf-controls" aria-label="PDF 文件与翻译设置">
          <details className="pdf-source-tools" open={showSource}>
            <summary
              onClick={(event) => {
                event.preventDefault();
                setShowSource((value) => !value);
              }}
            >
              {documentData ? "更换 PDF / 查看来源" : "打开文件或链接"}
            </summary>
            <div className="pdf-open-row">
              <label
                className={`pdf-button pdf-button-primary ${busy ? "is-disabled" : ""}`}
              >
                选择 PDF 并翻译
                <input
                  aria-label="选择 PDF 并翻译"
                  type="file"
                  accept=".pdf,application/pdf"
                  disabled={!!busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) load(file, { quick: true });
                    event.target.value = "";
                  }}
                />
              </label>
              <label className={`pdf-button ${busy ? "is-disabled" : ""}`}>
                打开本地 PDF
                <input
                  aria-label="打开本地 PDF"
                  type="file"
                  accept=".pdf,application/pdf"
                  disabled={!!busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) load(file);
                    event.target.value = "";
                  }}
                />
              </label>
              <span className="pdf-or">或</span>
              <input
                aria-label="PDF 链接"
                className="pdf-url"
                type="url"
                placeholder="粘贴 PDF 的 HTTPS 直链"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                disabled={!!busy}
              />
              <button
                disabled={!!busy || !url.trim()}
                onClick={() => load(url)}
              >
                读取链接
              </button>
            </div>
            <p className="pdf-help">
              支持 50 MB、200 页以内的 PDF。「选择 PDF
              并翻译」会使用当前服务翻译所选文件，无需文件网址权限；「打开本地
              PDF」仅打开阅读。文件在本机解析，译文按页生成。需登录或跳转的链接请下载后打开。
            </p>
          </details>
          <PdfAccessControls isMimeHandler={documentData?.isMimeHandler} />
          <div className="pdf-translate-row">
            <label>
              翻译服务
              <select
                aria-label="翻译服务"
                value={service}
                onChange={(event) => setService(event.target.value)}
                disabled={!!busy}
              >
                {!enabledApis.length && (
                  <option value="">暂无启用的服务</option>
                )}
                {enabledApis.map((api) => (
                  <option key={api.apiSlug} value={api.apiSlug}>
                    {api.apiName || api.apiType}
                  </option>
                ))}
              </select>
            </label>
            <label>
              原文
              <select
                aria-label="原文语言"
                value={fromLang}
                onChange={(event) => setFromLang(event.target.value)}
                disabled={!!busy}
              >
                <option value="en">英文</option>
                <option value="zh-CN">中文</option>
              </select>
            </label>
            <span aria-hidden="true" className="pdf-arrow">
              →
            </span>
            <label>
              译文
              <select
                aria-label="译文语言"
                value={toLang}
                onChange={(event) => setToLang(event.target.value)}
                disabled={!!busy}
              >
                <option value="zh-CN">中文</option>
                <option value="en">英文</option>
              </select>
            </label>
            <div className="pdf-translate-actions">
              <button
                disabled={
                  !!busy ||
                  !currentPage?.paragraphs.length ||
                  !selectedApi ||
                  fromLang === toLang
                }
                onClick={() => translate(false)}
              >
                翻译本页
              </button>
              <button
                className="pdf-button-primary"
                disabled={
                  !!busy || !documentData || !selectedApi || fromLang === toLang
                }
                onClick={() => translate(true)}
              >
                一键翻译全文
              </button>
              {busy && (
                <button className="pdf-stop" onClick={stop}>
                  停止
                </button>
              )}
            </div>
          </div>
          <div className="pdf-policy-row">
            <span>
              联网策略：
              {NETWORK_POLICIES.find(
                ([key]) => key === setting?.networkPolicy
              )?.[1] || "读取中"}
            </span>
            <button
              className="pdf-text-button"
              disabled={!!busy}
              onClick={() => refreshSettings()}
            >
              刷新服务设置
            </button>
            <span>切换服务后保留旧译文，重新翻译时逐段替换。</span>
            <label className="pdf-auto-pages">
              <input
                type="checkbox"
                checked={autoPages}
                disabled={!documentData || !!busy}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  setAutoPages(enabled);
                  setAutoRequest(
                    enabled
                      ? { documentId: documentData.id, page: pageNumber }
                      : null
                  );
                }}
              />
              翻页自动翻译
            </label>
          </div>
          <p className="pdf-help">
            翻译本页时预翻译后 2 页，总并发最多 2 个请求。 临时缓存上限为{" "}
            {cacheInfo.maxPages} 个文档／服务／方向页面分区、
            {cacheInfo.maxBytes / 1024 / 1024} MiB，超限淘汰较久未用的内容。
            {cacheInfo.notice}
            当前阅读页的内存译文也限制为 80 页、8 MiB；对象和界面本身另占内存。
            刷新仅恢复阅读和已有译文；文件选择器打开的 PDF
            需重新选择同一文件，不保存 PDF 文件或原文。
          </p>
        </section>
        <div className="pdf-status" role="status" aria-live="polite">
          {busy && <span className="pdf-pulse" />}
          {progress || "选择 PDF 开始阅读。"}
        </div>
        {error && (
          <div className="pdf-error" role="alert">
            {error}
          </div>
        )}
        {documentData ? (
          <section aria-label="PDF 双语内容">
            <div className="pdf-document-toolbar">
              <div>
                <strong>{documentData.name}</strong>
                <span>{documentData.pages.length} 页</span>
                {documentData.sourceUrl && !documentData.isMimeHandler && (
                  <a className="pdf-return" href={documentData.sourceUrl}>
                    返回原 PDF ↗
                  </a>
                )}
              </div>
              <nav aria-label="PDF 分页">
                <button
                  disabled={pageNumber <= 1 || busy === "load"}
                  onClick={() => changePage(pageNumber - 1)}
                >
                  上一页
                </button>
                <label>
                  第{" "}
                  <select
                    aria-label="页码"
                    value={pageNumber}
                    disabled={busy === "load"}
                    onChange={(event) => changePage(Number(event.target.value))}
                  >
                    {documentData.pages.map((page) => (
                      <option key={page.number} value={page.number}>
                        {page.number}
                      </option>
                    ))}
                  </select>{" "}
                  页
                </label>
                <button
                  disabled={
                    pageNumber >= documentData.pages.length || busy === "load"
                  }
                  onClick={() => changePage(pageNumber + 1)}
                >
                  下一页
                </button>
                <button onClick={() => setShowOriginal((value) => !value)}>
                  {showOriginal ? "收起原稿" : "显示原稿"}
                </button>
              </nav>
            </div>
            <div
              className={`pdf-columns ${showOriginal ? "" : "pdf-columns-text"}`}
            >
              {showOriginal && (
                <section className="pdf-original">
                  <div className="pdf-column-heading">
                    <span>原 PDF</span>
                    <span>第 {pageNumber} 页</span>
                  </div>
                  <PdfCanvas
                    key={`${documentData.id}-${pageNumber}`}
                    pdf={documentData.pdf}
                    number={pageNumber}
                  />
                </section>
              )}
              <section className="pdf-bilingual">
                <div className="pdf-column-heading">
                  <span>双语阅读</span>
                  <span>
                    {languageLabel(fromLang)} → {languageLabel(toLang)}
                  </span>
                </div>
                <div className="pdf-paragraphs">
                  {currentPage?.paragraphs.length ? (
                    currentPage.paragraphs.map((paragraph, index) => {
                      const result = results[blockKey(currentPage, paragraph)];
                      return (
                        <article className="pdf-paragraph" key={paragraph.id}>
                          <span className="pdf-paragraph-index">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <p className="pdf-source">{paragraph.text}</p>
                          {result ? (
                            <div
                              className="pdf-translation"
                              key={result.revision}
                            >
                              <p>{result.text}</p>
                              <span>
                                {result.label} · {result.direction}
                                {result.signature !== translationSignature ||
                                (result.contextId &&
                                  result.contextId !== activeContext)
                                  ? " · 上次译文"
                                  : ""}
                              </span>
                            </div>
                          ) : (
                            <div className="pdf-translation-placeholder">
                              译文将在这里展开
                            </div>
                          )}
                        </article>
                      );
                    })
                  ) : (
                    <div className="pdf-empty-text">
                      <h2>本页没有可提取的文字</h2>
                      <p>
                        可能是扫描页或只有图片。这一版尚未接入 OCR，可先用 OCR
                        工具生成带文字层的 PDF。
                      </p>
                    </div>
                  )}
                </div>
              </section>
            </div>
            <p className="pdf-footnote">
              段落顺序由文字坐标推断，复杂双栏、公式与表格请对照原稿。此版本提供阅读译文，不导出保持版式的译文
              PDF。
            </p>
          </section>
        ) : (
          <section className="pdf-empty">
            <div className="pdf-page-symbol" aria-hidden="true">
              <span />
              <span />
              <i />
              <span />
              <i />
            </div>
            <h2>从一篇论文开始</h2>
            <p>
              打开电脑里的 PDF，或粘贴公开论文直链。
              <br />
              支持可选中文字的 PDF，扫描件需先做 OCR。
            </p>
            <div className="pdf-empty-tags">
              <span>原稿对照</span>
              <span>逐段双语</span>
              <span>随时停止</span>
            </div>
          </section>
        )}
      </main>
      {documentData && (
        <button
          className="pdf-floating-translate"
          aria-label={busy === "translate" ? "浮动停止翻译" : "浮动翻译本页"}
          title={
            busy === "translate"
              ? "停止翻译并保留已完成译文"
              : "翻译本页并预翻译后续两页"
          }
          disabled={
            busy === "load" ||
            (!busy &&
              (!selectedApi ||
                fromLang === toLang ||
                !currentPage?.paragraphs.length))
          }
          onClick={() => (busy === "translate" ? stop() : translate(false))}
        >
          {busy === "translate" ? "停" : "译"}
        </button>
      )}
      <footer className="pdf-footer">
        简约翻译 · PDF 双语阅读预览版{" "}
        <span>
          Mozilla PDF.js 6.3.289 ·{" "}
          <a href="pdfjs/LICENSE" target="_blank" rel="noopener noreferrer">
            组件许可证
          </a>
        </span>
      </footer>
    </div>
  );
}
