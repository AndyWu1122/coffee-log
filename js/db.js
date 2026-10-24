// 唯一存取 IndexedDB 的地方
const DB_NAME = 'coffee-log';
const DB_VERSION = 1;

let dbPromise = null;

/** 開啟資料庫（單例） */
export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('beans')) {
        db.createObjectStore('beans', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('brews')) {
        const brews = db.createObjectStore('brews', { keyPath: 'id' });
        brews.createIndex('beanId', 'beanId');
        brews.createIndex('brewedAt', 'brewedAt');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // 其他分頁要升級或刪除資料庫時，主動關閉連線避免卡住對方；下次存取會重新開啟
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('資料庫被其他分頁占用，請關閉其他分頁後重試'));
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function req2promise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** 在單一 store 上開交易，fn(store) 回傳 IDBRequest；等交易完成才 resolve */
async function tx(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    let result;
    req2promise(fn(t.objectStore(storeName))).then((r) => { result = r; }, reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('交易中止'));
  });
}

export const getAll = (store) => tx(store, 'readonly', (s) => s.getAll());
export const get = (store, id) => tx(store, 'readonly', (s) => s.get(id));
export const put = (store, obj) => tx(store, 'readwrite', (s) => s.put(obj));
export const remove = (store, id) => tx(store, 'readwrite', (s) => s.delete(id));
export const getAllByIndex = (store, index, value) =>
  tx(store, 'readonly', (s) => s.index(index).getAll(value));
export const countByIndex = (store, index, value) =>
  tx(store, 'readonly', (s) => s.index(index).count(value));

/**
 * 在同一個交易裡寫入多個 store：data = { storeName: [obj, ...] }
 * clear 為 true 時先清空這些 store。任何一筆失敗整個交易會回滾。
 */
export async function bulkPut(data, { clear = false } = {}) {
  const db = await openDB();
  const names = Object.keys(data);
  return new Promise((resolve, reject) => {
    const t = db.transaction(names, 'readwrite');
    for (const name of names) {
      const store = t.objectStore(name);
      if (clear) store.clear();
      for (const obj of data[name]) store.put(obj);
    }
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('交易中止'));
  });
}
