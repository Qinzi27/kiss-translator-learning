import { useState } from "react";
import PictureAsPdfRoundedIcon from "@mui/icons-material/PictureAsPdfRounded";
import Button from "@mui/material/Button";
import { isGm } from "../../libs/client";
import { openPdfReader, PDF_USERSCRIPT_HINT } from "./pdfEntry";

export default function PdfReaderButton({
  navigation = false,
  prefillCurrentTab = false,
  onOpened,
}) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const currentPdf = prefillCurrentTab && !navigation;
  const label = currentPdf ? "翻译当前 PDF" : "PDF 双语阅读";
  const handleOpen = async () => {
    if (opening) return;
    setOpening(true);
    setError("");
    try {
      await openPdfReader({ prefillCurrentTab });
      onOpened?.();
    } catch (failure) {
      setError(failure?.message || "无法打开 PDF 阅读器，请重试。");
    } finally {
      setOpening(false);
    }
  };
  const contents = (
    <>
      <PictureAsPdfRoundedIcon />
      <span>{opening ? "正在打开…" : label}</span>
    </>
  );
  const title = isGm
    ? PDF_USERSCRIPT_HINT
    : currentPdf
      ? "当前标签打开，自动翻译当前页"
      : "在新标签打开 PDF 阅读器";
  return (
    <div style={navigation ? undefined : { padding: "4px 12px 8px" }}>
      {navigation ? (
        <button
          type="button"
          className="kt-options-nav__link kt-options-nav__link--button"
          aria-label={label}
          title={title}
          disabled={opening || isGm}
          onClick={handleOpen}
        >
          {contents}
        </button>
      ) : (
        <Button
          type="button"
          size="small"
          fullWidth
          variant="text"
          aria-label={label}
          title={title}
          disabled={opening || isGm}
          onClick={handleOpen}
          sx={{ gap: 1, textTransform: "none" }}
        >
          {contents}
        </Button>
      )}
      {currentPdf && !isGm && (
        <p style={{ margin: "0 0 4px", fontSize: 12, textAlign: "center" }}>
          当前标签打开，自动翻译当前页
        </p>
      )}
      {(error || isGm) && (
        <div
          role={error ? "alert" : "note"}
          style={{ fontSize: 12, padding: "4px 12px" }}
        >
          {error || PDF_USERSCRIPT_HINT}
        </div>
      )}
    </div>
  );
}
