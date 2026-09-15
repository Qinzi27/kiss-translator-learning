import { applyNetworkPolicy, resolveNetworkPolicy } from "./networkPolicy";
import { unpackChromeRelease } from "./browserUpdateZip";

export const UPDATE_REPOSITORY = "Qinzi27/kiss-translator-learning";
export const UPDATE_HOME = `https://github.com/${UPDATE_REPOSITORY}`;
export const UPDATE_API = `https://api.github.com/repos/${UPDATE_REPOSITORY}/releases`;
export const UPDATE_ZIP = "kiss-translator-learning-chrome.zip";
export const UPDATE_SOURCE = "kiss-translator-learning-source.zip";
const RECEIPT = "release-manifest.json";
const SUMS = "SHA256SUMS.txt";
const ASSETS = [UPDATE_ZIP, UPDATE_SOURCE, RECEIPT, SUMS];
export const MAX_UPDATE_BYTES = 64 * 1024 * 1024;
const MAX_ZIP_BYTES = 32 * 1024 * 1024;
const MAX_METADATA = 2 * 1024 * 1024;
const VERSION =
  /^v?(\d{1,5})\.(\d{1,5})\.(\d{1,5})(?:\.(\d{1,5}))?-learning\.(\d{1,8})$/;

export function learningVersion(value) {
  const parts = typeof value === "string" && value.match(VERSION);
  if (!parts || parts.slice(1, 5).some((part) => Number(part || 0) > 65535)) {
    throw new Error("这不是有效的学习版版本号。");
  }
  return parts.slice(1).map((part) => Number(part || 0));
}

export function compareLearningVersions(a, b) {
  const left = learningVersion(a);
  const right = learningVersion(b);
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return Math.sign(left[i] - right[i]);
  }
  return 0;
}

export async function updateSha256(bytes) {
  const result = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(result), (value) =>
    value.toString(16).padStart(2, "0")
  ).join("");
}

export function releaseAssetUrl(tag, name) {
  learningVersion(tag);
  if (!tag.startsWith("v") || !ASSETS.includes(name))
    throw new Error("发布附件地址无效。");
  return `${UPDATE_HOME}/releases/download/${tag}/${name}`;
}

export function selectBrowserRelease(releases) {
  let selected;
  for (const item of releases) {
    try {
      if (
        !item ||
        item.draft !== false ||
        typeof item.tag_name !== "string" ||
        !item.tag_name.startsWith("v")
      )
        continue;
      learningVersion(item.tag_name);
      const assets = Object.create(null);
      if (!Array.isArray(item.assets)) continue;
      for (const asset of item.assets) {
        if (!ASSETS.includes(asset?.name)) continue;
        if (
          assets[asset.name] ||
          asset.state !== "uploaded" ||
          !Number.isSafeInteger(asset.size) ||
          asset.size <= 0 ||
          asset.size > MAX_UPDATE_BYTES ||
          (asset.name === UPDATE_ZIP && asset.size > MAX_ZIP_BYTES) ||
          ([RECEIPT, SUMS].includes(asset.name) && asset.size > MAX_METADATA) ||
          asset.browser_download_url !==
            releaseAssetUrl(item.tag_name, asset.name) ||
          (asset.digest != null && !/^sha256:[0-9a-f]{64}$/.test(asset.digest))
        )
          throw new Error("附件记录无效");
        assets[asset.name] = {
          name: asset.name,
          size: asset.size,
          digest: asset.digest || null,
        };
      }
      if (!ASSETS.every((name) => assets[name])) continue;
      if (
        !selected ||
        compareLearningVersions(item.tag_name, selected.tag) > 0
      ) {
        selected = {
          tag: item.tag_name,
          version: item.tag_name.slice(1),
          prerelease: item.prerelease === true,
          assets,
        };
      }
    } catch {
      /* Ignore incomplete or malformed releases; never downgrade. */
    }
  }
  if (!selected) throw new Error("暂未找到附件齐全的学习版发布，请稍后再试。");
  return selected;
}

function validateFinalAssetUrl(url, requested) {
  if (url === requested) return true;
  const parsed = new URL(url);
  return (
    parsed.protocol === "https:" &&
    !parsed.username &&
    !parsed.password &&
    !parsed.port &&
    !parsed.hash &&
    [
      "release-assets.githubusercontent.com",
      "objects.githubusercontent.com",
    ].includes(parsed.hostname) &&
    /^\/github-production-release-asset\/\d+\/[a-f0-9-]+$/i.test(
      parsed.pathname
    )
  );
}

