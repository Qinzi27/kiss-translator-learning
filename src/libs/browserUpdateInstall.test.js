import {
  connectUpdateDirectory,
  installBrowserUpdate,
  readUpdateFile,
  requestUpdateDirectoryPermission,
  restoreBrowserUpdate,
  verifyUpdateDirectory,
  withBrowserUpdateLock,
} from "./browserUpdateInstall";
import { MAX_UPDATE_BYTES, UPDATE_HOME } from "./browserUpdateRelease";

jest.mock("./browser", () => ({ browser: {} }));
jest.mock("./networkPolicy", () => ({
  applyNetworkPolicy: jest.fn(),
  resolveNetworkPolicy: jest.fn(),
}));

const encoder = new TextEncoder();
const decode = (bytes) => new TextDecoder().decode(bytes);
const bytes = (value) =>
  new Uint8Array(typeof value === "string" ? encoder.encode(value) : value);
const missing = () => new DOMException("Missing entry", "NotFoundError");
const wrongType = () =>
  new DOMException("Wrong entry kind", "TypeMismatchError");
const originalCrypto = globalThis.crypto;

class MemoryDirectory {
  constructor(fs, path = "") {
    this.fs = fs;
    this.path = path;
    this.kind = "directory";
  }
  child(name) {
    return this.path ? `${this.path}/${name}` : name;
  }
  async queryPermission() {
    return this.fs.permission;
  }
  async requestPermission() {
    return this.fs.requestedPermission;
  }
  async isSameEntry(other) {
    return this.fs === other?.fs && this.path === other.path;
  }
  async getDirectoryHandle(name, { create = false } = {}) {
    const path = this.child(name);
    if (this.fs.files.has(path)) throw wrongType();
    if (!this.fs.dirs.has(path)) {
      if (!create) throw missing();
      this.fs.dirs.add(path);
    }
    return new MemoryDirectory(this.fs, path);
  }
  async getFileHandle(name, { create = false } = {}) {
    const path = this.child(name);
    if (this.fs.dirs.has(path)) throw wrongType();
    if (!this.fs.files.has(path)) {
      if (!create) throw missing();
      this.fs.files.set(path, new Uint8Array());
      this.fs.events.push(["create", path]);
    }
    const fs = this.fs;
    return {
      kind: "file",
      async getFile() {
        fs.fail("read", path);
        const value = fs.files.get(path);
        if (!value) throw missing();
        return {
          size: value.length,
          arrayBuffer: async () => value.slice().buffer,
        };
      },
      async createWritable() {
        fs.fail("open", path);
        let pending;
        return {
          async write(value) {
            fs.fail("write", path);
            pending = bytes(value);
          },
          async close() {
            await fs.beforeClose?.(path);
            fs.fail("close", path);
            fs.files.set(path, pending);
            fs.events.push(["close", path]);
            fs.afterClose?.(path);
          },
          async abort() {
            fs.events.push(["abort", path]);
          },
        };
      },
    };
  }
  async removeEntry(name) {
    const path = this.child(name);
    this.fs.fail("remove", path);
    if (!this.fs.files.has(path)) throw missing();
    this.fs.files.delete(path);
    this.fs.events.push(["remove", path]);
  }
}

function memoryDirectory(initial = {}) {
  const fs = {
    files: new Map(),
    dirs: new Set(),
    events: [],
    failures: [],
    permission: "granted",
    requestedPermission: "granted",
    fail(operation, path) {
      const index = this.failures.findIndex(
        (failure) => failure.operation === operation && failure.path === path
      );
      if (index >= 0) {
        this.failures.splice(index, 1);
        throw new Error(`Synthetic ${operation} failure: ${path}`);
      }
    },
  };
  for (const [path, value] of Object.entries(initial)) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++)
      fs.dirs.add(parts.slice(0, i).join("/"));
    fs.files.set(path, bytes(value));
  }
  return new MemoryDirectory(fs);
}

