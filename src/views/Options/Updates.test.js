import { act } from "react";
import { createRoot } from "react-dom/client";
import Updates from "./Updates";
import { browser } from "../../libs/browser";
import { browserUpdateStore } from "../../libs/browserUpdateStore";
import { checkBrowserRelease, downloadBrowserRelease } from "../../libs/browserUpdateRelease";
import {
  connectUpdateDirectory, getBrowserUpdateSupport, installBrowserUpdate,
  readBrowserUpdateState, readInstalledUpdateManifest, requestUpdateDirectoryPermission,
  restoreBrowserUpdate, withBrowserUpdateLock,
} from "../../libs/browserUpdateInstall";

// Exercise the real component and version comparator; all permission, storage,
// filesystem and network boundaries are synthetic. No browser installation is changed.
jest.mock("../../libs/browser", () => ({ browser: { runtime: { reload: jest.fn() } } }));
jest.mock("../../libs/browserUpdateStore", () => ({ browserUpdateStore: jest.fn() }));
jest.mock("../../libs/networkPolicy", () => ({}));
jest.mock("../../libs/browserUpdateZip", () => ({}));
jest.mock("../../libs/browserUpdateRelease", () => ({
  compareLearningVersions: jest.requireActual("../../libs/browserUpdateRelease").compareLearningVersions,
  checkBrowserRelease: jest.fn(),
  downloadBrowserRelease: jest.fn(),
}));
jest.mock("../../libs/browserUpdateInstall", () => ({
  connectUpdateDirectory: jest.fn(), getBrowserUpdateSupport: jest.fn(),
  installBrowserUpdate: jest.fn(), readBrowserUpdateState: jest.fn(),
  readInstalledUpdateManifest: jest.fn(), requestUpdateDirectoryPermission: jest.fn(),
  restoreBrowserUpdate: jest.fn(), withBrowserUpdateLock: jest.fn(),
}));
let mockSetting;
jest.mock("../../hooks/Setting", () => ({ useSetting: () => ({ setting: mockSetting }) }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const originalPicker = globalThis.showDirectoryPicker;
const originalFetch = globalThis.fetch;
const currentVersion = "2.0.36-learning.9";
const nextVersion = "2.0.36-learning.10";
const manifest = { version_name: currentVersion };
const newest = { version: nextVersion, tag: `v${nextVersion}`, prerelease: true, assets: {} };
const downloaded = { manifest: { version_name: nextVersion }, files: new Map() };
let container;
let root;
let state;
let directory;
let store;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function abortableDownload() {
  const pending = deferred();
  downloadBrowserRelease.mockImplementation((_release, { signal }) => {
    signal.addEventListener("abort", () => pending.reject(new DOMException("cancelled", "AbortError")), { once: true });
    return pending.promise;
  });
  return pending;
}
async function mountUpdates() {
  // ReactDOM's root.render does not provide Testing Library's automatic act.
  // eslint-disable-next-line testing-library/no-unnecessary-act
  await act(async () => { root.render(<Updates />); });
}
function button(label) {
  const found = [...container.querySelectorAll("button")].find((item) => item.textContent === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
async function click(label) { await act(async () => button(label).click()); }
function alerts() { return [...container.querySelectorAll('[role="alert"]')].map((node) => node.textContent).join(" "); }
function statuses() { return [...container.querySelectorAll('[role="status"]')].map((node) => node.textContent).join(" "); }
function backup(phase = "ready") { return { phase, directory, beforeManifest: manifest, afterManifest: downloaded.manifest }; }
async function readyToUpdate() { await mountUpdates(); await click("检查更新"); }

beforeEach(() => {
  jest.resetAllMocks();
  mockSetting = { networkPolicy: "normal" };
  directory = { kind: "directory", name: "chrome", requestPermission: jest.fn(), queryPermission: jest.fn() };
  store = { get: jest.fn(), set: jest.fn() };
  state = { connection: { directory }, backup: null };
  getBrowserUpdateSupport.mockResolvedValue({ supported: true, current: currentVersion });
  browserUpdateStore.mockReturnValue(store);
  readBrowserUpdateState.mockImplementation(async () => state);
  readInstalledUpdateManifest.mockResolvedValue(manifest);
  requestUpdateDirectoryPermission.mockResolvedValue(undefined);
  withBrowserUpdateLock.mockImplementation(async (callback) => callback());
  connectUpdateDirectory.mockImplementation(async (chosen) => {
    state = { connection: { directory: chosen }, backup: null };
    return manifest;
  });
  checkBrowserRelease.mockResolvedValue(newest);
  downloadBrowserRelease.mockResolvedValue(downloaded);
  installBrowserUpdate.mockImplementation(async () => {
    state = { ...state, backup: backup() };
    return downloaded.manifest;
  });
  restoreBrowserUpdate.mockImplementation(async () => {
    state = { ...state, backup: backup("restored") };
    return manifest;
  });
  globalThis.showDirectoryPicker = jest.fn().mockResolvedValue(directory);
  globalThis.fetch = jest.fn(() => { throw new Error("UI test must not access network"); });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container.remove();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
afterAll(() => {
  globalThis.showDirectoryPicker = originalPicker;
  globalThis.fetch = originalFetch;
});

test("mount reads capability and remembered state without checking releases, probing files or prompting", async () => {
  await mountUpdates();
  expect(getBrowserUpdateSupport).toHaveBeenCalledTimes(1);
  expect(browserUpdateStore).toHaveBeenCalledTimes(1);
  expect(readBrowserUpdateState).toHaveBeenCalledWith(store);
  expect(button("重新选择安装目录").disabled).toBe(false);
  expect(button("下载并更新").disabled).toBe(true);
  for (const operation of [checkBrowserRelease, downloadBrowserRelease, installBrowserUpdate,
    connectUpdateDirectory, readInstalledUpdateManifest, requestUpdateDirectoryPermission,
    globalThis.showDirectoryPicker, directory.queryPermission, directory.requestPermission,
    browser.runtime.reload]) expect(operation).not.toHaveBeenCalled();
});

test.each([
  "此 Chrome 不支持所需的文件授权能力。",
  "此入口仅用于加载已解压的学习版；商店安装版请使用商店更新。",
])("unsupported capability prevents every privileged action: %s", async (reason) => {
  getBrowserUpdateSupport.mockResolvedValue({ supported: false, reason });
  await mountUpdates();
  expect(alerts()).toContain(reason);
  for (const action of container.querySelectorAll("button")) {
    expect(action.disabled).toBe(true);
    await act(async () => action.click());
  }
  expect(browserUpdateStore).not.toHaveBeenCalled();
  expect(globalThis.showDirectoryPicker).not.toHaveBeenCalled();
  expect(checkBrowserRelease).not.toHaveBeenCalled();
  expect(browser.runtime.reload).not.toHaveBeenCalled();
});

test("initial state remains locked until recovery metadata has finished loading", async () => {
  const saved = deferred();
  readBrowserUpdateState.mockReturnValueOnce(saved.promise);
  await mountUpdates();
  expect(getBrowserUpdateSupport).toHaveBeenCalledTimes(1);
  expect([...container.querySelectorAll("button")].every((item) => item.disabled)).toBe(true);
  await act(async () => saved.resolve({ connection: { directory }, backup: backup("writing") }));
  expect(button("恢复未完成更新").disabled).toBe(false);
  expect(button("重新加载插件").disabled).toBe(true);
});

test("failed state loading shows an error and cannot proceed without checking recovery metadata", async () => {
  readBrowserUpdateState.mockRejectedValue(new Error("无法读取恢复记录"));
  await mountUpdates();
  expect(alerts()).toContain("无法读取恢复记录");
  expect([...container.querySelectorAll("button")].every((item) => item.disabled)).toBe(true);
});

test("offline blocks check and download but allows an explicit local backup restore", async () => {
  mockSetting.networkPolicy = "offline";
  state.backup = backup();
  await mountUpdates();
  expect(button("检查更新").disabled).toBe(true);
  expect(button("下载并更新").disabled).toBe(true);
  expect(button("恢复上一版文件").disabled).toBe(false);
  await click("检查更新");
  await click("下载并更新");
  expect(checkBrowserRelease).not.toHaveBeenCalled();
  expect(downloadBrowserRelease).not.toHaveBeenCalled();
  await click("恢复上一版文件");
  expect(requestUpdateDirectoryPermission).toHaveBeenCalledWith(directory);
  expect(restoreBrowserUpdate).toHaveBeenCalledTimes(1);
  expect(browser.runtime.reload).not.toHaveBeenCalled();
  expect(statuses()).toContain(currentVersion);
});

test("directory picker runs synchronously in the user's click and is not repeated during a pending choice", async () => {
  state.connection = null;
  const picked = deferred();
  globalThis.showDirectoryPicker.mockReturnValue(picked.promise);
  await mountUpdates();
  expect(globalThis.showDirectoryPicker).not.toHaveBeenCalled();
  act(() => {
    const choose = button("选择并授权安装目录");
    choose.click();
    expect(globalThis.showDirectoryPicker).toHaveBeenCalledWith({ id: "kiss-learning-extension", mode: "readwrite" });
    choose.click();
  });
  expect(globalThis.showDirectoryPicker).toHaveBeenCalledTimes(1);
  expect(connectUpdateDirectory).not.toHaveBeenCalled();
  await act(async () => picked.resolve(directory));
  expect(connectUpdateDirectory).toHaveBeenCalledWith(directory, store);
  expect(withBrowserUpdateLock).toHaveBeenCalledTimes(1);
  expect(button("重新选择安装目录").disabled).toBe(false);
  expect(checkBrowserRelease).not.toHaveBeenCalled();
});

test("picker cancellation is visible and neither connects nor downloads", async () => {
  globalThis.showDirectoryPicker.mockRejectedValue(new DOMException("cancelled", "AbortError"));
  await mountUpdates();
  await click("重新选择安装目录");
  expect(alerts()).toContain("已取消");
  expect(connectUpdateDirectory).not.toHaveBeenCalled();
  expect(downloadBrowserRelease).not.toHaveBeenCalled();
  expect(button("重新选择安装目录").disabled).toBe(false);
});

test("check, download, installation progress and reload require separate user actions", async () => {
  const installation = deferred();
  installBrowserUpdate.mockImplementation((_directory, _downloaded, _store, { onProgress }) => {
    onProgress({ phase: "write", completed: 2, total: 5, path: "content.js" });
    return installation.promise;
  });
  await readyToUpdate();
  expect(checkBrowserRelease).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) });
  expect(statuses()).toContain(nextVersion);
  expect(downloadBrowserRelease).not.toHaveBeenCalled();
  expect(button("下载并更新").disabled).toBe(false);
  await click("下载并更新");
  expect(requestUpdateDirectoryPermission).toHaveBeenCalledWith(directory);
  expect(readInstalledUpdateManifest).toHaveBeenCalledWith(directory);
  const signal = downloadBrowserRelease.mock.calls[0][1].signal;
  expect(downloadBrowserRelease).toHaveBeenCalledWith(newest, { signal, onProgress: expect.any(Function) });
  expect(installBrowserUpdate).toHaveBeenCalledWith(directory, downloaded, store, { signal, onProgress: expect.any(Function) });
  expect(statuses()).toContain("写入插件文件");
  expect(statuses()).toContain("2/5");
  expect(button("重新加载插件").disabled).toBe(true);
  await click("重新加载插件");
  expect(browser.runtime.reload).not.toHaveBeenCalled();
  state.backup = backup();
  await act(async () => installation.resolve(downloaded.manifest));
  expect(statuses()).toContain(nextVersion);
  expect(button("下载并更新").disabled).toBe(true);
  expect(button("恢复上一版文件").disabled).toBe(false);
  expect(browser.runtime.reload).not.toHaveBeenCalled();
  await click("重新加载插件");
  expect(browser.runtime.reload).toHaveBeenCalledTimes(1);
});

test.each([currentVersion, "2.0.36-learning.8"])("an equal or older release %s cannot be downloaded", async (version) => {
  checkBrowserRelease.mockResolvedValue({ ...newest, version });
  await readyToUpdate();
  expect(button("下载并更新").disabled).toBe(true);
  await click("下载并更新");
  expect(downloadBrowserRelease).not.toHaveBeenCalled();
  expect(installBrowserUpdate).not.toHaveBeenCalled();
});

test("a directory updated by another process is rechecked and is never downgraded", async () => {
  readInstalledUpdateManifest.mockResolvedValue({ version_name: "2.0.36-learning.11" });
  await readyToUpdate();
  await click("下载并更新");
  expect(downloadBrowserRelease).not.toHaveBeenCalled();
  expect(installBrowserUpdate).not.toHaveBeenCalled();
  expect(statuses()).toContain("相同或更高版本");
  expect(browser.runtime.reload).not.toHaveBeenCalled();
  expect(button("下载并更新").disabled).toBe(true);
});

test.each(["writing", "recovering"])("a %s backup permits only explicit restoration, then reload", async (phase) => {
  state = { connection: null, backup: backup(phase) };
  const restoring = deferred();
  restoreBrowserUpdate.mockReturnValue(restoring.promise);
  await mountUpdates();
  for (const label of ["重新选择安装目录", "检查更新", "下载并更新", "重新加载插件"]) {
    expect(button(label).disabled).toBe(true);
    await click(label);
  }
  expect(globalThis.showDirectoryPicker).not.toHaveBeenCalled();
  expect(checkBrowserRelease).not.toHaveBeenCalled();
  expect(downloadBrowserRelease).not.toHaveBeenCalled();
  expect(browser.runtime.reload).not.toHaveBeenCalled();
  await click("恢复未完成更新");
  expect(requestUpdateDirectoryPermission).toHaveBeenCalledWith(directory);
  expect(restoreBrowserUpdate).toHaveBeenCalledWith(store, { onProgress: expect.any(Function) });
  expect([...container.querySelectorAll("button")].every((item) => item.disabled)).toBe(true);
  expect([...container.querySelectorAll("button")].some((item) => item.textContent === "取消")).toBe(false);
  state.backup = backup("restored");
  await act(async () => restoring.resolve(manifest));
  expect(button("重新加载插件").disabled).toBe(false);
  expect(button("恢复上一版文件").disabled).toBe(true);
  expect(browser.runtime.reload).not.toHaveBeenCalled();
  await click("重新加载插件");
  expect(browser.runtime.reload).toHaveBeenCalledTimes(1);
});

test("a recovery record appearing after the page loaded is rechecked under the update lock", async () => {
  await readyToUpdate();
  state.backup = backup("writing");
  await click("下载并更新");
  expect(withBrowserUpdateLock).toHaveBeenCalledTimes(1);
  expect(downloadBrowserRelease).not.toHaveBeenCalled();
  expect(installBrowserUpdate).not.toHaveBeenCalled();
  expect(alerts()).toContain("先恢复");
  expect(button("重新加载插件").disabled).toBe(true);
  expect(button("恢复未完成更新").disabled).toBe(false);
});

test.each(["writing", "recovering"])("reload rechecks a new %s journal from another options page", async (phase) => {
  await mountUpdates();
  expect(button("重新加载插件").disabled).toBe(false);
  state.backup = backup(phase);
  await click("重新加载插件");
  expect(withBrowserUpdateLock).toHaveBeenCalledTimes(1);
  expect(browser.runtime.reload).not.toHaveBeenCalled();
  expect(alerts()).toContain("先恢复");
  expect(button("重新加载插件").disabled).toBe(true);
  expect(button("恢复未完成更新").disabled).toBe(false);
  expect(downloadBrowserRelease).not.toHaveBeenCalled();
});

test("another page holding the update lock prevents reload until an explicit later retry", async () => {
  await mountUpdates();
  withBrowserUpdateLock.mockRejectedValueOnce(new Error("另一个插件页面正在更新，请等待它完成。"));
  await click("重新加载插件");
  expect(alerts()).toContain("另一个插件页面正在更新");
  expect(browser.runtime.reload).not.toHaveBeenCalled();
  expect(withBrowserUpdateLock).toHaveBeenCalledTimes(1);
  await click("重新加载插件");
  expect(withBrowserUpdateLock).toHaveBeenCalledTimes(2);
  expect(browser.runtime.reload).toHaveBeenCalledTimes(1);
});

test("refused directory permission is visible and prevents any download or install", async () => {
  requestUpdateDirectoryPermission.mockRejectedValue(new Error("未获得安装目录写入权限；没有更新文件。"));
  await readyToUpdate();
  await click("下载并更新");
  expect(alerts()).toContain("未获得安装目录写入权限");
  expect(withBrowserUpdateLock).not.toHaveBeenCalled();
  expect(readInstalledUpdateManifest).not.toHaveBeenCalled();
  expect(downloadBrowserRelease).not.toHaveBeenCalled();
  expect(installBrowserUpdate).not.toHaveBeenCalled();
  expect(browser.runtime.reload).not.toHaveBeenCalled();
});

test("failed installation preserves a recovery-only UI until a successful restore", async () => {
  installBrowserUpdate.mockImplementation(async () => {
    state.backup = backup("recovering");
    throw new Error("文件写入失败，原版恢复尚未完成");
  });
  await readyToUpdate();
  await click("下载并更新");
  expect(alerts()).toContain("文件写入失败");
  expect(button("下载并更新").disabled).toBe(true);
  expect(button("重新选择安装目录").disabled).toBe(true);
  expect(button("重新加载插件").disabled).toBe(true);
  expect(browser.runtime.reload).not.toHaveBeenCalled();
  await click("恢复未完成更新");
  expect(restoreBrowserUpdate).toHaveBeenCalledTimes(1);
  expect(button("重新加载插件").disabled).toBe(false);
});

test("download cancellation aborts the same signal, does not install, and permits an explicit retry", async () => {
  abortableDownload();
  await readyToUpdate();
  await click("下载并更新");
  const signal = downloadBrowserRelease.mock.calls[0][1].signal;
  expect(signal.aborted).toBe(false);
  await click("取消");
  expect(signal.aborted).toBe(true);
  expect(alerts()).toContain("已取消");
  expect(installBrowserUpdate).not.toHaveBeenCalled();
  expect(button("下载并更新").disabled).toBe(false);
  expect(downloadBrowserRelease).toHaveBeenCalledTimes(1);
  downloadBrowserRelease.mockResolvedValueOnce(downloaded);
  await click("下载并更新");
  expect(downloadBrowserRelease).toHaveBeenCalledTimes(2);
  expect(downloadBrowserRelease.mock.calls[1][1].signal).not.toBe(signal);
  expect(installBrowserUpdate).toHaveBeenCalledTimes(1);
});

test("two clicks before React commits cannot start duplicate checks or downloads", async () => {
  const checking = deferred();
  checkBrowserRelease.mockReturnValueOnce(checking.promise);
  await mountUpdates();
  await act(async () => {
    const check = button("检查更新");
    check.click();
    check.click();
  });
  expect(checkBrowserRelease).toHaveBeenCalledTimes(1);
  await act(async () => checking.resolve(newest));
  abortableDownload();
  await act(async () => {
    const update = button("下载并更新");
    update.click();
    update.click();
  });
  expect(requestUpdateDirectoryPermission).toHaveBeenCalledTimes(1);
  expect(downloadBrowserRelease).toHaveBeenCalledTimes(1);
  await click("取消");
});

test("unmount aborts a pending download and removes the operation's unload guard", async () => {
  abortableDownload();
  await readyToUpdate();
  await click("下载并更新");
  const signal = downloadBrowserRelease.mock.calls[0][1].signal;
  const during = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(during);
  expect(during.defaultPrevented).toBe(true);
  await act(async () => root.unmount());
  root = null;
  expect(signal.aborted).toBe(true);
  expect(installBrowserUpdate).not.toHaveBeenCalled();
  expect(browser.runtime.reload).not.toHaveBeenCalled();
  const after = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(after);
  expect(after.defaultPrevented).toBe(false);
});
