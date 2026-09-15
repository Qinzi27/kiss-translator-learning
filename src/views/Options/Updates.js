import { useEffect, useRef, useState } from "react";
import { browser } from "../../libs/browser";
import { browserUpdateStore } from "../../libs/browserUpdateStore";
import {
  checkBrowserRelease,
  compareLearningVersions,
  downloadBrowserRelease,
} from "../../libs/browserUpdateRelease";
import {
  connectUpdateDirectory,
  getBrowserUpdateSupport,
  installBrowserUpdate,
  readBrowserUpdateState,
  readInstalledUpdateManifest,
  requestUpdateDirectoryPermission,
  restoreBrowserUpdate,
  withBrowserUpdateLock,
} from "../../libs/browserUpdateInstall";
import { useSetting } from "../../hooks/Setting";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Alert from "@mui/material/Alert";
import "./updates.css";

const phaseText = (progress) => {
  const names = {
    download: "下载并校验",
    unpack: "检查安装包",
    backup: "建立本地备份",
    write: "写入插件文件",
    restore: "恢复原版文件",
  };
  const count = progress?.total
    ? ` · ${progress.completed}/${progress.total}`
    : "";
  return `${names[progress?.phase] || "正在处理"}${count}${progress?.path ? ` · ${progress.path}` : ""}`;
};