function abortable(promise, signal) {
  const pending = Promise.resolve(promise);
  if (signal.aborted) {
    pending.catch(() => {});
    return Promise.reject(new DOMException("更新已取消或超时", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(new DOMException("更新已取消或超时", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    pending.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      }
    );
  });
}

async function readLimitedResponse(response, maximum, signal, expectedSize) {
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) ||
      Number(declared) > maximum ||
      (expectedSize != null && Number(declared) !== expectedSize))
  )
    throw new Error("下载文件长度与发布记录不符。");
  if (!response.body?.getReader)
    throw new Error("浏览器不支持有界下载，请更新 Chrome。");
  const reader = response.body.getReader();
  // Fixed allocation also bounds overhead for a server emitting tiny chunks.
  const bytes = new Uint8Array(expectedSize ?? maximum);
  let size = 0;
  let chunks = 0;
  try {
    for (;;) {
      if (signal.aborted) throw new DOMException("更新已取消", "AbortError");
      const { value, done } = await abortable(reader.read(), signal);
      if (done) break;
      if (
        !(value instanceof Uint8Array) ||
        size + value.byteLength > bytes.length
      )
        throw new Error("下载超过大小上限。");
      bytes.set(value, size);
      size += value.byteLength;
      // Yield even for empty/tiny synchronous chunks so abort/deadline can run.
      if (++chunks % 256 === 0)
        await abortable(
          new Promise((resolve) => setTimeout(resolve, 0)),
          signal
        );
    }
    if (expectedSize != null && size !== expectedSize)
      throw new Error("下载未完成，请稍后重试。");
    return size === bytes.length ? bytes : bytes.slice(0, size);
  } finally {
    // A broken stream must not keep cancellation pending forever.
    Promise.resolve(reader.cancel()).catch(() => {});
  }
}

// Narrow exception for public release GETs: GitHub redirects assets to its CDN.
// No credentials, referrer, arbitrary request options or user-provided URLs.
// Translation/API traffic continues to use policyFetch with redirect:"error".
async function readReleaseUrl(
  url,
  { signal, maximum, expectedSize, asset = false }
) {
  const policy = await resolveNetworkPolicy();
  applyNetworkPolicy(url, {}, policy); // Offline policy rejects before any request.
  const response = await fetch(url, {
    method: "GET",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    cache: "no-store",
    redirect: asset ? "follow" : "error",
    signal,
    headers: {
      Accept: asset
        ? "application/octet-stream"
        : "application/vnd.github+json",
    },
  });
  if (!response.ok) {
    Promise.resolve(response.body?.cancel?.()).catch(() => {});
    throw new Error(
      [403, 429].includes(response.status)
        ? "GitHub 访问额度暂时受限，请稍后再试。"
        : `发布下载失败（${response.status}）。`
    );
  }
  if (
    asset ? !validateFinalAssetUrl(response.url, url) : response.url !== url
  ) {
    Promise.resolve(response.body?.cancel?.()).catch(() => {});
    throw new Error("下载地址离开了固定 GitHub 发布来源。");
  }
  applyNetworkPolicy(response.url, {}, policy);
  return readLimitedResponse(response, maximum, signal, expectedSize);
}

async function withUpdateDeadline(signal, task) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 180000);
  try {
    if (controller.signal.aborted)
      throw new DOMException("更新已取消", "AbortError");
    return await abortable(task(controller.signal), controller.signal);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    controller.abort();
  }
}

export async function checkBrowserRelease({ signal } = {}) {
  return withUpdateDeadline(signal, async (boundedSignal) => {
    const all = [];
    for (let page = 1; page <= 3; page++) {
      const bytes = await readReleaseUrl(
        `${UPDATE_API}?per_page=100&page=${page}`,
        { signal: boundedSignal, maximum: MAX_METADATA }
      );
      const data = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes)
      );
      if (!Array.isArray(data)) throw new Error("发布列表格式无效。");
      all.push(...data);
      if (data.length < 100) break;
    }
    return selectBrowserRelease(all);
  });
}

