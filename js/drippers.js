// 舊紀錄的濾杯文字（brews.dripper）→ drippers 清單與 brews.dripperId（純函式，不 import 任何東西，Node 可直接測）
// db.js 的 v6 升級轉換、models.js 匯入沒有 drippers 的舊備份共用同一套規則

/** 合併用的 key：去掉所有空白、忽略大小寫（「V60」「v60」「V 60」相同）；'' ＝未指定 */
export const dripperKey = (text) => String(text ?? '').replace(/\s+/g, '').toLowerCase();

/**
 * 從紀錄的濾杯文字建立濾杯
 * 只處理還沒有 dripperId 的紀錄（dripperId === undefined）；文字是空的對應到 ''（未指定）
 * 名稱：同一組裡出現最多次的寫法（去掉前後空白），同票取最近一杯用的寫法
 * existing：已經有的濾杯（含封存），key 相同就沿用它的 id、不新建
 * 回傳 { drippers: [新建的濾杯], idByBrew: Map<brewId, dripperId> }
 */
export function mergeDripperNames(brews, { existing = [], makeId }) {
  const groups = new Map(); // key → { spellings: Map<寫法, { count, last }>, first }
  const keyByBrew = new Map();
  for (const b of brews) {
    if (b.dripperId !== undefined) continue;
    const text = String(b.dripper ?? '').trim();
    const key = dripperKey(text);
    keyByBrew.set(b.id, key);
    if (!key) continue;
    const g = groups.get(key) ?? { spellings: new Map(), first: null };
    const s = g.spellings.get(text) ?? { count: 0, last: '' };
    s.count++;
    if ((b.brewedAt ?? '') > s.last) s.last = b.brewedAt ?? '';
    g.spellings.set(text, s);
    if (b.brewedAt && (!g.first || b.brewedAt < g.first)) g.first = b.brewedAt;
    groups.set(key, g);
  }

  const idByKey = new Map();
  for (const d of existing) {
    const key = dripperKey(d.name);
    if (key && !idByKey.has(key)) idByKey.set(key, d.id);
  }
  const drippers = [];
  for (const [key, g] of groups) {
    if (idByKey.has(key)) continue;
    const [name] = [...g.spellings].sort(([, a], [, b]) => b.count - a.count || b.last.localeCompare(a.last))[0];
    const dripper = { id: makeId(), name, notes: '', archived: false, createdAt: g.first ?? new Date().toISOString() };
    drippers.push(dripper);
    idByKey.set(key, dripper.id);
  }

  const idByBrew = new Map([...keyByBrew].map(([brewId, key]) => [brewId, key ? idByKey.get(key) : '']));
  return { drippers, idByBrew };
}
