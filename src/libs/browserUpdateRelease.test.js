import { createHash, webcrypto } from "crypto";
import { applyNetworkPolicy, resolveNetworkPolicy } from "./networkPolicy";
import { unpackChromeRelease } from "./browserUpdateZip";
import {
  UPDATE_API,
  UPDATE_HOME,
  UPDATE_ZIP,
  UPDATE_SOURCE,
  checkBrowserRelease,
  compareLearningVersions,
  downloadBrowserRelease,
  releaseAssetUrl,
  selectBrowserRelease,
  validateUpdateManifest,
} from "./browserUpdateRelease";

jest.mock("./networkPolicy", () => ({
  ...jest.requireActual("./networkPolicy"),
  resolveNetworkPolicy: jest.fn(),
}));
jest.mock("./browserUpdateZip", () => ({ unpackChromeRelease: jest.fn() }));
const originalCrypto = global.crypto;
const originalFetch = global.fetch;
const encode = (value) =>
  Uint8Array.from(
    new TextEncoder().encode(
      typeof value === "string" ? value : JSON.stringify(value)
    )
  );
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const tag = "v2.0.36-learning.7";
const manifest = {
  manifest_version: 3,
  homepage_url: UPDATE_HOME,
  version: "2.0.36",
  version_name: tag.slice(1),
  background: { service_worker: "background.js" },
};
let data;
let raw;
let release;
function response(url, bytes, options = {}) {
  let consumed = false;
  const cancel = jest.fn(async () => {});
  return {
    ok: true,
    status: 200,
    url,
    ...options,
    headers: { get: () => String(bytes.length), ...options.headers },
    body: {
      cancel,
      getReader: () => ({
        cancel,
        read: async () =>
          consumed
            ? { done: true }
            : ((consumed = true), { done: false, value: bytes }),
      }),
    },
  };
}
function setup() {
  const zip = encode("validated zip placeholder");
  const source = encode("matching GPL source");
  const receipt = encode({
    schema_version: 1,
    git_dirty: false,
    git_commit: "a".repeat(40),
    version_name: tag.slice(1),
    version: "2.0.36",
    artifacts: [
      { filename: UPDATE_ZIP, size_bytes: zip.length, sha256: hash(zip) },
      {
        filename: UPDATE_SOURCE,
        size_bytes: source.length,
        sha256: hash(source),
      },
    ],
  });
  const sums = encode(
    `${hash(zip)}  ${UPDATE_ZIP}\n${hash(source)}  ${UPDATE_SOURCE}\n${hash(receipt)}  release-manifest.json\n`
  );
  data = new Map([
    [UPDATE_ZIP, zip],
    [UPDATE_SOURCE, source],
    ["release-manifest.json", receipt],
    ["SHA256SUMS.txt", sums],
  ]);
  raw = {
    draft: false,
    prerelease: true,
    tag_name: tag,
    assets: [...data].map(([name, bytes]) => ({
      name,
      size: bytes.length,
      digest: `sha256:${hash(bytes)}`,
      state: "uploaded",
      browser_download_url: releaseAssetUrl(tag, name),
    })),
  };
  release = selectBrowserRelease([raw]);
  unpackChromeRelease.mockResolvedValue(
    new Map([
      ...[
        "options.js",
        "options.html",
        "background.js",
        "content.js",
        "popup.html",
      ].map((name) => [name, encode(name)]),
      ["manifest.json", encode(manifest)],
    ])
  );
  global.fetch = jest.fn(async (url) =>
    url.startsWith(UPDATE_API)
      ? response(url, encode([raw]))
      : response(url, data.get(url.split("/").pop()))
  );
}
beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(global, "crypto", {
    configurable: true,
    value: webcrypto,
  });
  resolveNetworkPolicy.mockResolvedValue("normal");
  setup();
});
afterAll(() => {
  Object.defineProperty(global, "crypto", {
    configurable: true,
    value: originalCrypto,
  });
  global.fetch = originalFetch;
});