// Model IndexedDB structured cloning: subsequent mutation of a retrieved journal
// never changes the durable copy until store.set successfully commits.
function clone(value) {
  if (value instanceof MemoryDirectory)
    return new MemoryDirectory(value.fs, value.path);
  if (value instanceof Uint8Array) return value.slice();
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, clone(item)])
    );
  return value;
}
function memoryStore(initial = {}) {
  const records = new Map(
    Object.entries(initial).map(([key, value]) => [key, clone(value)])
  );
  return {
    records,
    beforeSet: null,
    get: jest.fn(async (key) => clone(records.get(key))),
    set: jest.fn(async function (key, value) {
      await this.beforeSet?.(key, value);
      records.set(key, clone(value));
    }),
    remove: jest.fn(async (key) => {
      records.delete(key);
    }),
  };
}
const manifest = (version = "2.0.35", learning = 6) => ({
  manifest_version: 3,
  version,
  version_name: `${version}-learning.${learning}`,
  homepage_url: UPDATE_HOME,
  background: { service_worker: "background.js" },
  key: "SYNTHETIC_STABLE_EXTENSION_ID",
});
const before = manifest();
const after = manifest("2.0.36", 7);
function fixture() {
  const directory = memoryDirectory({
    "manifest.json": JSON.stringify(before),
    "options.js": "old options js",
    "options.html": "old options html",
    "background.js": "old background",
    "obsolete.js": "old managed asset",
    "notes.txt": "user-owned notes",
    "nested/keep.txt": "user-owned nested file",
  });
  const download = {
    manifest: after,
    files: new Map([
      ["manifest.json", bytes(JSON.stringify(after))],
      ["options.html", bytes("new options html")],
      ["options.js", bytes("new options js")],
      ["background.js", bytes("new background")],
      ["nested/new.js", bytes("new module")],
    ]),
  };
  const store = memoryStore({
    connection: {
      directory,
      managed: [
        "manifest.json",
        "options.js",
        "options.html",
        "background.js",
        "obsolete.js",
      ],
    },
  });
  return { directory, download, store, verify: jest.fn(async () => {}) };
}
const contents = (directory) =>
  Object.fromEntries(
    [...directory.fs.files].map(([name, value]) => [name, decode(value)])
  );

beforeEach(() => {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: require("crypto").webcrypto,
  });
});
afterEach(() => {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: originalCrypto,
  });
});

test("upgrade commits durable backup before package writes, writes entry points last, and only manages release files", async () => {
  const { directory, download, store, verify } = fixture();
  const initial = contents(directory);
  let eventsAtBackupCommit;
  store.beforeSet = (key, value) => {
    if (key === "backup" && value.phase === "writing")
      eventsAtBackupCommit = [...directory.fs.events];
  };
  await expect(
    installBrowserUpdate(directory, download, store, { verify })
  ).resolves.toEqual(after);
  expect(eventsAtBackupCommit).toEqual([]);
  expect(
    directory.fs.events
      .filter(([operation]) => operation === "close")
      .map(([, path]) => path)
      .slice(-3)
  ).toEqual(["options.js", "options.html", "manifest.json"]);
  const expected = {
    ...initial,
    "manifest.json": JSON.stringify(after),
    "options.js": "new options js",
    "options.html": "new options html",
    "background.js": "new background",
    "nested/new.js": "new module",
  };
  delete expected["obsolete.js"];
  expect(contents(directory)).toEqual(expected);
  expect((await store.get("backup")).phase).toBe("ready");
  expect((await store.get("connection")).managed.sort()).toEqual(
    [...download.files.keys()].sort()
  );
});

test("manual rollback after reload restores old managed files and removes only files introduced by the release", async () => {
  const { directory, download, store, verify } = fixture();
  const initial = contents(directory);
  await installBrowserUpdate(directory, download, store, { verify });
  const reopened = memoryStore(Object.fromEntries(store.records));
  await expect(restoreBrowserUpdate(reopened, { verify })).resolves.toEqual(
    before
  );
  expect(contents(directory)).toEqual(initial);
  expect((await reopened.get("backup")).phase).toBe("restored");
  expect((await reopened.get("connection")).managed).toContain("obsolete.js");
});

