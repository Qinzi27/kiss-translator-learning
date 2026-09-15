// A deliberately small ZIP32 subset for our release packager. This module
// returns bytes only: it never fetches, writes files, imports, or executes them.
export const BROWSER_UPDATE_ZIP_LIMITS = Object.freeze({
  archiveBytes: 32 * 1024 * 1024,
  expandedBytes: 64 * 1024 * 1024,
  fileBytes: 16 * 1024 * 1024,
  entries: 2000,
  centralBytes: 2 * 1024 * 1024,
  milliseconds: 180000,
});

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let value = i;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC_TABLE[i] = value >>> 0;
}

const fail = (message) => {
  throw new Error(`更新 ZIP 无法安全读取：${message}`);
};
const abortError = () => {
  const error = new Error("更新包读取已取消");
  error.name = "AbortError";
  return error;
};

function lifetime(signal) {
  let failure;
  let rejectInterrupted;
  const end = Date.now() + BROWSER_UPDATE_ZIP_LIMITS.milliseconds;
  const interrupted = new Promise((_, reject) => {
    rejectInterrupted = reject;
  });
  // An abort may happen while synchronous validation is running.
  interrupted.catch(() => {});
  const stop = (error) => {
    if (!failure) {
      failure = error;
      rejectInterrupted(error);
    }
  };
  const onAbort = () => stop(abortError());
  const onTimeout = () => stop(new Error("更新包读取超过 180 秒，已停止"));
  const timer = setTimeout(onTimeout, BROWSER_UPDATE_ZIP_LIMITS.milliseconds);
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  return {
    check() {
      if (!failure && Date.now() >= end) onTimeout();
      if (failure) throw failure;
    },
    wait(promise) {
      return Promise.race([promise, interrupted]);
    },
    async yield() {
      this.check();
      await this.wait(new Promise((resolve) => setTimeout(resolve, 0)));
      this.check();
    },
    close() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

function canonical(path) {
  // Upper/lower also collapses multi-character case mappings, such as ß/SS.
  return path.normalize("NFC").toUpperCase().toLowerCase().normalize("NFC");
}

function pathParts(name) {
  if (
    !name ||
    name.length > 600 ||
    /[\\:"<>|?*]/u.test(name) ||
    Array.from(name).some((char) => {
      const value = char.charCodeAt(0);
      return value <= 31 || (value >= 127 && value <= 159) || value === 0xfeff;
    })
  ) {
    fail("文件路径含不支持的字符");
  }
  const parts = (name.endsWith("/") ? name.slice(0, -1) : name).split("/");
  if (
    parts.length > 32 ||
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        part.length > 240 ||
        /[. ]$/u.test(part) ||
        /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(part)
    )
  )
    fail("文件路径穿越、过深或包含保留名称");
  return parts;
}

function extraFields(bytes, view, start, length) {
  const end = start + length;
  while (start < end) {
    if (end - start < 4) fail("附加字段不完整");
    const id = view.getUint16(start, true);
    const size = view.getUint16(start + 2, true);
    start += 4;
    if (start + size > end || end > bytes.length) fail("附加字段越界");
    if (id === 1 || id === 0x9901 || id === 0x7075) {
      fail("不支持 ZIP64、加密或替代文件名字段");
    }
    start += size;
  }
}

async function inspect(bytes, guard) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) fail("缺少 ZIP 目录结尾");
  const count = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const centralStart = view.getUint32(end + 16, true);
  if (
    view.getUint16(end + 4, true) ||
    view.getUint16(end + 6, true) ||
    count !== view.getUint16(end + 8, true) ||
    !count ||
    count > BROWSER_UPDATE_ZIP_LIMITS.entries ||
    centralSize > BROWSER_UPDATE_ZIP_LIMITS.centralBytes ||
    centralStart + centralSize !== end ||
    end + 22 + view.getUint16(end + 20, true) !== bytes.length
  )
    fail("目录数量、位置或大小无效；不支持分卷及 ZIP64");

  const entries = [];
  const names = new Set();
  const tree = new Map();
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let cursor = centralStart;
  let expanded = 0;
  while (cursor < end) {
    guard.check();
    if (
      entries.length >= count ||
      cursor + 46 > end ||
      view.getUint32(cursor, true) !== 0x02014b50
    ) {
      fail("中央目录记录不完整或数量不符");
    }
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressed = view.getUint32(cursor + 20, true);
    const size = view.getUint32(cursor + 24, true);
    const nameSize = view.getUint16(cursor + 28, true);
    const extraSize = view.getUint16(cursor + 30, true);
    const recordEnd =
      cursor + 46 + nameSize + extraSize + view.getUint16(cursor + 32, true);
    const offset = view.getUint32(cursor + 42, true);
    const version = view.getUint16(cursor + 6, true);
    if (
      flags & ~0x800 ||
      (method !== 0 && method !== 8) ||
      version > 20 ||
      view.getUint16(cursor + 34, true) ||
      !nameSize ||
      nameSize > 2400 ||
      recordEnd > end ||
      offset + 30 > centralStart ||
      compressed > BROWSER_UPDATE_ZIP_LIMITS.archiveBytes ||
      size > BROWSER_UPDATE_ZIP_LIMITS.fileBytes ||
      (method === 0 && size !== compressed)
    )
      fail("条目格式或大小无效；只支持无加密、无数据描述符的 STORE/DEFLATE");
    expanded += size;
    if (expanded > BROWSER_UPDATE_ZIP_LIMITS.expandedBytes)
      fail("展开总大小超过 64 MiB");
    const rawName = bytes.subarray(cursor + 46, cursor + 46 + nameSize);
    if (!(flags & 0x800) && rawName.some((byte) => byte > 127))
      fail("文件名必须是 UTF-8 或 ASCII");
    let name;
    try {
      name = decoder.decode(rawName);
    } catch {
      fail("UTF-8 文件名无效");
    }
    const parts = pathParts(name);
    const directory = name.endsWith("/");
    const attributes = view.getUint32(cursor + 38, true);
    const kind = (attributes >>> 16) & 0xf000;
    if (
      ![0, 0x4000, 0x8000].includes(kind) ||
      (kind === 0x4000 && !directory) ||
      (kind === 0x8000 && directory) ||
      (directory && size !== 0) ||
      (attributes & 0x10 && !directory)
    )
      fail("不支持符号链接、特殊文件或不一致的目录类型");
    const normalized = canonical(parts.join("/"));
    if (names.has(normalized)) fail("文件名重复或大小写／Unicode 冲突");
    names.add(normalized);
    for (let i = 1; i <= parts.length; i++) {
      const path = parts.slice(0, i).join("/");
      const key = canonical(path);
      const isDirectory = i < parts.length || directory;
      const previous = tree.get(key);
      if (
        previous &&
        (previous.path !== path || previous.directory !== isDirectory)
      ) {
        fail("父路径存在文件或名称冲突");
      }
      tree.set(key, { path, directory: isDirectory });
    }
    extraFields(bytes, view, cursor + 46 + nameSize, extraSize);
    if (view.getUint32(offset, true) !== 0x04034b50) fail("本地文件头无效");
    // Version, flags, compression, timestamps, CRC and both lengths must agree.
    for (const [local, central, width] of [
      [4, 6, 2],
      [6, 8, 2],
      [8, 10, 2],
      [10, 12, 2],
      [12, 14, 2],
      [14, 16, 4],
      [18, 20, 4],
      [22, 24, 4],
      [26, 28, 2],
    ]) {
      const get = width === 2 ? "getUint16" : "getUint32";
      if (view[get](offset + local, true) !== view[get](cursor + central, true))
        fail("本地头与中央目录不一致");
    }
    const localExtra = view.getUint16(offset + 28, true);
    const dataStart = offset + 30 + nameSize + localExtra;
    const dataEnd = dataStart + compressed;
    if (dataEnd > centralStart) fail("本地文件数据越界");
    for (let i = 0; i < nameSize; i++) {
      if (bytes[offset + 30 + i] !== rawName[i])
        fail("本地文件名与中央目录不一致");
    }
    extraFields(bytes, view, offset + 30 + nameSize, localExtra);
    entries.push({
      name,
      parts,
      directory,
      method,
      size,
      offset,
      dataStart,
      dataEnd,
      crc: view.getUint32(cursor + 16, true),
    });
    cursor = recordEnd;
    if (entries.length % 32 === 0) await guard.yield();
  }
  if (entries.length !== count) fail("中央目录条目数量不符");
  let localEnd = 0;
  for (const entry of [...entries].sort((a, b) => a.offset - b.offset)) {
    if (entry.offset !== localEnd) fail("文件数据重叠、存在间隙或自解压前缀");
    localEnd = entry.dataEnd;
  }
  if (localEnd !== centralStart) fail("本地数据与中央目录边界不符");
  return entries;
}