test("version sorting is numeric and includes complete prereleases, skipping drafts and missing artifacts", () => {
  const older = {
    ...raw,
    tag_name: "v2.0.36-learning.6",
    assets: raw.assets.map((a) => ({
      ...a,
      browser_download_url: releaseAssetUrl("v2.0.36-learning.6", a.name),
    })),
  };
  expect(
    compareLearningVersions("2.0.36-learning.10", "2.0.36-learning.9")
  ).toBe(1);
  expect(
    selectBrowserRelease([
      older,
      raw,
      { ...raw, draft: true },
      { ...raw, assets: [] },
    ]).tag
  ).toBe(tag);
  expect(() => compareLearningVersions("99999.1.1-learning.1", tag)).toThrow();
  expect(() =>
    selectBrowserRelease([{ ...raw, assets: [...raw.assets, raw.assets[0]] }])
  ).toThrow();
});

test("only constructed repository/tag assets can be selected", () => {
  raw.assets[0].browser_download_url = "https://attacker.example/package.zip";
  expect(() => selectBrowserRelease([raw])).toThrow();
  expect(() => releaseAssetUrl(tag, "../../credentials")).toThrow();
  expect(() =>
    validateUpdateManifest({
      ...manifest,
      homepage_url: "https://example.test",
    })
  ).toThrow();
});

test("checking uses anonymous bounded metadata requests with redirects refused", async () => {
  expect((await checkBrowserRelease()).tag).toBe(tag);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(global.fetch.mock.calls[0][1]).toMatchObject({
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
    referrerPolicy: "no-referrer",
  });
  expect(unpackChromeRelease).not.toHaveBeenCalled();
});

test("offline is enforced before any network request", async () => {
  resolveNetworkPolicy.mockResolvedValue("offline");
  await expect(checkBrowserRelease()).rejects.toThrow("离线");
  await expect(downloadBrowserRelease(release)).rejects.toThrow("离线");
  expect(global.fetch).not.toHaveBeenCalled();
});

test("no-google permits only this release download; metadata/checksums/zip bind before unpack", async () => {
  resolveNetworkPolicy.mockResolvedValue("no-google");
  const result = await downloadBrowserRelease(release);
  expect(result.manifest.version_name).toBe(tag.slice(1));
  expect(global.fetch).toHaveBeenCalledTimes(3);
  expect(
    global.fetch.mock.calls.every(
      ([url, options]) =>
        url.startsWith(UPDATE_HOME) && options.credentials === "omit"
    )
  ).toBe(true);
  expect(
    global.fetch.mock.calls.some(([url]) => url.endsWith(UPDATE_SOURCE))
  ).toBe(false);
  expect(unpackChromeRelease).toHaveBeenCalledTimes(1);
  expect(() =>
    applyNetworkPolicy("https://example.com", {}, "normal")
  ).not.toThrow();
});

test("known GitHub CDN redirect works, unexpected final origins are refused", async () => {
  global.fetch.mockImplementation(async (url) =>
    response(
      "https://release-assets.githubusercontent.com/github-production-release-asset/12/abc-def?token=public",
      data.get(url.split("/").pop())
    )
  );
  await expect(downloadBrowserRelease(release)).resolves.toHaveProperty(
    "manifest"
  );
  global.fetch.mockImplementation(async (url) =>
    response("https://attacker.example/file", data.get(url.split("/").pop()))
  );
  await expect(downloadBrowserRelease(release)).rejects.toThrow("离开");
});

test.each(["SHA256SUMS.txt", "release-manifest.json", UPDATE_ZIP])(
  "changed %s is rejected against API digest before extraction",
  async (name) => {
    data.get(name)[0] ^= 1;
    await expect(downloadBrowserRelease(release)).rejects.toThrow("摘要");
    expect(unpackChromeRelease).not.toHaveBeenCalled();
  }
);