test("a crash snapshot between managed-list and ready commits stays recovery-only and restores the exact previous files and managed paths", async () => {
  const { directory, download, store, verify } = fixture();
  const initial = contents(directory);
  const previousManaged = (await store.get("connection")).managed;
  let crashRecords;
  let crashFiles;
  store.beforeSet = (key, value) => {
    if (key === "backup" && value.phase === "ready") {
      // Capture durable state before the final commit. A disappearing process
      // cannot run install's catch/automatic recovery, so reopening uses only
      // this snapshot rather than the live store's subsequently committed data.
      crashRecords = clone(Object.fromEntries(store.records));
      crashFiles = contents(directory);
    }
  };
  await installBrowserUpdate(directory, download, store, { verify });
  expect(crashRecords.backup.phase).toBe("writing");
  expect(crashRecords.connection.managed.slice().sort()).toEqual(
    [...download.files.keys()].sort()
  );
  expect(contents(directory)).toEqual(crashFiles);
  const reopened = memoryStore(crashRecords);
  const eventsBeforeRetry = [...directory.fs.events];
  await expect(
    installBrowserUpdate(directory, download, reopened, { verify })
  ).rejects.toThrow("请先恢复");
  expect(directory.fs.events).toEqual(eventsBeforeRetry);
  await expect(restoreBrowserUpdate(reopened, { verify })).resolves.toEqual(
    before
  );
  expect(contents(directory)).toEqual(initial);
  expect((await reopened.get("connection")).managed).toEqual(previousManaged);
  expect((await reopened.get("backup")).phase).toBe("restored");
});

test.each(["write", "close", "open"])(
  "an atomic %s failure restores the old package and cleans a newly created empty file",
  async (operation) => {
    const { directory, download, store, verify } = fixture();
    const initial = contents(directory);
    directory.fs.failures.push({ operation, path: "nested/new.js" });
    await expect(
      installBrowserUpdate(directory, download, store, { verify })
    ).rejects.toThrow("已经恢复原版");
    expect(contents(directory)).toEqual(initial);
    expect((await store.get("backup")).phase).toBe("restored");
  }
);

test("failed durable backup leaves every installed file untouched", async () => {
  const { directory, download, store, verify } = fixture();
  const initial = contents(directory);
  store.beforeSet = (key) => {
    if (key === "backup") throw new Error("Synthetic quota failure");
  };
  await expect(
    installBrowserUpdate(directory, download, store, { verify })
  ).rejects.toThrow("quota");
  expect(contents(directory)).toEqual(initial);
  expect(directory.fs.events).toEqual([]);
  expect(await store.get("backup")).toBeUndefined();
});