async function unpackEntry(bytes, entry, keep, guard) {
  const output = keep ? new Uint8Array(entry.size) : null;
  let position = 0;
  let crc = 0xffffffff;
  let blocks = 0;
  const consume = async (chunk) => {
    if (
      !(chunk instanceof Uint8Array) ||
      position + chunk.length > entry.size
    ) {
      fail("实际解压大小超过声明或上限");
    }
    for (let start = 0; start < chunk.length; start += 65536) {
      guard.check();
      const part = chunk.subarray(start, start + 65536);
      if (output) output.set(part, position);
      for (let i = 0; i < part.length; i++)
        crc = CRC_TABLE[(crc ^ part[i]) & 255] ^ (crc >>> 8);
      position += part.length;
      if (++blocks % 8 === 0) await guard.yield();
    }
  };
  if (entry.method === 0) {
    for (
      let offset = entry.dataStart;
      offset < entry.dataEnd;
      offset += 65536
    ) {
      await consume(
        bytes.subarray(offset, Math.min(offset + 65536, entry.dataEnd))
      );
    }
  } else {
    if (
      typeof DecompressionStream !== "function" ||
      typeof ReadableStream !== "function"
    ) {
      fail("当前浏览器不支持原生 DEFLATE 解压");
    }
    let offset = entry.dataStart;
    const compressed = new ReadableStream({
      pull(controller) {
        guard.check();
        if (offset === entry.dataEnd) return controller.close();
        const next = Math.min(offset + 65536, entry.dataEnd);
        controller.enqueue(bytes.subarray(offset, next));
        offset = next;
      },
    });
    let decoder;
    try {
      decoder = new DecompressionStream("deflate-raw");
    } catch {
      fail("当前浏览器不支持 deflate-raw 解压");
    }
    const reader = compressed.pipeThrough(decoder).getReader();
    let complete = false;
    try {
      while (true) {
        guard.check();
        const { done, value } = await guard.wait(reader.read());
        if (done) {
          complete = true;
          break;
        }
        await consume(value);
      }
    } finally {
      // Cancellation must not wait for a misbehaving decoder to acknowledge it.
      if (!complete) {
        try {
          Promise.resolve(reader.cancel()).catch(() => {});
        } catch {
          /* already closed */
        }
      }
      try {
        reader.releaseLock();
      } catch {
        /* a pending read may still settle */
      }
    }
  }
  if (position !== entry.size || (crc ^ 0xffffffff) >>> 0 !== entry.crc)
    fail("解压长度或 CRC32 校验失败");
  return output;
}

