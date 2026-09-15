const DATABASE = "kiss-learning-browser-updater";
const STORE = "state";

// FileSystemDirectoryHandle and package-only backup bytes stay in this extension's
// IndexedDB. Nothing is synced or included in exported translation settings.
export function browserUpdateStore(factory = globalThis.indexedDB) {
  if (!factory) throw new Error("浏览器存储不可用，无法建立可靠备份。");
  const connection = new Promise((resolve, reject) => {
    const request = factory.open(DATABASE, 1);
    let unavailable = false;
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => reject(new Error("无法打开更新备份存储。"));
    request.onblocked = () => {
      unavailable = true;
      reject(new Error("请关闭其他插件更新页面后重试。"));
    };
    request.onsuccess = () => {
      const db = request.result;
      if (unavailable) {
        db.close();
        return;
      }
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
  async function operate(mode, callback) {
    const db = await connection;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode, { durability: "strict" });
      let result;
      const request = callback(tx.objectStore(STORE));
      request.onsuccess = () => {
        result = request.result;
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () =>
        reject(new Error("更新备份写入失败，请检查磁盘空间或浏览器存储权限。"));
    });
  }
  return {
    get: (key) => operate("readonly", (store) => store.get(key)),
    set: (key, value) => operate("readwrite", (store) => store.put(value, key)),
    remove: (key) => operate("readwrite", (store) => store.delete(key)),
    close: async () => (await connection).close(),
  };
}
