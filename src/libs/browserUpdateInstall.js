import { browser } from "./browser";
import {
  compareLearningVersions,
  MAX_UPDATE_BYTES,
  updateSha256,
  validateUpdateManifest,
} from "./browserUpdateRelease";

const CONNECTION = "connection";
const BACKUP = "backup";
const MAX_FILES = 2000;
const MAX_FILE = 16 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

export function updatePathParts(path) {
  if (
    typeof path !== "string" ||
    !path ||
    path.length > 600 ||
    path.includes("\\")
  )
    throw new Error("更新文件路径无效。");
  const parts = path.split("/");
  if (
    parts.some(
      (part) =>
        !part ||
        [".", ".."].includes(part) ||
        [...part].some(
          (char) =>
            char === ":" ||
            char.charCodeAt(0) <= 31 ||
            char.charCodeAt(0) === 127
        ) ||
        /[. ]$/.test(part) ||
        reserved.test(part)
    )
  )
    throw new Error("更新文件路径不安全。");
  return parts;
}

export async function getBrowserUpdateSupport(api = browser) {
  if (
    globalThis.location?.protocol !== "chrome-extension:" ||
    !api?.management?.getSelf
  ) {
    return {
      supported: false,
      reason: "请从 Chrome 已安装的学习版插件中打开此页。",
    };
  }
  const self = await api.management.getSelf();
  if (self.installType !== "development")
    return {
      supported: false,
      reason: "此入口仅用于加载已解压的学习版；商店安装版请使用商店更新。",
    };
  if (
    !globalThis.showDirectoryPicker ||
    !globalThis.navigator?.locks ||
    !globalThis.indexedDB ||
    !globalThis.DecompressionStream
  ) {
    return {
      supported: false,
      reason:
        "此 Chrome 不支持所需的文件授权、解压或存储能力，请升级 Chrome 或使用本地更新工具。",
    };
  }
  return { supported: true, current: api.runtime.getManifest().version_name };
}

export async function requestUpdateDirectoryPermission(directory) {
  if ((await directory.queryPermission({ mode: "readwrite" })) === "granted")
    return;
  if ((await directory.requestPermission({ mode: "readwrite" })) !== "granted")
    throw new Error("未获得安装目录写入权限；没有更新文件。");
}

async function parentFor(root, path, create = false) {
  const parts = updatePathParts(path);
  let parent = root;
  for (const part of parts.slice(0, -1))
    parent = await parent.getDirectoryHandle(part, { create });
  return [parent, parts[parts.length - 1]];
}

export async function readUpdateFile(root, path) {
  try {
    const [parent, name] = await parentFor(root, path);
    const file = await (await parent.getFileHandle(name)).getFile();
    if (file.size > MAX_FILE)
      throw new Error("安装目录中的文件超过更新备份上限。");
    return new Uint8Array(await file.arrayBuffer());
  } catch (error) {
    if (error.name === "NotFoundError") return null;
    throw error;
  }
}

async function writeUpdateFile(root, path, bytes) {
  if (bytes === null) {
    try {
      const [parent, name] = await parentFor(root, path);
      await parent.removeEntry(name);
    } catch (error) {
      if (error.name !== "NotFoundError") throw error;
    }
    return;
  }
  const [parent, name] = await parentFor(root, path, true);
  const file = await parent.getFileHandle(name, { create: true });
  const writer = await file.createWritable();
  try {
    await writer.write(bytes);
    await writer.close();
  } catch (error) {
    await writer.abort().catch(() => {});
    throw error;
  }
}

export async function readInstalledUpdateManifest(directory) {
  const bytes = await readUpdateFile(directory, "manifest.json");
  if (!bytes || bytes.length > 65536)
    throw new Error("请选择包含 manifest.json 的已安装 chrome 文件夹。");
  return validateUpdateManifest(JSON.parse(decoder.decode(bytes)));
}

// A copy can have the same name/version. Prove the chosen folder is actually
// served by this extension before touching package files; the probe is plain text.
export async function verifyUpdateDirectory(
  directory,
  api = browser,
  fetcher = globalThis.fetch
) {
  await readInstalledUpdateManifest(directory);
  const nonce = globalThis.crypto.randomUUID();
  const name = `.kiss-directory-check-${nonce}.txt`;
  const bytes = encoder.encode(nonce);
  try {
    await writeUpdateFile(directory, name, bytes);
    const response = await fetcher(api.runtime.getURL(name), {
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
    });
    if (
      !response.ok ||
      response.headers.get("content-length") > 256 ||
      (await response.text()) !== nonce
    ) {
      throw new Error("所选文件夹不是 Chrome 当前加载的目录。");
    }
  } catch {
    throw new Error(
      "无法确认安装目录。请选择 Chrome 当前加载的 chrome 文件夹，不能选择同版本副本。"
    );
  } finally {
    await writeUpdateFile(directory, name, null);
  }
}