test("mismatched source receipt is refused even when other downloaded digests are absent", async () => {
  for (const item of Object.values(release.assets)) item.digest = null;
  const receipt = JSON.parse(
    new TextDecoder().decode(data.get("release-manifest.json"))
  );
  receipt.artifacts[1].size_bytes += 1;
  const changed = encode(receipt);
  data.set("release-manifest.json", changed);
  release.assets["release-manifest.json"].size = changed.length;
  const sums = new TextDecoder()
    .decode(data.get("SHA256SUMS.txt"))
    .replace(
      /[a-f0-9]{64}  release-manifest.json/,
      `${hash(changed)}  release-manifest.json`
    );
  data.set("SHA256SUMS.txt", encode(sums));
  await expect(downloadBrowserRelease(release)).rejects.toThrow("记录不一致");
  expect(unpackChromeRelease).not.toHaveBeenCalled();
});

test("oversized response and rate limits fail without unpacking", async () => {
  global.fetch.mockImplementation(async (url) =>
    response(url, encode("{}"), {
      headers: { get: () => String(3 * 1024 * 1024) },
    })
  );
  await expect(checkBrowserRelease()).rejects.toThrow("长度");
  global.fetch.mockImplementation(async (url) =>
    response(url, encode("{}"), { ok: false, status: 429 })
  );
  await expect(checkBrowserRelease()).rejects.toThrow("额度");
  expect(unpackChromeRelease).not.toHaveBeenCalled();
});

test("already cancelled downloads cannot proceed to unpack", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    downloadBrowserRelease(release, { signal: controller.signal })
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(unpackChromeRelease).not.toHaveBeenCalled();
});

test("tiny chunks are bounded without per-chunk accumulation and still decode", async () => {
  const bytes = encode([raw]);
  let offset = 0;
  const cancel = jest.fn(async () => {});
  global.fetch.mockImplementation(async (url) => ({
    ok: true,
    status: 200,
    url,
    headers: { get: () => null },
    body: {
      getReader: () => ({
        cancel,
        read: async () =>
          offset === bytes.length
            ? { done: true }
            : { done: false, value: bytes.slice(offset, ++offset) },
      }),
    },
  }));
  await expect(checkBrowserRelease()).resolves.toHaveProperty("tag", tag);
  expect(cancel).toHaveBeenCalledTimes(1);
});

test("cancellation finishes even if stream read and cancel never settle", async () => {
  const controller = new AbortController();
  let started;
  const reading = new Promise((resolve) => {
    started = resolve;
  });
  const cancel = jest.fn(() => new Promise(() => {}));
  global.fetch.mockImplementation(async (url) => ({
    ok: true,
    status: 200,
    url,
    headers: { get: () => null },
    body: {
      getReader: () => ({
        cancel,
        read: () => {
          started();
          return new Promise(() => {});
        },
      }),
    },
  }));
  const result = checkBrowserRelease({ signal: controller.signal });
  const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
  await reading;
  controller.abort();
  await rejected;
  expect(cancel).toHaveBeenCalled();
});

test("empty synchronous chunks yield so a user can cancel", async () => {
  const controller = new AbortController();
  global.fetch.mockImplementation(async (url) => ({
    ok: true,
    status: 200,
    url,
    headers: { get: () => null },
    body: {
      getReader: () => ({
        cancel: async () => {},
        read: async () => ({ done: false, value: new Uint8Array(0) }),
      }),
    },
  }));
  const result = checkBrowserRelease({ signal: controller.signal });
  const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
  setTimeout(() => controller.abort(), 0);
  await rejected;
});

test("deadline rejects a network implementation that ignores abort", async () => {
  jest.useFakeTimers();
  global.fetch.mockImplementation(() => new Promise(() => {}));
  try {
    const result = checkBrowserRelease();
    const rejected = expect(result).rejects.toMatchObject({
      name: "AbortError",
    });
    jest.advanceTimersByTime(180000);
    await rejected;
  } finally {
    jest.useRealTimers();
  }
});
