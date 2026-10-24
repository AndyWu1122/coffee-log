// 驗證、計算，以及提供給 views 的資料操作（views 只透過這裡存取資料）
import * as db from './db.js';
import { isFlavorNote, sortFlavorNotes } from './flavorWheel.js';

// views 只依賴 models，風味輪資料由這裡轉出
export { FLAVOR_WHEEL, flavorNote, sortFlavorNotes } from './flavorWheel.js';

// 備份檔格式版本。v2 加入 grinders 與 brews.grinderId；匯入時仍接受 v1
export const SCHEMA_VERSION = 2;
const IMPORTABLE_VERSIONS = [1, 2];

export const PROCESS = { washed: '水洗', natural: '日曬', honey: '蜜處理', other: '其他' };
// 由淺到深排列
export const ROAST_LEVEL = {
  light: '淺焙', 'light-medium': '淺中焙', 'medium-light': '中淺焙', medium: '中焙', dark: '深焙',
};
export const FLAVOR = { acidity: '酸度', sweetness: '甜度', bitterness: '苦度', body: '醇厚度' };

/* ===== ID 與日期工具 ===== */

/** crypto.randomUUID 只在 secure context 可用；區網 http 測試時改用 getRandomValues 產生 v4 UUID */
export function newId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const pad = (n) => String(n).padStart(2, '0');