export function withBrowserUpdateLock(
  task,
  locks = globalThis.navigator?.locks
) {
  if (!locks) throw new Error("无法取得浏览器更新锁，请升级 Chrome。");
  return locks.request(
    "kiss-learning-file-update",
    { mode: "exclusive", ifAvailable: true },
    (lock) => {
      if (!lock) throw new Error("另一个插件页面正在更新，请等待它完成。");
      return task();
    }
  );
}

export async function connectUpdateDirectory(
  directory,
  store,
  verify = verifyUpdateDirectory
) {
  const existing = await store.get(BACKUP);
  if (existing?.phase === "writing" || existing?.phase === "recovering")
    throw new Error("请先恢复上次未完成更新，不能切换安装目录。");
  await verify(directory);
  const previous = await store.get(CONNECTION);
  const same =
    previous?.directory && (await directory.isSameEntry(previous.directory));
  await store.set(CONNECTION, {
    directory,
    managed: same ? previous.managed || [] : [],
  });
  if (!same) await store.remove(BACKUP);
  return readInstalledUpdateManifest(directory);
}

const fileOrder = (paths) =>
  paths.sort((a, b) => {
    const order = (name) =>
      ({ "options.js": 1, "options.html": 2, "manifest.json": 3 })[name] || 0;
    return order(a) - order(b) || a.localeCompare(b);
  });
const stopped = (signal) => {
  if (signal?.aborted) throw new DOMException("更新已取消", "AbortError");
};
const hashOrNull = (bytes) =>
  bytes === null ? Promise.resolve(null) : updateSha256(bytes);

async function verifyBackupRecord(record) {
  if (
    !record ||
    record.schema !== 1 ||
    !["writing", "ready", "recovering", "restored"].includes(record.phase) ||
    !Array.isArray(record.entries) ||
    record.entries.length > MAX_FILES ||
    !record.directory
  )
    throw new Error("恢复记录无效，已停止写入。");
  validateUpdateManifest(record.beforeManifest);
  validateUpdateManifest(record.afterManifest);
  const paths = new Set();
  let total = 0;
  for (const entry of record.entries) {
    updatePathParts(entry.path);
    const key = entry.path.normalize("NFC").toLowerCase();
    if (
      paths.has(key) ||
      (entry.before !== null && !(entry.before instanceof Uint8Array))
    )
      throw new Error("恢复记录的文件列表无效。");
    paths.add(key);
    total += entry.before?.length || 0;
    if (
      (entry.before?.length || 0) > MAX_FILE ||
      total > MAX_UPDATE_BYTES ||
      (await hashOrNull(entry.before)) !== entry.beforeHash ||
      (entry.afterHash !== null && !/^[a-f0-9]{64}$/.test(entry.afterHash))
    )
      throw new Error("恢复备份校验失败。");
  }
}

export async function restoreBrowserUpdate(
  store,
  { onProgress = () => {}, verify = verifyUpdateDirectory } = {}
) {
  const record = await store.get(BACKUP);
  await verifyBackupRecord(record);
  await verify(record.directory);
  // Validate every current file before restoring any, preserving external edits.
  const emptyHash = await updateSha256(new Uint8Array());
  for (const entry of record.entries) {
    const current = await hashOrNull(
      await readUpdateFile(record.directory, entry.path)
    );
    if (
      ![entry.beforeHash, entry.afterHash].includes(current) &&
      !(entry.before === null && current === emptyHash)
    ) {
      throw new Error(
        `文件 ${entry.path} 已被其他程序修改，已停止恢复并保留备份。`
      );
    }
  }
  record.phase = "recovering";
  await store.set(BACKUP, record);
  const ordered = fileOrder(record.entries.map((entry) => entry.path));
  const entries = new Map(record.entries.map((entry) => [entry.path, entry]));
  for (let index = 0; index < ordered.length; index++) {
    const path = ordered[index];
    onProgress({
      phase: "restore",
      completed: index,
      total: ordered.length,
      path,
    });
    const entry = entries.get(path);
    const current = await hashOrNull(
      await readUpdateFile(record.directory, path)
    );
    if (
      ![entry.beforeHash, entry.afterHash].includes(current) &&
      !(entry.before === null && current === emptyHash)
    ) {
      throw new Error(`文件 ${path} 在恢复过程中被修改，已停止并保留备份。`);
    }
    await writeUpdateFile(record.directory, path, entry.before);
  }
  await store.set(CONNECTION, {
    directory: record.directory,
    managed: record.previousManaged,
  });
  record.phase = "restored";
  await store.set(BACKUP, record);
  return record.beforeManifest;
}

