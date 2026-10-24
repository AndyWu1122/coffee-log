// 驗證、計算，以及提供給 views 的資料操作（views 只透過這裡存取資料）
import * as db from './db.js';
import { isFlavorNote, sortFlavorNotes } from './flavorWheel.js';
import { compressPhoto, makeThumb, blobToBase64, base64ToBytes, base64Length, jpegSize } from './image.js';

// views 只依賴 models，風味輪資料由這裡轉出
export { FLAVOR_WHEEL, flavorNote, sortFlavorNotes } from './flavorWheel.js';

// 備份檔格式版本。v2 加入 grinders 與 brews.grinderId；v3 加入 photos。匯入時接受所有舊版
export const SCHEMA_VERSION = 3;
const IMPORTABLE_VERSIONS = [1, 2, 3];

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
  const [brews, beans, grinders, thumbs] = await Promise.all([
    beanId ? db.getAllByIndex('brews', 'beanId', beanId) : db.getAll('brews'),
    db.getAll('beans'),
    db.getAll('grinders'),
    db.getAll('thumbs'), // 列表只讀縮圖，不碰原圖
  ]);
  const beanById = new Map(beans.map((b) => [b.id, b]));
  const grinderById = new Map(grinders.map((g) => [g.id, g]));
  const thumbById = new Map(thumbs.map((t) => [t.brewId, t.blob]));
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
        thumb: thumbById.get(brew.id) ?? null,
      };
    });
}

export const getBrew = (id) => db.get('brews', id);

/* ===== 照片（每筆紀錄最多 1 張） ===== */

const PHOTO_STORES = ['brews', 'photos', 'thumbs'];

/**
 * 使用者選的照片檔 → { blob, thumb, width, height }，可直接預覽，存檔時交給 saveBrew
 * 一律重新編碼成 JPEG（移除 EXIF）；無法解碼（例如不支援的 HEIC）會丟出錯誤，message 可直接顯示
 */
export const preparePhoto = (file) => compressPhoto(file);

/** { brewId, blob, width, height, createdAt } 或 undefined */
export const getPhoto = (brewId) => db.get('photos', brewId);

/**
 * 新增或更新紀錄；input 可直接是表單字串值。回傳 { ok, brew } 或 { ok: false, errors }
 * photo：undefined 不動照片；null 刪除照片；preparePhoto 的結果則存成這筆紀錄的照片
 * 紀錄與照片在同一個交易寫入
 */
export async function saveBrew(input, { photo } = {}) {
  const brew = normalizeBrew(input);
  const { ok, errors } = validateBrew(brew);
  if (ok && !(await db.get('beans', brew.beanId))) errors.beanId = '找不到這支豆子';
  if (brew.grinderId && !(await db.get('grinders', brew.grinderId))) errors.grinderId = '找不到這台磨豆機';
  if (photo && !(photo.blob instanceof Blob && photo.thumb instanceof Blob)) errors.photo = '照片資料錯誤，請重新選擇';
  if (Object.keys(errors).length) return { ok: false, errors };
  await db.transact(PHOTO_STORES, (s) => {
    s.brews.put(brew);
    if (photo === null) {
      s.photos.delete(brew.id);
      s.thumbs.delete(brew.id);
    } else if (photo) {
      const { blob, thumb, width, height } = photo;
      s.photos.put({ brewId: brew.id, blob, width, height, createdAt: new Date().toISOString() });
      s.thumbs.put({ brewId: brew.id, blob: thumb });
    }
  });
  return { ok: true, brew };
}

/** 刪除紀錄，連同照片、縮圖（同一個交易） */
export const deleteBrew = (id) => db.transact(PHOTO_STORES, (s) => {
  for (const store of Object.values(s)) store.delete(id);
});

/** 每支豆子最新一筆紀錄：Map<beanId, brew> */
export async function latestBrewByBean() {
  const latest = new Map();
  for (const brew of await db.getAll('brews')) {
    const cur = latest.get(brew.beanId);
    if (!cur || brew.brewedAt > cur.brewedAt) latest.set(brew.beanId, brew);
  }
  return latest;
}

/* ===== 備份提醒 ===== */

const BACKUP_REMIND_DAYS = 14; // 超過幾天沒備份就在首頁提醒
const BACKUP_SNOOZE_DAYS = 3;  // 按「稍後」後幾天內不再提醒