export default function Updates() {
  const { setting } = useSetting();
  const [support, setSupport] = useState(null);
  const [ready, setReady] = useState(false);
  const [directory, setDirectory] = useState(null);
  const [diskVersion, setDiskVersion] = useState("");
  const [release, setRelease] = useState(null);
  const [backup, setBackup] = useState(null);
  const [operation, setOperation] = useState("");
  const [progress, setProgress] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const storeRef = useRef(null);
  const controllerRef = useRef(null);
  const activeRef = useRef(true);
  const workingRef = useRef(false);
  const needsRecovery = ["writing", "recovering"].includes(backup?.phase);
  const offline = setting?.networkPolicy === "offline";

  useEffect(() => {
    activeRef.current = true;
    (async () => {
      const supported = await getBrowserUpdateSupport();
      if (!activeRef.current) return;
      setSupport(supported);
      if (!supported.supported) return;
      const store = browserUpdateStore();
      storeRef.current = store;
      const saved = await readBrowserUpdateState(store);
      if (!activeRef.current) return;
      setDirectory(
        saved.connection?.directory || saved.backup?.directory || null
      );
      setBackup(saved.backup || null);
      setReady(true);
      // Mounting never requests permissions, probes the folder or accesses the network.
    })().catch((failure) => {
      if (activeRef.current) setError(failure.message);
    });
    return () => {
      activeRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!operation) return undefined;
    const preventClose = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventClose);
    return () => window.removeEventListener("beforeunload", preventClose);
  }, [operation]);

  const refreshState = async () => {
    if (!storeRef.current) return;
    const state = await readBrowserUpdateState(storeRef.current);
    if (activeRef.current) {
      setBackup(state.backup || null);
      setDirectory(
        state.connection?.directory || state.backup?.directory || null
      );
    }
  };

  const run = async (name, action) => {
    if (!ready || workingRef.current) return;
    workingRef.current = true;
    const controller = new AbortController();
    controllerRef.current = controller;
    setOperation(name);
    setError("");
    setNotice("");
    setProgress(null);
    try {
      await action(controller.signal);
    } catch (failure) {
      if (activeRef.current)
        setError(
          failure.name === "AbortError"
            ? "已取消操作；写入中断时会恢复原版。"
            : failure.message
        );
    } finally {
      try {
        await refreshState();
      } catch (failure) {
        if (activeRef.current) setError(failure.message);
      }
      workingRef.current = false;
      if (activeRef.current) {
        setOperation("");
        setProgress(null);
      }
      controllerRef.current = null;
    }
  };

  const chooseDirectory = () =>
    run("授权安装目录", async () => {
      // Invoke the picker synchronously in this click's activation, before awaits.
      const picker = globalThis.showDirectoryPicker({
        id: "kiss-learning-extension",
        mode: "readwrite",
      });
      const chosen = await picker;
      await withBrowserUpdateLock(async () => {
        const manifest = await connectUpdateDirectory(chosen, storeRef.current);
        setDirectory(chosen);
        setDiskVersion(manifest.version_name);
        setNotice("已确认这是 Chrome 当前加载的安装目录。以后可直接在此更新。");
      });
    });

  const check = () =>
    run("检查新版本", async (signal) => {
      const newest = await checkBrowserRelease({ signal });
      setRelease(newest);
      setNotice(
        compareLearningVersions(newest.version, support.current) > 0
          ? `发现 ${newest.version}，可在此更新。`
          : "当前运行的插件已是最新发布版。"
      );
    });

  const update = () =>
    run("更新插件", async (signal) => {
      // Permissions are requested by this explicit click; no automatic/background updates.
      await requestUpdateDirectoryPermission(directory);
      await withBrowserUpdateLock(async () => {
        const state = await readBrowserUpdateState(storeRef.current);
        if (["writing", "recovering"].includes(state.backup?.phase))
          throw new Error("请先恢复上次未完成更新。");
        const current = await readInstalledUpdateManifest(directory);
        if (
          compareLearningVersions(current.version_name, release.version) >= 0
        ) {
          setDiskVersion(current.version_name);
          setNotice("安装目录已有相同或更高版本，请点击“重新加载插件”应用。");
          return;
        }
        const downloaded = await downloadBrowserRelease(release, {
          signal,
          onProgress: setProgress,
        });
        const installed = await installBrowserUpdate(
          directory,
          downloaded,
          storeRef.current,
          { signal, onProgress: setProgress }
        );
        setDiskVersion(installed.version_name);
        setNotice(
          `已更新到 ${installed.version_name}。点击“重新加载插件”，然后刷新阅读标签。`
        );
      });
    });

  const restore = () =>
    run("恢复备份", async () => {
      const chosen = backup?.directory;
      await requestUpdateDirectoryPermission(chosen);
      await withBrowserUpdateLock(async () => {
        const manifest = await restoreBrowserUpdate(storeRef.current, {
          onProgress: setProgress,
        });
        setDiskVersion(manifest.version_name);
        setNotice(
          `已恢复 ${manifest.version_name}，请重新加载插件并刷新阅读标签。`
        );
      });
    });

  const canDownload =
    release &&
    compareLearningVersions(
      release.version,
      diskVersion || support?.current || release.version
    ) > 0;
  const reload = () =>
    run("重新加载插件", () =>
      withBrowserUpdateLock(async () => {
        const state = await readBrowserUpdateState(storeRef.current);
        if (["writing", "recovering"].includes(state.backup?.phase))
          throw new Error("请先恢复上次未完成更新。");
        browser.runtime.reload();
      })
    );

  return (
    <div className="kt-update-page">
      <section className="kt-update-card">
        <span className="kt-update-eyebrow">LEARNING EDITION</span>
        <h2>在 Chrome 中更新</h2>
        <p>
          检查、下载和应用学习版更新。首次选择 Chrome 已加载的{" "}
          <code>chrome</code> 文件夹，并允许浏览器写入。
        </p>
        <div className="kt-update-versions">
          <div>
            <small>正在运行</small>
            <strong>
              {support?.current || process.env.REACT_APP_VERSION_NAME}
            </strong>
          </div>
          <div>
            <small>安装目录</small>
            <strong>
              {diskVersion ||
                (directory ? "已记住 · 操作时确认权限" : "尚未选择")}
            </strong>
          </div>
          <div>
            <small>最新发布</small>
            <strong>{release?.version || "尚未检查"}</strong>
          </div>
        </div>
        {!ready && (!support || support.supported) && !error && (
          <p role="status">正在检查浏览器能力与恢复记录…</p>
        )}
        {support && !support.supported && (
          <Alert severity="info">{support.reason}</Alert>
        )}
        {offline && (
          <Alert severity="info">
            当前为“仅本机离线”，已停止联网检查。可在概览切换联网策略后更新；恢复备份无需联网。
          </Alert>
        )}
        {needsRecovery && (
          <Alert severity="warning">
            上次更新尚未完成。请先恢复原版文件，期间保持此页面打开。
          </Alert>
        )}
        <div className="kt-update-actions">
          <Button
            variant="outlined"
            disabled={
              !ready || !support?.supported || !!operation || needsRecovery
            }
            onClick={chooseDirectory}
          >
            {directory ? "重新选择安装目录" : "选择并授权安装目录"}
          </Button>
          <Button
            variant="outlined"
            disabled={
              !ready ||
              !support?.supported ||
              !!operation ||
              offline ||
              needsRecovery
            }
            onClick={check}
          >
            检查更新
          </Button>
          <Button
            variant="contained"
            disabled={
              !ready ||
              !support?.supported ||
              !directory ||
              !canDownload ||
              !!operation ||
              offline ||
              needsRecovery
            }
            onClick={update}
          >
            下载并更新
          </Button>
          <Button
            variant="outlined"
            disabled={
              !ready || !support?.supported || !!operation || needsRecovery
            }
            onClick={reload}
          >
            重新加载插件
          </Button>
        </div>
        {!!operation && (
          <div className="kt-update-progress" role="status" aria-live="polite">
            <CircularProgress size={22} />
            <div>
              <strong>{operation}</strong>
              <p>{progress ? phaseText(progress) : "请等待浏览器处理…"}</p>
            </div>
            {!["恢复备份", "授权安装目录"].includes(operation) && (
              <Button onClick={() => controllerRef.current?.abort()}>
                取消
              </Button>
            )}
          </div>
        )}
        {error && (
          <Alert severity="error" role="alert">
            {error}
          </Alert>
        )}
        {notice && (
          <Alert severity="success" role="status">
            {notice}
          </Alert>
        )}
      </section>
      <section className="kt-update-card kt-update-secondary">
        <h3>上一次更新备份</h3>
        <p>
          {backup && backup.phase !== "restored"
            ? `可恢复 ${backup.beforeManifest?.version_name}。备份只包含此次改动的插件文件。`
            : "完成一次更新后，这里会保留一份可恢复的文件备份。"}
        </p>
        <Button
          variant="outlined"
          disabled={
            !ready ||
            !support?.supported ||
            !backup ||
            backup.phase === "restored" ||
            !!operation
          }
          onClick={restore}
        >
          {needsRecovery ? "恢复未完成更新" : "恢复上一版文件"}
        </Button>
        <p className="kt-update-note">
          更新时请保持本页面打开；恢复完成后再重新加载。设置和 API Key
          保存在原浏览器配置中，文件回退不会回滚设置。重新加载会中止翻译，阅读标签需刷新。
        </p>
        <p className="kt-update-note">
          只用于本项目的开发者模式安装，包含预发布；联网来源固定为本仓库 GitHub
          发布及附件 CDN。目录授权可能需要浏览器再次确认。下载、ZIP
          解压和备份均有限额。
        </p>
        <details>
          <summary>已有本地更新工具？</summary>
          <p>
            原来的 更新插件.command / 更新插件.bat
            仍可使用。请勿同时运行两种更新方式。浏览器恢复记录保存在插件自身的
            IndexedDB，最多保留一份 64 MiB
            的旧文件备份；移除插件会失去这份备份。
          </p>
        </details>
      </section>
    </div>
  );
}