export async function installBrowserUpdate(
  directory,
  download,
  store,
  { signal, onProgress = () => {}, verify = verifyUpdateDirectory } = {}
) {
  const unfinished = await store.get(BACKUP);
  if (["writing", "recovering"].includes(unfinished?.phase))
    throw new Error("请先恢复上次未完成更新。");
  await verify(directory);
  const beforeManifest = await readInstalledUpdateManifest(directory);
  const afterManifest = validateUpdateManifest(download.manifest);
  if (beforeManifest.key !== afterManifest.key)
    throw new Error("新版的扩展身份发生变化，自动更新已拒绝。");
  if (
    compareLearningVersions(
      afterManifest.version_name,
      beforeManifest.version_name
    ) <= 0
  )
    throw new Error("目录已是相同或更高版本，请直接重新加载插件。");
  const connection = await store.get(CONNECTION);
  if (
    !connection?.directory ||
    !(await directory.isSameEntry(connection.directory))
  )
    throw new Error("安装目录与授权记录不一致。");
  const files = download.files;
  if (!(files instanceof Map) || files.size === 0 || files.size > MAX_FILES)
    throw new Error("安装文件列表无效。");
  const manifestBytes = files.get("manifest.json");
  if (
    !manifestBytes ||
    JSON.stringify(JSON.parse(decoder.decode(manifestBytes))) !==
      JSON.stringify(afterManifest)
  ) {
    throw new Error("下载清单与待写入文件不一致。");
  }
  const previousManaged = Array.isArray(connection.managed)
    ? connection.managed
    : [];
  const allPaths = new Set([...files.keys(), ...previousManaged]);
  if (allPaths.size > MAX_FILES) throw new Error("更新路径数量超过上限。");
  const entries = [];
  let backupSize = 0;
  let nextSize = 0;
  for (const path of fileOrder([...allPaths])) {
    stopped(signal);
    updatePathParts(path);
    const after = files.get(path) ?? null;
    if (
      after !== null &&
      (!(after instanceof Uint8Array) || after.length > MAX_FILE)
    )
      throw new Error("更新文件大小无效。");
    nextSize += after?.length || 0;
    const before = await readUpdateFile(directory, path);
    backupSize += before?.length || 0;
    if (backupSize > MAX_UPDATE_BYTES || nextSize > MAX_UPDATE_BYTES)
      throw new Error("更新或备份超过 64 MiB 上限。");
    entries.push({
      path,
      before,
      beforeHash: await hashOrNull(before),
      afterHash: await hashOrNull(after),
    });
    onProgress({
      phase: "backup",
      completed: entries.length,
      total: allPaths.size,
      path,
    });
  }
  stopped(signal);
  const record = {
    schema: 1,
    phase: "writing",
    directory,
    beforeManifest,
    afterManifest,
    previousManaged,
    entries,
  };
  await verifyBackupRecord(record);
  await store.set(BACKUP, record); // Durable backup is committed before the first package write.
  try {
    for (let index = 0; index < entries.length; index++) {
      stopped(signal);
      const entry = entries[index];
      onProgress({
        phase: "write",
        completed: index,
        total: entries.length,
        path: entry.path,
      });
      if (
        (await hashOrNull(await readUpdateFile(directory, entry.path))) !==
        entry.beforeHash
      )
        throw new Error("安装文件在更新时发生变化，已停止写入。");
      await writeUpdateFile(
        directory,
        entry.path,
        files.get(entry.path) ?? null
      );
    }
    stopped(signal);
    // Keep the recovery gate closed until managed paths are durable too.
    await store.set(CONNECTION, { directory, managed: [...files.keys()] });
    stopped(signal);
    record.phase = "ready";
    await store.set(BACKUP, record);
    return afterManifest;
  } catch (error) {
    try {
      await restoreBrowserUpdate(store, { onProgress, verify });
    } catch (recoveryError) {
      throw new Error(
        `更新中断，自动恢复未完成：${recoveryError.message}。请保留此页面和备份，恢复后再使用插件。`
      );
    }
    throw new Error(`更新未完成，已经恢复原版：${error.message}`);
  }
}

export async function readBrowserUpdateState(store) {
  const [connection, backup] = await Promise.all([
    store.get(CONNECTION),
    store.get(BACKUP),
  ]);
  return { connection, backup };
}
