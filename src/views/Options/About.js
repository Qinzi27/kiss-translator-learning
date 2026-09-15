import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import ReactMarkdown from "react-markdown";
import { useI18n, useI18nMd } from "../../hooks/I18n";
import Button from "@mui/material/Button";
import Logo from "../../components/Logo";
import { SettingsAdvanced } from "./SettingsCard";
import { useRef } from "react";

function LocalUpdateHelp({ headingRef }) {
  return (
    <section
      className="kt-about-update"
      aria-labelledby="kt-local-update-title"
    >
      <h2 id="kt-local-update-title" ref={headingRef} tabIndex={-1}>
        本地一键更新
      </h2>
      <p>
        在电脑上运行安装包内的更新工具。需要 Python 3.9 或更新版本，不需要
        Git、Node.js 或访问令牌。
      </p>
      <ol>
        <li>
          打开已解压的安装包目录，在 <code>chrome</code> 文件夹旁找到更新工具：
          macOS 双击 <code>更新插件.command</code>；Windows 双击{" "}
          <code>更新插件.bat</code>。
        </li>
        <li>
          工具运行后才会联网检查版本，自动下载、校验并替换原目录中的插件文件。
          请等待工具提示更新完成。
        </li>
        <li>
          在浏览器扩展管理页，点击本插件的“重新加载”，再刷新正在阅读的网页或 PDF
          标签页。
        </li>
      </ol>
      <p className="kt-about-update__note">
        保持原安装目录，并保留浏览器中已安装的扩展，原有设置会保留。此页面只能显示说明，
        不能直接执行电脑上的脚本；打开此页不会检查或下载更新。
      </p>
      <Button
        component="a"
        variant="outlined"
        href={process.env.REACT_APP_RELEASES_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        手动下载学习版安装包
      </Button>
      <p className="kt-about-update__fallback">
        如果原安装包没有更新工具，请先从发布页下载完整安装包。手动更新时，用新包中的
        <code>chrome</code> 内容替换原安装目录中的对应文件，再重新加载扩展。
      </p>
    </section>
  );
}

/**
 * Render the localized project details in Markdown.
 */
function AboutDetails() {
  const i18n = useI18n();
  const { data, loading, error } = useI18nMd("about_md");

  return loading ? (
    <div className="kt-about-loading">
      <CircularProgress size={24} />
    </div>
  ) : (
    <ReactMarkdown>{error ? i18n("about_md_local") : data}</ReactMarkdown>
  );
}

export default function About() {
  const i18n = useI18n();
  const isLearningEdition = process.env.REACT_APP_LEARNING_EDITION === "true";
  const updateHeadingRef = useRef(null);

  return (
    <Box className="kt-about-page">
      <section className="kt-about-hero">
        <Logo size={72} className="kt-about-hero__logo" />
        <h2>{i18n("app_name")}</h2>
        <div className="kt-about-hero__version">
          v{process.env.REACT_APP_VERSION_NAME || process.env.REACT_APP_VERSION}
        </div>
        <p>{i18n("settings_about_description")}</p>
        <small>{i18n("settings_about_license")}</small>
        <div className="kt-about-hero__actions">
          {isLearningEdition ? (
            <Button
              variant="contained"
              onClick={() => {
                updateHeadingRef.current?.scrollIntoView?.({ block: "start" });
                updateHeadingRef.current?.focus({ preventScroll: true });
              }}
            >
              使用一键更新
            </Button>
          ) : (
            <Button
              component="a"
              variant="contained"
              href={process.env.REACT_APP_RELEASES_URL}
              target="_blank"
              rel="noreferrer"
            >
              {i18n("settings_check_updates")}
            </Button>
          )}
          <Button
            component="a"
            variant="outlined"
            href={process.env.REACT_APP_HOMEPAGE}
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </Button>
          {!isLearningEdition && (
            <Button
              component="a"
              variant="outlined"
              href={process.env.REACT_APP_SITEURL}
              target="_blank"
              rel="noreferrer"
            >
              {i18n("settings_project_website")}
            </Button>
          )}
        </div>
      </section>

      {isLearningEdition && <LocalUpdateHelp headingRef={updateHeadingRef} />}

      <SettingsAdvanced
        className="kt-about-details"
        label={i18n("settings_project_details")}
      >
        <div className="kt-about-markdown">
          <AboutDetails />
        </div>
      </SettingsAdvanced>
    </Box>
  );
}