/** Date 或 ISO 字串 → 本地日期 YYYY-MM-DD */
export function toLocalDateStr(value = new Date()) {
  const d = new Date(value);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const todayLocal = () => toLocalDateStr(new Date());

/** ISO 字串 → datetime-local 輸入框用的 YYYY-MM-DDTHH:mm（本地時間） */
export function toLocalInputValue(iso = new Date()) {
  const d = new Date(iso);
  return `${toLocalDateStr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local 的值（無時區，視為本地時間）→ ISO 字串 */
export function fromLocalInputValue(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function isValidDateStr(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** 兩個 YYYY-MM-DD 相差天數（用 UTC 計算，避開夏令時間誤差） */
function daysBetween(fromStr, toStr) {
  const toUTC = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((toUTC(toStr) - toUTC(fromStr)) / 86400000);
}

/* ===== 衍生值計算（不儲存） ===== */

/** 粉水比 waterG / coffeeG；資料不足回傳 null */
export function ratio({ coffeeG, waterG } = {}) {
  return coffeeG > 0 && waterG > 0 ? waterG / coffeeG : null;
}

export const formatRatio = (r) => (r == null ? '—' : `1:${r.toFixed(1)}`);

/** 養豆天數 = 沖煮日（本地日期）− 烘焙日 */
export function restDays(brewedAt, roastDate) {
  if (!brewedAt || !roastDate || !isValidDateStr(roastDate)) return null;
  return daysBetween(roastDate, toLocalDateStr(brewedAt));
}

/** 秒 → m:ss */
export function formatSeconds(s) {
  if (s == null || Number.isNaN(s)) return '';
  return `${Math.floor(s / 60)}:${pad(Math.round(s % 60))}`;
}

/** 分、秒欄位（字串）→ 總秒數；兩者皆空回傳 null，格式錯誤回傳 NaN */
export function toSeconds(min, sec) {
  if (min === '' && sec === '') return null;
  const m = min === '' ? 0 : Number(min);
  const s = sec === '' ? 0 : Number(sec);
  if (!Number.isInteger(m) || !Number.isInteger(s) || m < 0 || s < 0 || s > 59) return NaN;
  return m * 60 + s;
}

/* ===== 驗證 ===== */

/** 表單字串 → 數字；空值回傳 null */
const toNum = (v) => (v === '' || v == null ? null : Number(v));
const inRange = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;

export function validateBean(b) {
  const errors = {};
  if (!b.name?.trim()) errors.name = '請輸入豆子名稱';
  if (!Object.hasOwn(PROCESS, b.process ?? '')) errors.process = '請選擇處理法';
  if (!Object.hasOwn(ROAST_LEVEL, b.roastLevel ?? '')) errors.roastLevel = '請選擇烘焙度';
  if (b.roastDate) {
    if (!isValidDateStr(b.roastDate)) errors.roastDate = '日期格式錯誤';
    else if (b.roastDate > todayLocal()) errors.roastDate = '烘焙日不能晚於今天';
  }
  if (b.bagWeightG != null && !(b.bagWeightG > 0)) errors.bagWeightG = '整包重量需大於 0';
  return { ok: Object.keys(errors).length === 0, errors };
}

export function validateBrew(b) {
  const errors = {};
  if (!b.beanId) errors.beanId = '請選擇豆子';
  if (!b.brewedAt || Number.isNaN(new Date(b.brewedAt).getTime())) errors.brewedAt = '請輸入沖煮時間';
  if (!(b.coffeeG > 0)) errors.coffeeG = '粉量需大於 0';
  if (!(b.waterG > 0)) errors.waterG = '水量需大於 0';
  if (b.tempC != null && !inRange(b.tempC, 70, 100)) errors.tempC = '水溫需介於 70–100°C';
  if (b.totalTimeS != null && !(Number.isInteger(b.totalTimeS) && b.totalTimeS >= 0)) {
    errors.totalTimeS = '請輸入正確的分、秒（秒為 0–59）';
  }
  if (b.rating != null && !inRange(b.rating, 1, 5)) errors.rating = '評分需為 1–5';
  for (const key of Object.keys(FLAVOR)) {
    const v = b.flavor?.[key];
    if (v != null && !inRange(v, 1, 5)) errors[`flavor.${key}`] = '需為 1–5';
  }
  if (!Array.isArray(b.flavorNotes) || !b.flavorNotes.every(isFlavorNote)) {
    errors.flavorNotes = '包含不認得的風味';
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

export function validateGrinder(g) {
  const errors = {};
  if (!g.name?.trim()) errors.name = '請輸入磨豆機名稱';
  return { ok: Object.keys(errors).length === 0, errors };
}

/* ===== 正規化：表單值或匯入的 JSON → 要存進 DB 的物件（只留規格內的欄位） ===== */

const toIso = (v) => {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
};

function normalizeBean(input) {
  return {
    id: input.id || newId(),
    name: String(input.name ?? '').trim(),
    origin: String(input.origin ?? '').trim(),
    process: input.process,
    roastLevel: input.roastLevel,
    roastDate: input.roastDate || '',
    bagWeightG: toNum(input.bagWeightG), // 整包重量（選填）；剩餘量由紀錄的粉量算出，不另外儲存
    archived: Boolean(input.archived),
    createdAt: toIso(input.createdAt) ?? new Date().toISOString(),
  };
}

function normalizeBrew(input) {
  return {
    id: input.id || newId(),
    beanId: input.beanId || '',
    grinderId: input.grinderId || '', // 空字串＝未指定；舊紀錄沒有這個欄位
    brewedAt: toIso(input.brewedAt),
    dripper: String(input.dripper ?? '').trim(),
    grindSetting: String(input.grindSetting ?? '').trim(),
    coffeeG: toNum(input.coffeeG),
    waterG: toNum(input.waterG),
    tempC: toNum(input.tempC),
    totalTimeS: toNum(input.totalTimeS),
    rating: toNum(input.rating),
    flavor: Object.fromEntries(Object.keys(FLAVOR).map((k) => [k, toNum(input.flavor?.[k])])),
    // 風味輪選到的風味（依輪盤順序）；未知的 key 保留，交給驗證擋下
    flavorNotes: Array.isArray(input.flavorNotes)
      ? [...sortFlavorNotes(input.flavorNotes), ...input.flavorNotes.filter((k) => !isFlavorNote(k))]
      : [],
    notes: String(input.notes ?? '').trim(),
  };
}

function normalizeGrinder(input) {
  return {
    id: input.id || newId(),
    name: String(input.name ?? '').trim(),
    notes: String(input.notes ?? '').trim(),
    archived: Boolean(input.archived),
    createdAt: toIso(input.createdAt) ?? new Date().toISOString(),
  };
}

/** 未封存在前，再依建立時間新→舊（豆子、磨豆機共用） */
const byArchivedThenNewest = (a, b) =>
  Number(a.archived) - Number(b.archived) || b.createdAt.localeCompare(a.createdAt);

/* ===== 豆子 ===== */

/* ===== 豆子剩餘量（衍生值，不儲存） ===== */

const RECENT_CUPS = 5; // 估算「約幾杯」用最近幾杯的平均粉量
const LOW_CUPS = 2;    // 剩這麼多杯以下顯示「快沒了」

const newestFirst = (a, b) => b.brewedAt.localeCompare(a.brewedAt);
const recentAvgDose = (brews) => {
  const doses = [...brews].sort(newestFirst).slice(0, RECENT_CUPS).map((b) => b.coffeeG).filter((g) => g > 0);
  return doses.length ? doses.reduce((s, g) => s + g, 0) / doses.length : null;
};

/**
 * 豆子剩餘量：整包重量 − 這支豆子所有紀錄的粉量
 * 每杯用量：這支豆子最近 5 杯的平均；還沒沖過就用全部紀錄最近 5 杯的平均；都沒有則不估杯數
 * 沒填整包重量回傳 null
 */
export function beanStock(bean, beanBrews, allBrews) {
  if (!(bean.bagWeightG > 0)) return null;
  const round1 = (g) => Math.round(g * 10) / 10; // 避免 15.5 + 0.1 這類浮點誤差讓「已用完」判斷失準
  const usedG = round1(beanBrews.reduce((s, b) => s + (b.coffeeG || 0), 0));
  const remainingG = round1(bean.bagWeightG - usedG);
  const doseG = recentAvgDose(beanBrews) ?? recentAvgDose(allBrews);
  const cupsLeft = doseG ? Math.floor(Math.max(remainingG, 0) / doseG) : null;
  return {
    usedG,
    usedCups: beanBrews.length,
    remainingG,
    cupsLeft,
    empty: remainingG <= 0,
    low: remainingG > 0 && cupsLeft != null && cupsLeft <= LOW_CUPS,
  };
}

/** 克數顯示：最多一位小數（15.5g、85g） */
export const formatGrams = (g) => `${Number(g.toFixed(1))}g`;

/** 剩餘量文字：「剩 85g，約 5 杯」「已用完」「已用完（超出 12g）」；short 只給克數（下拉選單用） */
export function formatStock(stock, { short = false } = {}) {
  if (!stock) return '';
  if (stock.remainingG < 0) return short ? '已用完' : `已用完（超出 ${formatGrams(-stock.remainingG)}）`;
  if (stock.remainingG === 0) return '已用完';
  const grams = `剩 ${formatGrams(stock.remainingG)}`;
  if (short || stock.cupsLeft == null) return grams;
  return stock.cupsLeft === 0 ? `${grams}，不到 1 杯` : `${grams}，約 ${stock.cupsLeft} 杯`;
}

/** 豆子列表：未封存在前，再依建立時間新→舊；附上「烘焙至今天數」與剩餘量 stock */
export async function listBeans({ includeArchived = false } = {}) {
  const [beans, brews] = await Promise.all([db.getAll('beans'), db.getAll('brews')]);
  const brewsByBean = new Map(); // 不用 Map.groupBy：較舊的 iOS Safari 不支援
  for (const b of brews) {
    if (!brewsByBean.has(b.beanId)) brewsByBean.set(b.beanId, []);
    brewsByBean.get(b.beanId).push(b);
  }
  return beans
    .filter((b) => includeArchived || !b.archived)
    .sort(byArchivedThenNewest)
    .map((b) => ({
      ...b,
      daysSinceRoast: restDays(new Date(), b.roastDate),
      stock: beanStock(b, brewsByBean.get(b.id) ?? [], brews),
    }));
}

/** 單一豆子的剩餘量（豆子編輯頁用） */
export async function getBeanStock(id) {
  const [bean, beanBrews, allBrews] = await Promise.all([
    db.get('beans', id), db.getAllByIndex('brews', 'beanId', id), db.getAll('brews'),
  ]);
  return bean ? beanStock(bean, beanBrews, allBrews) : null;
}

export const getBean = (id) => db.get('beans', id);

/** 新增或更新豆子；回傳 { ok, bean } 或 { ok: false, errors } */
export async function saveBean(input) {
  const existing = input.id ? await db.get('beans', input.id) : null;
  // id、封存狀態、建立時間沿用既有資料，不由表單決定
  const bean = normalizeBean({
    ...input, id: existing?.id, archived: existing?.archived, createdAt: existing?.createdAt,
  });
  const { ok, errors } = validateBean(bean);
  if (!ok) return { ok, errors };
  await db.put('beans', bean);
  return { ok: true, bean };
}

export async function setBeanArchived(id, archived) {
  const bean = await db.get('beans', id);
  if (!bean) throw new Error('找不到這支豆子');
  await db.put('beans', { ...bean, archived: Boolean(archived) });
}

/** 有紀錄引用的豆子不可刪除 */
export async function deleteBean(id) {
  const count = await db.countByIndex('brews', 'beanId', id);
  if (count > 0) {
    return { ok: false, message: `這支豆子有 ${count} 筆沖煮紀錄，無法刪除，請改用「封存」` };
  }
  await db.remove('beans', id);
  return { ok: true };
}

/* ===== 磨豆機 ===== */

export async function listGrinders({ includeArchived = false } = {}) {
  const grinders = await db.getAll('grinders');
  return grinders.filter((g) => includeArchived || !g.archived).sort(byArchivedThenNewest);
}

export const getGrinder = (id) => db.get('grinders', id);

/** 新增或更新磨豆機；回傳 { ok, grinder } 或 { ok: false, errors } */
export async function saveGrinder(input) {
  const existing = input.id ? await db.get('grinders', input.id) : null;
  const grinder = normalizeGrinder({
    ...input, id: existing?.id, archived: existing?.archived, createdAt: existing?.createdAt,
  });
  const { ok, errors } = validateGrinder(grinder);
  if (!ok) return { ok, errors };
  await db.put('grinders', grinder);
  return { ok: true, grinder };
}

export async function setGrinderArchived(id, archived) {
  const grinder = await db.get('grinders', id);
  if (!grinder) throw new Error('找不到這台磨豆機');
  await db.put('grinders', { ...grinder, archived: Boolean(archived) });
}

/** 有紀錄引用的磨豆機不可刪除 */
export async function deleteGrinder(id) {
  const count = await db.countByIndex('brews', 'grinderId', id);
  if (count > 0) {
    return { ok: false, message: `這台磨豆機有 ${count} 筆沖煮紀錄，無法刪除，請改用「封存」` };
  }
  await db.remove('grinders', id);
  return { ok: true };
}

/**
 * 新紀錄預設的磨豆機：最近一筆紀錄用的那台（需存在且未封存），否則第一台；都沒有回傳 ''
 */
export async function defaultGrinderId() {
  const [brews, grinders] = await Promise.all([db.getAll('brews'), listGrinders()]);
  const latest = brews.reduce((cur, b) => (!cur || b.brewedAt > cur.brewedAt ? b : cur), null);
  if (latest?.grinderId && grinders.some((g) => g.id === latest.grinderId)) return latest.grinderId;
  return grinders[0]?.id ?? '';
}

/* ===== 沖煮紀錄 ===== */

/**
 * 紀錄列表：依 brewedAt 新→舊，附上豆名、磨豆機名稱、粉水比、養豆天數
 * 篩選：beanId 指定豆子；minRating 只列評分 ≥ 此值（未評分的不列）
 */
export async function listBrews({ beanId = '', minRating = null } = {}) {
  const [brews, beans, grinders] = await Promise.all([
    beanId ? db.getAllByIndex('brews', 'beanId', beanId) : db.getAll('brews'),
    db.getAll('beans'),
    db.getAll('grinders'),
  ]);
  const beanById = new Map(beans.map((b) => [b.id, b]));
  const grinderById = new Map(grinders.map((g) => [g.id, g]));
  return brews
    .filter((b) => !minRating || (b.rating ?? 0) >= minRating)
    .sort((a, b) => b.brewedAt.localeCompare(a.brewedAt))
    .map((brew) => {
      const bean = beanById.get(brew.beanId);
      return {
        ...brew,
        beanName: bean?.name ?? '（已刪除的豆子）',
        grinderName: grinderById.get(brew.grinderId)?.name ?? '',
        ratio: ratio(brew),
        restDays: restDays(brew.brewedAt, bean?.roastDate),
      };
    });
}

export const getBrew = (id) => db.get('brews', id);

/** 新增或更新紀錄；input 可直接是表單字串值。回傳 { ok, brew } 或 { ok: false, errors } */
export async function saveBrew(input) {
  const brew = normalizeBrew(input);
  const { ok, errors } = validateBrew(brew);
  if (ok && !(await db.get('beans', brew.beanId))) errors.beanId = '找不到這支豆子';
  if (brew.grinderId && !(await db.get('grinders', brew.grinderId))) errors.grinderId = '找不到這台磨豆機';
  if (Object.keys(errors).length) return { ok: false, errors };
  await db.put('brews', brew);
  return { ok: true, brew };
}

export const deleteBrew = (id) => db.remove('brews', id);

/** 每支豆子最新一筆紀錄：Map<beanId, brew> */
export async function latestBrewByBean() {
  const latest = new Map();
  for (const brew of await db.getAll('brews')) {
    const cur = latest.get(brew.beanId);
    if (!cur || brew.brewedAt > cur.brewedAt) latest.set(brew.beanId, brew);
  }
  return latest;
}

/* ===== 備份：JSON 匯出匯入 ===== */

export async function exportData() {
  const [beans, grinders, brews] = await Promise.all([db.getAll('beans'), db.getAll('grinders'), db.getAll('brews')]);
  return { schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), beans, grinders, brews };
}

export const exportFileName = () => `coffee-log-${todayLocal()}.json`;

/**
 * 匯入備份 JSON 文字。整份檔案都通過驗證才寫入（單一交易），否則完全不動。
 * replace：true 先清空現有資料；false 依 id 合併（同 id 以檔案為準）
 * v1 檔案沒有 grinders，視為空陣列；brews 沒有 grinderId 會補成 ''
 * 回傳 { ok: true, beans, grinders, brews }（筆數）或 { ok: false, errors: [訊息...] }
 */
export async function importData(text, { replace = false } = {}) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['不是有效的 JSON 檔案'] };
  }
  if (!IMPORTABLE_VERSIONS.includes(data?.schemaVersion)) {
    return { ok: false, errors: [`不支援的資料版本：${data?.schemaVersion ?? '無'}（目前為 ${SCHEMA_VERSION}）`] };
  }
  if (data.schemaVersion === 1 && data.grinders === undefined) data.grinders = [];
  if (!Array.isArray(data.beans) || !Array.isArray(data.brews) || !Array.isArray(data.grinders)) {
    return { ok: false, errors: ['檔案缺少 beans、grinders 或 brews 資料'] };
  }

  const errors = [];
  const describe = (errs) => Object.values(errs).join('、');

  const beans = data.beans.map((input, i) => {
    const bean = normalizeBean(input ?? {});
    const label = `第 ${i + 1} 支豆子「${bean.name || '未命名'}」`;
    if (!input?.id) errors.push(`${label}：缺少 id`);
    const v = validateBean(bean);
    if (!v.ok) errors.push(`${label}：${describe(v.errors)}`);
    return bean;
  });

  const grinders = data.grinders.map((input, i) => {
    const grinder = normalizeGrinder(input ?? {});
    const label = `第 ${i + 1} 台磨豆機「${grinder.name || '未命名'}」`;
    if (!input?.id) errors.push(`${label}：缺少 id`);
    const v = validateGrinder(grinder);
    if (!v.ok) errors.push(`${label}：${describe(v.errors)}`);
    return grinder;
  });

  // 紀錄引用的豆子、磨豆機必須在檔案裡；合併模式下也可以是資料庫裡已有的
  const knownBeanIds = new Set(beans.map((b) => b.id));
  const knownGrinderIds = new Set(grinders.map((g) => g.id));
  if (!replace) {
    for (const b of await db.getAll('beans')) knownBeanIds.add(b.id);
    for (const g of await db.getAll('grinders')) knownGrinderIds.add(g.id);
  }

  const brews = data.brews.map((input, i) => {
    const brew = normalizeBrew(input ?? {});
    const label = `第 ${i + 1} 筆紀錄`;
    if (!input?.id) errors.push(`${label}：缺少 id`);
    const v = validateBrew(brew);
    if (!v.ok) errors.push(`${label}：${describe(v.errors)}`);
    else if (!knownBeanIds.has(brew.beanId)) errors.push(`${label}：找不到對應的豆子`);
    else if (brew.grinderId && !knownGrinderIds.has(brew.grinderId)) errors.push(`${label}：找不到對應的磨豆機`);
    return brew;
  });

  if (errors.length) {
    const MAX = 5;
    const shown = errors.slice(0, MAX);
    if (errors.length > MAX) shown.push(`…另有 ${errors.length - MAX} 個錯誤`);
    return { ok: false, errors: shown };
  }

  await db.bulkPut({ beans, grinders, brews }, { clear: replace });
  return { ok: true, beans: beans.length, grinders: grinders.length, brews: brews.length };
}

/** 「再沖一杯」要複製的參數；評分、風味、筆記、總時間是每杯的結果，不複製 */
export function brewTemplateFrom(brew) {
  const { beanId, grinderId = '', dripper, grindSetting, coffeeG, waterG, tempC } = brew;
  return { beanId, grinderId, dripper, grindSetting, coffeeG, waterG, tempC };
}

/** 最近用過的濾杯名稱（不重複），給表單的建議清單 */
export async function listRecentDrippers(limit = 10) {
  const brews = await db.getAll('brews');
  const names = brews
    .sort((a, b) => b.brewedAt.localeCompare(a.brewedAt))
    .map((b) => b.dripper)
    .filter(Boolean);
  return [...new Set(names)].slice(0, limit);
}