/**
 * 備份狀態：{ lastBackupAt, daysSince, remind }
 * remind：有紀錄，且距上次備份（沒備份過則從最早一筆紀錄起算）≥ 14 天，且不在「稍後」期間
 */
export async function getBackupStatus() {
  const [lastBackupAt, snoozeUntil, brews] = await Promise.all([
    db.getMeta('lastBackupAt'), db.getMeta('backupSnoozeUntil'), db.getAll('brews'),
  ]);
  const today = todayLocal();
  const daysSince = lastBackupAt ? daysBetween(toLocalDateStr(lastBackupAt), today) : null;
  const since = lastBackupAt ?? brews.reduce((min, b) => (!min || b.brewedAt < min ? b.brewedAt : min), null);
  const overdue = brews.length > 0 && since != null && daysBetween(toLocalDateStr(since), today) >= BACKUP_REMIND_DAYS;
  const snoozed = snoozeUntil != null && new Date() < new Date(snoozeUntil);
  return { lastBackupAt, daysSince, remind: overdue && !snoozed };
}

/** 匯出後呼叫：記下備份時間 */
export async function recordBackup() {
  await db.setMeta('lastBackupAt', new Date().toISOString());
  await db.setMeta('backupSnoozeUntil', null);
}

/** 首頁提醒按「稍後」：3 天內不再提醒 */
export const snoozeBackupReminder = () =>
  db.setMeta('backupSnoozeUntil', new Date(Date.now() + BACKUP_SNOOZE_DAYS * 86400000).toISOString());

/** 「今天」「昨天」「N 天前」 */
export const formatDaysAgo = (n) => (n === 0 ? '今天' : n === 1 ? '昨天' : `${n} 天前`);

/* ===== 備份：JSON 匯出匯入 ===== */

const MAX_PHOTO_BYTES = 2 * 1024 * 1024; // 匯入時單張照片上限（App 自己存的約 200KB）
const MAX_PHOTO_SIDE = 4096;             // 匯入時照片長寬上限（App 自己存的最長邊 1600）

/** 備份檔的照片欄位（data 為 base64 JPEG）；縮圖不匯出，匯入時重新產生 */
const photoMeta = (p) => ({ brewId: p.brewId, width: p.width, height: p.height, createdAt: p.createdAt });

/**
 * 匯出用的資料。includePhotos：false 時 photos 為空陣列，photosIncluded 標記為 false
 * （之後匯入「取代全部」時可以提醒這份備份不含照片）
 */
export async function exportData({ includePhotos = true } = {}) {
  const [beans, grinders, brews, photoRows] = await Promise.all([
    db.getAll('beans'), db.getAll('grinders'), db.getAll('brews'), includePhotos ? db.getAll('photos') : [],
  ]);
  const photos = [];
  for (const p of photoRows) photos.push({ ...photoMeta(p), data: await blobToBase64(p.blob) });
  return {
    schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), photosIncluded: includePhotos,
    beans, grinders, brews, photos,
  };
}

/**
 * 備份頁用的摘要：各類筆數，以及含照片／不含照片時的預估檔案大小（位元組）
 * 只讀照片的 Blob.size，不讀圖片內容
 */
export async function getBackupSummary() {
  const [beans, grinders, brews, photoRows] = await Promise.all([
    db.getAll('beans'), db.getAll('grinders'), db.getAll('brews'), db.getAll('photos'),
  ]);
  const base = { schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), photosIncluded: true, beans, grinders, brews };
  const bytes = (data) => new TextEncoder().encode(JSON.stringify(data, null, 2)).length; // 與 downloadJson 的格式一致
  const withoutPhotos = bytes({ ...base, photosIncluded: false, photos: [] });
  const withPhotos = bytes({ ...base, photos: photoRows.map((p) => ({ ...photoMeta(p), data: '' })) })
    + photoRows.reduce((s, p) => s + base64Length(p.blob.size), 0);
  return {
    beans: beans.length, grinders: grinders.length, brews: brews.length, photos: photoRows.length,
    sizeWithPhotos: withPhotos, sizeWithoutPhotos: withoutPhotos,
  };
}

/** 位元組 → 「約 3.4 MB」「約 120 KB」 */
export function formatBytes(n) {
  if (n >= 1024 * 1024) return `約 ${(n / 1024 / 1024).toFixed(1)} MB`;
  return `約 ${Math.max(1, Math.round(n / 1024))} KB`;
}

export const exportFileName = () => `coffee-log-${todayLocal()}.json`;