export async function unpackChromeRelease(
  zipBytes,
  { signal, onProgress } = {}
) {
  const guard = lifetime(signal);
  try {
    guard.check();
    const input =
      zipBytes instanceof ArrayBuffer ? new Uint8Array(zipBytes) : zipBytes;
    if (
      !(input instanceof Uint8Array) ||
      input.length < 22 ||
      input.length > BROWSER_UPDATE_ZIP_LIMITS.archiveBytes
    ) {
      fail("压缩包为空或超过 32 MiB");
    }
    // Own a bounded snapshot so callers cannot change validated headers mid-read.
    const bytes = new Uint8Array(input);
    const entries = await inspect(bytes, guard);
    const result = new Map();
    for (let i = 0; i < entries.length; i++) {
      guard.check();
      const entry = entries[i];
      const keep =
        !entry.directory &&
        entry.parts[0] === "chrome" &&
        entry.parts.length > 1;
      const data = await unpackEntry(bytes, entry, keep, guard);
      if (keep) result.set(entry.parts.slice(1).join("/"), data);
      onProgress?.({
        phase: "unpack",
        completed: i + 1,
        total: entries.length,
        path: entry.name,
      });
      if ((i + 1) % 8 === 0) await guard.yield();
    }
    guard.check();
    if (!result.size) fail("压缩包没有 chrome/ 扩展文件");
    return result;
  } finally {
    guard.close();
  }
}