test("abort before package writes leaves no backup, and abort after a committed file restores all originals", async () => {
  const first = fixture();
  const beforeAbort = new AbortController();
  beforeAbort.abort();
  await expect(
    installBrowserUpdate(first.directory, first.download, first.store, {
      verify: first.verify,
      signal: beforeAbort.signal,
    })
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(first.directory.fs.events).toEqual([]);
  expect(await first.store.get("backup")).toBeUndefined();
  const next = fixture();
  const initial = contents(next.directory);
  const midway = new AbortController();
  next.directory.fs.afterClose = () => midway.abort();
  await expect(
    installBrowserUpdate(next.directory, next.download, next.store, {
      verify: next.verify,
      signal: midway.signal,
    })
  ).rejects.toThrow("已经恢复原版");
  expect(contents(next.directory)).toEqual(initial);
});

test("cancelling while the final manifest close is pending restores every old file instead of reporting a completed update", async () => {
  const { directory, download, store, verify } = fixture();
  const initial = contents(directory);
  const previousManaged = (await store.get("connection")).managed;
  const controller = new AbortController();
  let enteredClose;
  let finishClose;
  const atFinalClose = new Promise((resolve) => { enteredClose = resolve; });
  const finalClose = new Promise((resolve) => { finishClose = resolve; });
  let delayed = false;
  directory.fs.beforeClose = (path) => {
    if (path === "manifest.json" && !delayed) {
      delayed = true;
      enteredClose();
      return finalClose;
    }
    return undefined;
  };
  const committedPhases = [];
  store.beforeSet = (key, value) => {
    if (key === "backup") committedPhases.push(value.phase);
  };
  const outcome = installBrowserUpdate(directory, download, store, {
    verify,
    signal: controller.signal,
  }).catch((error) => error);
  await atFinalClose;
  expect(decode(directory.fs.files.get("manifest.json"))).toBe(
    JSON.stringify(before)
  );
  expect((await store.get("backup")).phase).toBe("writing");
  controller.abort();
  finishClose();
  expect(await outcome).toMatchObject({
    message: expect.stringContaining("已经恢复原版"),
  });
  expect(contents(directory)).toEqual(initial);
  expect((await store.get("connection")).managed).toEqual(previousManaged);
  expect((await store.get("backup")).phase).toBe("restored");
  expect(committedPhases).toEqual(["writing", "recovering", "restored"]);
});

test.each(["writing", "recovering"])(
  "unfinished %s journal blocks upgrade and directory reconnection before probes",
  async (phase) => {
    const { directory, download, store, verify } = fixture();
    await store.set("backup", { phase });
    await expect(
      installBrowserUpdate(directory, download, store, { verify })
    ).rejects.toThrow("先恢复");
    await expect(
      connectUpdateDirectory(directory, store, verify)
    ).rejects.toThrow("先恢复");
    expect(verify).not.toHaveBeenCalled();
    expect(directory.fs.events).toEqual([]);
  }
);

test("an external edit known before rollback rejects the whole restore without changing any other file", async () => {
  const { directory, download, store, verify } = fixture();
  await installBrowserUpdate(directory, download, store, { verify });
  directory.fs.files.set("options.js", bytes("external user edit"));
  const edited = contents(directory);
  directory.fs.events = [];
  await expect(restoreBrowserUpdate(store, { verify })).rejects.toThrow("修改");
  expect(contents(directory)).toEqual(edited);
  expect(directory.fs.events).toEqual([]);
  expect((await store.get("backup")).phase).toBe("ready");
});

test("an external edit made while restoring an earlier file is rechecked before the later file is touched", async () => {
  const { directory, download, store, verify } = fixture();
  await installBrowserUpdate(directory, download, store, { verify });
  let edited = false;
  directory.fs.afterClose = (path) => {
    if (!edited && path === "background.js") {
      edited = true;
      directory.fs.files.set(
        "options.js",
        bytes("external edit during restore")
      );
    }
  };
  await expect(restoreBrowserUpdate(store, { verify })).rejects.toThrow("修改");
  expect(decode(directory.fs.files.get("options.js"))).toBe(
    "external edit during restore"
  );
  expect((await store.get("backup")).phase).toBe("recovering");
});

test("a recovery write failure preserves a durable recovering journal for a later retry", async () => {
  const { directory, download, store, verify } = fixture();
  await installBrowserUpdate(directory, download, store, { verify });
  directory.fs.failures.push({ operation: "close", path: "options.js" });
  await expect(restoreBrowserUpdate(store, { verify })).rejects.toThrow(
    "Synthetic close"
  );
  expect((await store.get("backup")).phase).toBe("recovering");
  await expect(restoreBrowserUpdate(store, { verify })).resolves.toEqual(
    before
  );
  expect(decode(directory.fs.files.get("options.js"))).toBe("old options js");
});

test.each(["ready-journal", "managed-list"])(
  "failure committing %s after file replacement still restores the installed package",
  async (failurePoint) => {
    const { directory, download, store, verify } = fixture();
    const initial = contents(directory);
    let failed = false;
    store.beforeSet = (key, value) => {
      if (
        !failed &&
        ((failurePoint === "ready-journal" &&
          key === "backup" &&
          value.phase === "ready") ||
          (failurePoint === "managed-list" && key === "connection"))
      ) {
        failed = true;
        throw new Error("Synthetic final metadata failure");
      }
    };
    await expect(
      installBrowserUpdate(directory, download, store, { verify })
    ).rejects.toThrow("已经恢复原版");
    expect(contents(directory)).toEqual(initial);
    expect((await store.get("backup")).phase).toBe("restored");
  }
);

test("an external edit during install is preserved and blocks automatic rollback until the user resolves the conflict", async () => {
  const { directory, download, store, verify } = fixture();
  directory.fs.afterClose = (path) => {
    if (path === "background.js")
      directory.fs.files.set(
        "options.js",
        bytes("external edit during install")
      );
  };
  await expect(
    installBrowserUpdate(directory, download, store, { verify })
  ).rejects.toThrow("自动恢复未完成");
  expect(decode(directory.fs.files.get("options.js"))).toBe(
    "external edit during install"
  );
  expect((await store.get("backup")).phase).toBe("writing");
  await expect(
    installBrowserUpdate(directory, download, store, { verify })
  ).rejects.toThrow("先恢复");
});

test("missing and nested paths are distinguished from unreadable files", async () => {
  const directory = memoryDirectory({ "nested/file.js": "nested content" });
  expect(decode(await readUpdateFile(directory, "nested/file.js"))).toBe(
    "nested content"
  );
  expect(await readUpdateFile(directory, "missing/file.js")).toBeNull();
  directory.fs.failures.push({ operation: "read", path: "nested/file.js" });
  await expect(readUpdateFile(directory, "nested/file.js")).rejects.toThrow(
    "Synthetic read"
  );
  await expect(readUpdateFile(directory, "../outside.txt")).rejects.toThrow(
    "不安全"
  );
});

test("same-name copies cannot replace the connected handle, while isSameEntry preserves managed history", async () => {
  const { directory, download, store, verify } = fixture();
  const copy = memoryDirectory(contents(directory));
  await expect(
    installBrowserUpdate(copy, download, store, { verify })
  ).rejects.toThrow("授权记录不一致");
  await connectUpdateDirectory(
    new MemoryDirectory(directory.fs),
    store,
    verify
  );
  expect((await store.get("connection")).managed).toContain("obsolete.js");
  await store.set("backup", { phase: "ready" });
  await connectUpdateDirectory(copy, store, verify);
  expect((await store.get("connection")).managed).toEqual([]);
  expect(await store.get("backup")).toBeUndefined();
});

test.each(["matches", "wrong-copy", "network-error"])(
  "directory probe %s checks the running extension URL and always removes its plaintext nonce",
  async (outcome) => {
    const { directory } = fixture();
    const initial = contents(directory);
    const api = {
      runtime: { getURL: (name) => `chrome-extension://synthetic-id/${name}` },
    };
    const fetcher = jest.fn(async (url, options) => {
      expect(options).toEqual({
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
      });
      expect(url).toMatch(
        /^chrome-extension:\/\/synthetic-id\/\.kiss-directory-check-/
      );
      if (outcome === "network-error")
        throw new Error("Synthetic local fetch failure");
      const name = url.split("/").pop();
      const text =
        outcome === "matches"
          ? decode(directory.fs.files.get(name))
          : "another copy";
      return {
        ok: true,
        headers: { get: () => String(text.length) },
        text: async () => text,
      };
    });
    const failure = await verifyUpdateDirectory(directory, api, fetcher).catch(
      (error) => error
    );
    expect(failure?.message || "").toMatch(
      outcome === "matches" ? /^$/ : /无法确认安装目录/
    );
    expect(contents(directory)).toEqual(initial);
    expect(
      [...directory.fs.files.keys()].some((path) =>
        path.startsWith(".kiss-directory-check-")
      )
    ).toBe(false);
  }
);

test("permission denial stops before writes, and an unavailable exclusive lock never starts the task", async () => {
  const { directory } = fixture();
  directory.fs.permission = "prompt";
  directory.fs.requestedPermission = "denied";
  await expect(requestUpdateDirectoryPermission(directory)).rejects.toThrow(
    "未获得"
  );
  expect(directory.fs.events).toEqual([]);
  const task = jest.fn();
  const locks = {
    request: jest.fn(async (_key, _options, callback) => callback(null)),
  };
  await expect(withBrowserUpdateLock(task, locks)).rejects.toThrow(
    "另一个插件页面"
  );
  expect(task).not.toHaveBeenCalled();
});

test.each(["download", "backup"])(
  "64 MiB aggregate %s limit rejects before a durable journal or any package write",
  async (kind) => {
    const { directory, download, store, verify } = fixture();
    const block = new Uint8Array(MAX_UPDATE_BYTES / 4);
    for (let index = 0; index < 5; index++) {
      const name = `large-${index}.bin`;
      download.files.set(
        name,
        kind === "download" ? block : bytes("small replacement")
      );
      if (kind === "backup") directory.fs.files.set(name, block);
    }
    await expect(
      installBrowserUpdate(directory, download, store, { verify })
    ).rejects.toThrow("64 MiB");
    expect(directory.fs.events).toEqual([]);
    expect(await store.get("backup")).toBeUndefined();
  }
);

test("a corrupted stored backup is rejected before any directory probe or write", async () => {
  const { directory, download, store, verify } = fixture();
  await installBrowserUpdate(directory, download, store, { verify });
  const record = await store.get("backup");
  record.entries[0].before[0] ^= 1;
  await store.set("backup", record);
  verify.mockClear();
  directory.fs.events = [];
  await expect(restoreBrowserUpdate(store, { verify })).rejects.toThrow(
    "校验失败"
  );
  expect(verify).not.toHaveBeenCalled();
  expect(directory.fs.events).toEqual([]);
});