/**
 * 驗證備份檔裡的照片，回傳 { photos: [{ brewId, blob, width, height, createdAt }], errors }
 * 檢查：brewId 對得到紀錄且不重複、base64 正確、≤ 2MB、是合法 JPEG（檔頭解析得出尺寸）
 */
function parseImportPhotos(rawPhotos, knownBrewIds) {
  const errors = [];
  const photos = [];
  const seen = new Set();
  rawPhotos.forEach((input, i) => {
    const label = `第 ${i + 1} 張照片`;
    const brewId = input?.brewId;
    if (typeof brewId !== 'string' || !brewId) return errors.push(`${label}：缺少 brewId`);
    if (seen.has(brewId)) return errors.push(`${label}：同一筆紀錄有多張照片`);
    seen.add(brewId);
    if (!knownBrewIds.has(brewId)) return errors.push(`${label}：找不到對應的紀錄`);
    if (typeof input.data !== 'string') return errors.push(`${label}：缺少照片資料`);
    if (input.data.length > base64Length(MAX_PHOTO_BYTES)) return errors.push(`${label}：超過 2 MB 上限`);
    const bytes = base64ToBytes(input.data);
    if (!bytes) return errors.push(`${label}：照片資料損毀`);
    const size = jpegSize(bytes);
    if (!size) return errors.push(`${label}：不是合法的 JPEG 圖片`);
    if (size.width > MAX_PHOTO_SIDE || size.height > MAX_PHOTO_SIDE) return errors.push(`${label}：尺寸過大`);
    photos.push({
      brewId,
      blob: new Blob([bytes], { type: 'image/jpeg' }),
      ...size,
      createdAt: toIso(input.createdAt) ?? new Date().toISOString(),
    });
  });
  return { photos, errors };
}

/**
 * 匯入備份 JSON 文字。整份檔案都通過驗證才寫入（單一交易），否則完全不動。
 * replace：true 先清空現有資料（含照片）；false 依 id 合併（同 id 以檔案為準）
 * v1 檔案沒有 grinders，視為空陣列；brews 沒有 grinderId 會補成 ''；v1、v2 沒有 photos，視為空陣列
 * onProgress(n, total)：正在處理第 n 張照片（選填，給畫面顯示進度）
 * 回傳 { ok: true, beans, grinders, brews, photos }（筆數）或 { ok: false, errors: [訊息...] }
 */
export async function importData(text, { replace = false, onProgress } = {}) {
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
  if (data.photos === undefined) data.photos = []; // v1、v2，或匯出時沒勾「包含照片」的舊格式
  if (!Array.isArray(data.beans) || !Array.isArray(data.brews) || !Array.isArray(data.grinders)) {
    return { ok: false, errors: ['檔案缺少 beans、grinders 或 brews 資料'] };
  }
  if (!Array.isArray(data.photos)) return { ok: false, errors: ['檔案的 photos 格式錯誤'] };

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

  // 照片引用的紀錄必須在檔案裡；合併模式下也可以是資料庫裡已有的
  const knownBrewIds = new Set(brews.map((b) => b.id));
  if (!replace) for (const id of await db.getAllKeys('brews')) knownBrewIds.add(id);
  const parsed = parseImportPhotos(data.photos, knownBrewIds);
  errors.push(...parsed.errors);

  const fail = () => {
    const MAX = 5;
    const shown = errors.slice(0, MAX);
    if (errors.length > MAX) shown.push(`…另有 ${errors.length - MAX} 個錯誤`);
    return { ok: false, errors: shown };
  };
  if (errors.length) return fail();

  // 實際解碼每張照片並產生縮圖：解碼失敗代表檔案壞掉。全部完成才開始寫入
  // （IndexedDB 交易在 await 其他工作時會自動結束，所以不能邊解碼邊寫）
  const photos = parsed.photos;
  const thumbs = [];
  for (const [i, p] of photos.entries()) {
    onProgress?.(i + 1, photos.length);
    try {
      thumbs.push({ brewId: p.brewId, blob: await makeThumb(p.blob) });
    } catch {
      errors.push(`第 ${i + 1} 張照片：無法解碼`);
    }
  }
  if (errors.length) return fail();

  await db.bulkPut({ beans, grinders, brews, photos, thumbs }, { clear: replace });
  return { ok: true, beans: beans.length, grinders: grinders.length, brews: brews.length, photos: photos.length };
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
