// 唯一存取 IndexedDB 的地方
const DB_NAME = 'coffee-log';
// v1：beans、brews（索引 beanId、brewedAt）
// v2：新增 grinders；brews 加 grinderId 索引（只加索引，不改舊紀錄）
// v3：新增 meta（App 自己的設定／狀態，例如上次備份時間；不匯出）
// v4：新增 photos（每筆紀錄的照片，keyPath brewId）與 thumbs（列表用 300px 縮圖）
// v5：新增 sync（咖啡社群：每筆紀錄上次同步到雲端的內容，keyPath brewId；不匯出）
const DB_VERSION = 5;

let dbPromise = null;

/** 開啟資料庫（單例） */
export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    // 全新安裝與從舊版升級走同一段：每一步都先檢查是否已存在
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('beans')) {
        db.createObjectStore('beans', { keyPath: 'id' });
      }
      // 既有的 store 要從升級交易取得，才能在上面加索引
      const brews = db.objectStoreNames.contains('brews')
        ? req.transaction.objectStore('brews')
        : db.createObjectStore('brews', { keyPath: 'id' });
      if (!brews.indexNames.contains('beanId')) brews.createIndex('beanId', 'beanId');
      if (!brews.indexNames.contains('brewedAt')) brews.createIndex('brewedAt', 'brewedAt');
      if (!brews.indexNames.contains('grinderId')) brews.createIndex('grinderId', 'grinderId');
      if (!db.objectStoreNames.contains('grinders')) {
        db.createObjectStore('grinders', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      // 照片跟 brews 分開存，列表讀紀錄時不會載入圖片；縮圖再分開，列表只讀縮圖
      if (!db.objectStoreNames.contains('photos')) {
        db.createObjectStore('photos', { keyPath: 'brewId' });
      }
      if (!db.objectStoreNames.contains('thumbs')) {
        db.createObjectStore('thumbs', { keyPath: 'brewId' });
      }
      if (!db.objectStoreNames.contains('sync')) {
        db.createObjectStore('sync', { keyPath: 'brewId' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // 其他分頁要升級或刪除資料庫時，主動關閉連線避免卡住對方；下次存取會重新開啟
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    // 升級時若其他分頁還開著舊連線會先 blocked；對方關閉連線（onversionchange）後會自動繼續，不要 reject
    req.onblocked = () => console.warn('資料庫升級等待其他分頁關閉連線…');
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
export const getAllKeys = (store) => tx(store, 'readonly', (s) => s.getAllKeys());
export const get = (store, id) => tx(store, 'readonly', (s) => s.get(id));
export const put = (store, obj) => tx(store, 'readwrite', (s) => s.put(obj));
export const remove = (store, id) => tx(store, 'readwrite', (s) => s.delete(id));
export const getAllByIndex = (store, index, value) =>
  tx(store, 'readonly', (s) => s.index(index).getAll(value));
export const countByIndex = (store, index, value) =>
  tx(store, 'readonly', (s) => s.index(index).count(value));

/** meta store：簡單的鍵值存取 */
export const getMeta = async (key) => (await get('meta', key))?.value ?? null;
export const setMeta = (key, value) => put('meta', { key, value });

/**
 * 在多個 store 上開一個 readwrite 交易：fn({ storeName: IDBObjectStore }) 裡只能同步發出請求
 * 等交易完成才 resolve；任何一個請求失敗整個交易回滾
 */
export async function transact(storeNames, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeNames, 'readwrite');
    fn(Object.fromEntries(storeNames.map((name) => [name, t.objectStore(name)])));
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('交易中止'));
  });
}

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