export function validateUpdateManifest(manifest) {
  if (
    !manifest ||
    manifest.manifest_version !== 3 ||
    manifest.homepage_url !== UPDATE_HOME ||
    manifest.background?.service_worker !== "background.js"
  )
    throw new Error("该目录不是本项目的 Chrome 学习版。");
  learningVersion(manifest.version_name);
  if (manifest.version !== manifest.version_name.split("-learning.")[0])
    throw new Error("扩展版本字段不一致。");
  return manifest;
}

export async function downloadBrowserRelease(
  release,
  { signal, onProgress = () => {} } = {}
) {
  return withUpdateDeadline(signal, async (boundedSignal) => {
    // Revalidate the exact release shape rather than trusting cached UI state.
    const selected = selectBrowserRelease([
      {
        draft: false,
        tag_name: release.tag,
        prerelease: release.prerelease,
        assets: ASSETS.map((name) => ({
          ...release.assets[name],
          state: "uploaded",
          browser_download_url: releaseAssetUrl(release.tag, name),
        })),
      },
    ]);
    const downloaded = new Map();
    for (const name of [SUMS, RECEIPT, UPDATE_ZIP]) {
      onProgress({ phase: "download", path: name });
      const asset = selected.assets[name];
      const bytes = await readReleaseUrl(releaseAssetUrl(selected.tag, name), {
        signal: boundedSignal,
        asset: true,
        maximum: name === UPDATE_ZIP ? MAX_ZIP_BYTES : MAX_METADATA,
        expectedSize: asset.size,
      });
      const hash = await updateSha256(bytes);
      if (asset.digest && asset.digest !== `sha256:${hash}`)
        throw new Error("下载摘要与 GitHub 发布记录不一致。");
      downloaded.set(name, { bytes, hash });
    }
    const text = (name) =>
      new TextDecoder("utf-8", { fatal: true }).decode(
        downloaded.get(name).bytes
      );
    const sums = Object.create(null);
    for (const line of text(SUMS).trimEnd().split("\n")) {
      const match = /^([a-f0-9]{64}) {2}([\w.-]+)$/.exec(line);
      if (!match || sums[match[2]]) throw new Error("发布校验清单无效。");
      sums[match[2]] = match[1];
    }
    if (
      Object.keys(sums).length !== 3 ||
      ![UPDATE_ZIP, UPDATE_SOURCE, RECEIPT].every((name) => sums[name]) ||
      sums[RECEIPT] !== downloaded.get(RECEIPT).hash ||
      sums[UPDATE_ZIP] !== downloaded.get(UPDATE_ZIP).hash
    )
      throw new Error("发布文件的 SHA-256 校验失败。");
    const receipt = JSON.parse(text(RECEIPT));
    if (
      receipt.schema_version !== 1 ||
      receipt.git_dirty !== false ||
      !/^[a-f0-9]{40}$/.test(receipt.git_commit) ||
      receipt.version_name !== selected.version ||
      receipt.version !== selected.version.split("-learning.")[0] ||
      !Array.isArray(receipt.artifacts) ||
      receipt.artifacts.length !== 2
    )
      throw new Error("发布清单的版本或源码记录无效。");
    const seen = new Set();
    for (const artifact of receipt.artifacts) {
      const name = artifact?.filename;
      if (
        ![UPDATE_ZIP, UPDATE_SOURCE].includes(name) ||
        seen.has(name) ||
        artifact.sha256 !== sums[name] ||
        artifact.size_bytes !== selected.assets[name].size ||
        (selected.assets[name].digest &&
          selected.assets[name].digest !== `sha256:${sums[name]}`)
      )
        throw new Error("源码或安装包记录不一致。");
      seen.add(name);
    }
    const files = await unpackChromeRelease(downloaded.get(UPDATE_ZIP).bytes, {
      signal: boundedSignal,
      onProgress,
    });
    for (const name of [
      "manifest.json",
      "options.js",
      "options.html",
      "background.js",
      "content.js",
      "popup.html",
    ]) {
      if (!files.get(name)?.length) throw new Error(`安装包缺少 ${name}。`);
    }
    const manifest = validateUpdateManifest(
      JSON.parse(new TextDecoder().decode(files.get("manifest.json")))
    );
    if (
      manifest.version_name !== receipt.version_name ||
      manifest.version !== receipt.version
    )
      throw new Error("安装包内版本与发布记录不符。");
    return { files, manifest, receipt };
  });
}
