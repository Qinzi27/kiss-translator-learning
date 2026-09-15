import { useEffect, useState } from "react";
import "./PdfAccessControls.css";
import {
  getPdfHandlingEnabled,
  hasActiveMimePdf,
  returnToNativePdf,
  setPdfHandlingEnabled,
  supportsPdfMimeHandler,
} from "../../libs/pdfMimeHandler";

export default function PdfAccessControls({ isMimeHandler = false }) {
  const [enabled, setEnabled] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    getPdfHandlingEnabled().then(
      (value) => active && setEnabled(value),
      () => active && setError("未能读取 PDF 打开方式，请刷新页面重试。")
    );
    return () => {
      active = false;
    };
  }, []);
  async function change(enabled) {
    setBusy(true);
    setError("");
    try {
      await setPdfHandlingEnabled(enabled);
      setEnabled(enabled);
    } catch (error) {
      setError(error.message || "未能更改 PDF 打开方式。");
    } finally {
      setBusy(false);
    }
  }
  async function fallback() {
    setBusy(true);
    setError("");
    try {
      await returnToNativePdf();
    } catch (error) {
      setError(error.message || "未能返回 Chrome 原生阅读器。");
      setBusy(false);
    }
  }
  if (!supportsPdfMimeHandler())
    return (
      <p className="pdf-help">
        Chrome 151 及更新版本可直接在 PDF 中显示本阅读界面；旧版浏览器可按 Alt /
        Option + Q 或点击插件的「翻译当前 PDF」。
      </p>
    );
  return (
    <div className="pdf-access-controls">
      <label className="pdf-auto-pages">
        <input
          type="checkbox"
          checked={enabled === true}
          disabled={busy || enabled === null}
          onChange={(event) => change(event.target.checked)}
        />
        打开 PDF 时直接使用双语阅读器
      </label>
      <span>只打开原文，点击翻译后才调用服务。</span>
      {(isMimeHandler || hasActiveMimePdf()) && (
        <button disabled={busy} onClick={fallback}>
          {isMimeHandler ? "返回 Chrome 原生阅读器" : "返回最初打开的 PDF"}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
