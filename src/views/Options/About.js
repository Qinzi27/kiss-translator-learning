import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import ReactMarkdown from "react-markdown";
import { useI18n, useI18nMd } from "../../hooks/I18n";
import Button from "@mui/material/Button";
import Logo from "../../components/Logo";
import { SettingsAdvanced } from "./SettingsCard";

function LocalUpdateHelp() {
  return (
    <section
      className="kt-about-update"
      aria-labelledby="kt-local-update-title"
    >
      <h2 id="kt-local-update-title">在 Chrome 中更新</h2>
      <p>
        首次选择并授权 Chrome 已加载的 chrome
        文件夹，然后在插件更新面板检查、下载和应用新版。更新后点击“重新加载插件”，再刷新阅读标签。
      </p>
      <Button component="a" href="#/updates" variant="outlined">
        打开更新面板
      </Button>
      <p className="kt-about-update__note">
        打开此页不会联网检查或修改文件。更新面板会核对发布包，保留一份可恢复备份；浏览器可能再次请求目录权限。
      </p>
      <details>
        <summary>保留原来的本地更新工具</summary>
        <p>
          也可运行安装目录的 更新插件.command（macOS）或
          更新插件.bat（Windows），需要 Python
          3.9+。请勿同时运行浏览器和本地两种更新方式。
        </p>
      </details>
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
            <Button component="a" href="#/updates" variant="contained">
              在 Chrome 中更新
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

      {isLearningEdition && <LocalUpdateHelp />}

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
