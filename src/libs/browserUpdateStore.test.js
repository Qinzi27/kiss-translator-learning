import { browserUpdateStore } from "./browserUpdateStore";

function idbHarness() {
  const openRequest = {};
  const transactions = [];
  const db = {
    close: jest.fn(),
    createObjectStore: jest.fn(),
    transaction: jest.fn(() => {
      const request = {};
      const objectStore = {
        get: jest.fn(() => request),
        put: jest.fn(() => request),
        delete: jest.fn(() => request),
      };
      const tx = {
        request,
        objectStore: jest.fn(() => objectStore),
        operations: objectStore,
      };
      transactions.push(tx);
      return tx;
    }),
  };
  const factory = { open: jest.fn(() => openRequest) };
  return {
    factory,
    db,
    transactions,
    openRequest,
    async opened({ upgrade = false } = {}) {
      openRequest.result = db;
      if (upgrade) openRequest.onupgradeneeded();
      openRequest.onsuccess();
      await Promise.resolve();
    },
  };
}

test("a backup write only resolves on strict transaction completion, not request success", async () => {
  const harness = idbHarness();
  const store = browserUpdateStore(harness.factory);
  const snapshot = {
    phase: "writing",
    entries: [{ path: "manifest.json", before: new Uint8Array([1, 2, 3]) }],
  };
  let completed = false;
  const pending = store.set("backup", snapshot).then(() => {
    completed = true;
  });
  await harness.opened({ upgrade: true });
  expect(harness.db.createObjectStore).toHaveBeenCalledWith("state");
  expect(harness.db.transaction).toHaveBeenCalledWith("state", "readwrite", {
    durability: "strict",
  });
  const tx = harness.transactions[0];
  expect(tx.operations.put).toHaveBeenCalledWith(snapshot, "backup");
  tx.request.result = "backup";
  tx.request.onsuccess();
  await Promise.resolve();
  expect(completed).toBe(false);
  tx.oncomplete();
  await pending;
  expect(completed).toBe(true);
});

test.each(["onabort", "onerror"])(
  "transaction %s rejects a backup even when the put request previously succeeded",
  async (event) => {
    const harness = idbHarness();
    const store = browserUpdateStore(harness.factory);
    const pending = store.set("backup", { phase: "writing" });
    const rejection = pending.catch((error) => error);
    await harness.opened();
    const tx = harness.transactions[0];
    tx.request.result = "backup";
    tx.request.onsuccess();
    tx[event]();
    expect((await rejection).message).toContain("备份写入失败");
  }
);

test("reads persisted values and removes records through completed transactions using one database connection", async () => {
  const harness = idbHarness();
  const store = browserUpdateStore(harness.factory);
  const read = store.get("connection");
  await harness.opened();
  const value = { managed: ["manifest.json"] };
  let tx = harness.transactions[0];
  expect(tx.operations.get).toHaveBeenCalledWith("connection");
  expect(harness.db.transaction.mock.calls[0][1]).toBe("readonly");
  tx.request.result = value;
  tx.request.onsuccess();
  tx.oncomplete();
  await expect(read).resolves.toBe(value);
  const remove = store.remove("backup");
  await Promise.resolve();
  tx = harness.transactions[1];
  expect(tx.operations.delete).toHaveBeenCalledWith("backup");
  tx.request.onsuccess();
  tx.oncomplete();
  await remove;
  expect(harness.factory.open).toHaveBeenCalledTimes(1);
  await store.close();
  expect(harness.db.close).toHaveBeenCalledTimes(1);
});

test.each([
  ["onerror", "无法打开"],
  ["onblocked", "关闭其他"],
])(
  "database open %s propagates a useful error without starting a file-backup transaction",
  async (event, message) => {
    const harness = idbHarness();
    const store = browserUpdateStore(harness.factory);
    const pending = store.get("backup");
    const rejection = pending.catch((error) => error);
    harness.openRequest[event]();
    expect((await rejection).message).toContain(message);
    expect(harness.db.transaction).not.toHaveBeenCalled();
  }
);

test("a schema version change releases the database connection, and unavailable storage fails closed", async () => {
  const harness = idbHarness();
  browserUpdateStore(harness.factory);
  await harness.opened();
  harness.db.onversionchange();
  expect(harness.db.close).toHaveBeenCalledTimes(1);
  expect(() => browserUpdateStore(null)).toThrow("无法建立可靠备份");
});
