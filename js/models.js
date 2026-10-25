// 驗證、計算，以及提供給 views 的資料操作（views 只透過這裡存取資料）
import * as db from './db.js';
import { isFlavorNote, sortFlavorNotes, flavorNote } from './flavorWheel.js';
import { compressPhoto, compressAvatar, makeThumb, blobToBase64, base64ToBytes, base64Length, jpegSize, PHOTO_TYPES } from './image.js';
import { shareFileName } from './cardLayout.js';
import { CHANGELOG, compareVersions } from './changelog.js';
import * as cloud from './cloud.js';
import * as sync from './sync.js';

// views 只依賴 models，風味輪資料、圖片解碼、分享卡片的計算由這裡轉出
export { FLAVOR_WHEEL, flavorNote, sortFlavorNotes } from './flavorWheel.js';
export { CHANGELOG } from './changelog.js';
export { decodeImage, photoForUpload } from './image.js';
export { coverCrop, radarPoints, wrapText, layoutChips } from './cardLayout.js';
export { cloudPhotoPath } from './sync.js';

// 備份檔格式版本。v2 加入 grinders 與 brews.grinderId；v3 加入 photos。匯入時接受所有舊版
export const SCHEMA_VERSION = 3;
const IMPORTABLE_VERSIONS = [1, 2, 3];

export const PROCESS = { washed: '水洗', natural: '日曬', honey: '蜜處理', other: '其他' };
// 由淺到深排列
export const ROAST_LEVEL = {
  light: '淺焙', 'light-medium': '淺中焙', 'medium-light': '中淺焙', medium: '中焙', dark: '深焙',
};
export const FLAVOR = { acidity: '酸度', sweetness: '甜度', bitterness: '苦度', body: '醇厚度' };
// 紀錄的可見度：private 只存在這支手機（預設）；friends 同步到雲端給好友看
export const VISIBILITY = { private: '只有我', friends: '好友' };

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
  if (b.visibility === 'friends') {
    for (const [key, msg] of Object.entries(sharedLimitErrors(b))) errors[key] ??= msg; // 基本錯誤優先顯示
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

// 分享給好友的紀錄要符合雲端資料庫的限制（shared_brews 的 check 約束），否則同步時會被拒絕
const SHARED_NOTES_MAX = 500;
const SHARED_TEXT_MAX = 100;         // 濾杯、研磨度，以及跟著紀錄上傳的豆子名稱、產地、磨豆機名稱
const SHARED_FLAVOR_NOTES_MAX = 30;
const charLength = (s) => [...String(s ?? '')].length; // 和資料庫的 char_length 一樣以字元計
function sharedLimitErrors(b) {
  const errors = {};
  if (charLength(b.notes) > SHARED_NOTES_MAX) errors.notes = `分享給好友的筆記最多 ${SHARED_NOTES_MAX} 字（目前 ${charLength(b.notes)} 字）`;
  if (b.coffeeG > 100) errors.coffeeG = '分享給好友時粉量最多 100g';
  if (b.waterG > 2000) errors.waterG = '分享給好友時水量最多 2000g';
  if (b.totalTimeS > 3600) errors.totalTimeS = '分享給好友時總時間最多 60 分鐘';
  if (charLength(b.dripper) > SHARED_TEXT_MAX) errors.dripper = `分享給好友時最多 ${SHARED_TEXT_MAX} 字`;
  if (charLength(b.grindSetting) > SHARED_TEXT_MAX) errors.grindSetting = `分享給好友時最多 ${SHARED_TEXT_MAX} 字`;
  if (b.flavorNotes?.length > SHARED_FLAVOR_NOTES_MAX) {
    errors.flavorNotes = `分享給好友時風味輪最多選 ${SHARED_FLAVOR_NOTES_MAX} 個（目前 ${b.flavorNotes.length} 個）`;
  }
  if (b.brewedAt && new Date(b.brewedAt) > new Date(Date.now() + 86400000)) errors.brewedAt = '分享給好友的紀錄，沖煮時間不能是未來';
  return errors;
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
    visibility: input.visibility === 'friends' ? 'friends' : 'private', // 舊紀錄沒有這個欄位：只有我
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

/**
 * 豆子、磨豆機的名稱會跟著分享的紀錄上傳，表單存檔時就限制在雲端的上限內
 * 不放進 validateBean／validateGrinder：匯入舊備份不擋（分享時 saveBrew 會再檢查）
 */
function nameLengthErrors(obj, keys) {
  const errors = {};
  for (const key of keys) if (charLength(obj[key]) > SHARED_TEXT_MAX) errors[key] = `最多 ${SHARED_TEXT_MAX} 字`;
  return errors;
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
  const errors = { ...nameLengthErrors(bean, ['name', 'origin']), ...validateBean(bean).errors };
  if (Object.keys(errors).length) return { ok: false, errors };
  await db.put('beans', bean);
  requestSync(); // 分享出去的紀錄帶著豆子名稱等資訊
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
  const errors = { ...nameLengthErrors(grinder, ['name']), ...validateGrinder(grinder).errors };
  if (Object.keys(errors).length) return { ok: false, errors };
  await db.put('grinders', grinder);
  requestSync(); // 分享出去的紀錄帶著磨豆機名稱
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
 * 只接受 JPEG／PNG／WebP，一律重新編碼成 JPEG（移除 EXIF）；格式不對或無法解碼會丟出錯誤，message 可直接顯示
 */
export const preparePhoto = (file) => compressPhoto(file);

/** 照片 <input type="file"> 的 accept */
export const PHOTO_ACCEPT = PHOTO_TYPES.join(',');

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
  const bean = ok ? await db.get('beans', brew.beanId) : null;
  if (ok && !bean) errors.beanId = '找不到這支豆子';
  const grinder = brew.grinderId ? await db.get('grinders', brew.grinderId) : null;
  if (brew.grinderId && !grinder) errors.grinderId = '找不到這台磨豆機';
  if (brew.visibility === 'friends') {
    // 豆子、磨豆機的名稱跟著紀錄上傳，也要符合雲端的限制（舊資料或匯入的可能超過）
    if (bean && (charLength(bean.name) > SHARED_TEXT_MAX || charLength(bean.origin) > SHARED_TEXT_MAX)) {
      errors.beanId ??= `分享給好友時，豆子的名稱和產地最多 ${SHARED_TEXT_MAX} 字，請先到豆子頁修改`;
    }
    if (grinder && charLength(grinder.name) > SHARED_TEXT_MAX) {
      errors.grinderId ??= `分享給好友時，磨豆機名稱最多 ${SHARED_TEXT_MAX} 字，請先到磨豆機頁修改`;
    }
  }
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
  requestSync();
  return { ok: true, brew };
}

/* ===== 分享卡片 ===== */

/**
 * 分享卡片需要的資料（中文標籤、衍生值都算好）；找不到紀錄回傳 null
 * 數值欄位保留原值（null＝沒填），由卡片決定要不要顯示
 */
export async function getShareCardData(id) {
  const brew = await db.get('brews', id);
  if (!brew) return null;
  const [bean, grinder, photo] = await Promise.all([
    db.get('beans', brew.beanId),
    brew.grinderId ? db.get('grinders', brew.grinderId) : null,
    db.get('photos', id),
  ]);
  const date = toLocalDateStr(brew.brewedAt);
  return {
    beanName: bean?.name ?? '（已刪除的豆子）',
    origin: bean?.origin ?? '',
    process: PROCESS[bean?.process] ?? '',
    roastLevel: ROAST_LEVEL[bean?.roastLevel] ?? '',
    restDays: restDays(brew.brewedAt, bean?.roastDate),
    date,
    coffeeG: brew.coffeeG,
    waterG: brew.waterG,
    ratio: ratio(brew),
    tempC: brew.tempC ?? null,
    totalTimeS: brew.totalTimeS ?? null,
    dripper: brew.dripper ?? '',
    grinderName: grinder?.name ?? '',
    grindSetting: brew.grindSetting ?? '',
    rating: brew.rating ?? null,
    flavor: Object.fromEntries(Object.keys(FLAVOR).map((k) => [k, brew.flavor?.[k] ?? null])),
    // 風味輪選的風味（依輪盤順序）：選到哪一層就顯示那一層的名稱，顏色是所屬大類的顏色
    flavorNotes: sortFlavorNotes(brew.flavorNotes ?? []).map(flavorNote).map(({ zh, color }) => ({ zh, color })),
    notes: brew.notes ?? '',
    photo: photo ?? null, // { blob, width, height, … }
    fileName: shareFileName(bean?.name, date),
  };
}

/** 刪除紀錄，連同照片、縮圖（同一個交易）；分享出去的會在同步時從雲端刪除 */
export async function deleteBrew(id) {
  await db.transact(PHOTO_STORES, (s) => {
    for (const store of Object.values(s)) store.delete(id);
  });
  requestSync();
}

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
 * 備份狀態：{ lastBackupAt, daysSince, overdue, remind }
 * overdue：有紀錄，且距上次備份（沒備份過則從最早一筆紀錄起算）≥ 14 天（☰ 和「備份」的「!」，按「稍後」也照樣顯示）
 * remind：overdue 且不在「稍後」期間（首頁的提醒卡片）
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
  return { lastBackupAt, daysSince, overdue, remind: overdue && !snoozed };
}

/** 匯出後呼叫：記下備份時間 */
export async function recordBackup() {
  await db.setMeta('lastBackupAt', new Date().toISOString());
  await db.setMeta('backupSnoozeUntil', null);
}

/** 首頁提醒按「稍後」：3 天內不再提醒 */
export const snoozeBackupReminder = () =>
  db.setMeta('backupSnoozeUntil', new Date(Date.now() + BACKUP_SNOOZE_DAYS * 86400000).toISOString());

/* ===== 更新內容（js/changelog.js） ===== */

const CHANGELOG_SEEN_KEY = 'changelogSeen'; // 看過哪一版的更新內容（版本號字串）

/**
 * 更新內容的狀態：{ unseen: 有沒有還沒看過的新版說明, seen: 上次看過的版本（沒有＝null） }
 * version：目前在跑的版本（ui.appVersion；沒有 Service Worker 時是 null，一律不提示）
 * 還沒記過的話：全新安裝（沒有任何豆子、紀錄）直接記成目前版本、不提示；已經在用的人算「剛更新」
 */
export async function getChangelogStatus(version) {
  if (!version) return { unseen: false, seen: null };
  const seen = await db.getMeta(CHANGELOG_SEEN_KEY);
  if (seen == null) {
    const [brews, beans] = await Promise.all([db.getAll('brews'), db.getAll('beans')]);
    if (!brews.length && !beans.length) {
      await db.setMeta(CHANGELOG_SEEN_KEY, version);
      return { unseen: false, seen: version };
    }
  }
  // 目前版本要有寫更新內容才提示（只看得到舊版說明的話不提示）
  const hasEntry = CHANGELOG.some((e) => e.version === version);
  return { unseen: hasEntry && compareVersions(version, seen) > 0, seen };
}

/** 看過了（打開更新內容頁、或關掉「已更新」的提示） */
export const markChangelogSeen = (version) => db.setMeta(CHANGELOG_SEEN_KEY, version);

/** 這一段比上次看過的版本新（更新內容頁標「新」） */
export const isNewerThan = (version, seen) => compareVersions(version, seen) > 0;

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
  requestSync(); // 本機為準：取代全部後，雲端上這台裝置分享過、現在不在的紀錄會被刪除
  return { ok: true, beans: beans.length, grinders: grinders.length, brews: brews.length, photos: photos.length };
}

/** 「再沖一杯」要複製的參數；評分、風味、筆記、總時間是每杯的結果，不複製；可見度一律回到預設（只有我） */
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

/* ===== 咖啡社群（雲端；只透過 cloud.js 存取） ===== */

/** 這個環境有沒有社群功能（js/config.js 沒設定就沒有，☰ 選單不顯示） */
export const socialAvailable = cloud.available;

// 登入狀態（supabase-js 的 session）存在 meta，key 前綴 auth:
// meta 不會被匯出到備份檔（token 不會外流），「取代全部」匯入也不會清掉（不會被登出）
const AUTH_PREFIX = 'auth:';
cloud.configure({
  storage: {
    getItem: (key) => db.getMeta(AUTH_PREFIX + key),
    setItem: (key, value) => db.setMeta(AUTH_PREFIX + key, value),
    removeItem: (key) => db.remove('meta', AUTH_PREFIX + key),
  },
});

/** 雲端錯誤 → 可直接顯示的訊息 */
export function socialErrorMessage(err) {
  if (err instanceof cloud.CloudError && ['network', 'load', 'unavailable'].includes(err.code)) return err.message;
  if (err?.code === '23514') return '內容不符合規定，請修改後再試';
  if (err?.code === 'P0001') return '操作太頻繁，請稍後再試';
  console.error(err);
  return '發生錯誤，請稍後再試';
}

const toProfile = (p, urls = {}) => ({
  id: p.id, nickname: p.nickname, friendCode: p.friend_code, hasAvatar: Boolean(p.avatar_path), avatarUrl: urls[p.avatar_path] ?? null,
});

/**
 * 目前的社群狀態：
 *   { status: 'unavailable' }                      這個環境沒有社群功能
 *   { status: 'signed-out' }                       沒登入
 *   { status: 'no-profile', user }                 登入了，還沒設定暱稱
 *   { status: 'ready', user, profile }             可以使用
 * 連不上伺服器會丟出錯誤（用 socialErrorMessage 顯示）
 */
export async function getSocialState() {
  if (!socialAvailable) return { status: 'unavailable' };
  const user = await cloud.currentUser();
  if (!user) return { status: 'signed-out' };
  const row = await cloud.getMyProfile(user.id);
  if (!row) return { status: 'no-profile', user };
  const urls = row.avatar_path ? await cloud.avatarUrls([row.avatar_path]) : {};
  return { status: 'ready', user, profile: toProfile(row, urls) };
}

/** Google 登入完成回到 App 時（網址有 ?code= 或 ?error=）呼叫；回傳 { ok, message } */
export async function completeSignIn(search) {
  const params = new URLSearchParams(search);
  if (params.has('error')) {
    return { ok: false, message: params.get('error') === 'access_denied' ? '已取消登入' : '登入沒有完成，請再試一次' };
  }
  try {
    // 建立 client 時會用網址上的 code 換成 session（需要登入前存下的 code verifier）
    const user = await cloud.currentUser();
    return user
      ? { ok: true, message: '登入成功' }
      : { ok: false, message: '登入沒有完成，請在同一個 App 裡重新按「用 Google 登入」' };
  } catch (err) {
    return { ok: false, message: socialErrorMessage(err) };
  }
}

/** 換頁到 Google 登入；完成後回到 App 首頁（網址必須在 Supabase 的 Redirect URLs 允許清單裡） */
export const signInWithGoogle = () => cloud.signInWithGoogle(location.origin + location.pathname);

/** 登出這台裝置；本機的沖煮紀錄不受影響 */
export const signOut = () => cloud.signOut();

/** LINE、Facebook、Instagram 等 App 內建的瀏覽器：Google 不允許在裡面登入 */
export const isInAppBrowser = () => /\bLine\/|FBAN|FBAV|Instagram|MicroMessenger/i.test(navigator.userAgent);

/* ----- 暱稱與頭像 ----- */

export const NICKNAME_MAX = 20;

/** 暱稱驗證（資料庫也有同樣的 check）：去掉前後空白後 1–20 字，不能有換行等控制字元；回傳錯誤訊息或 '' */
export function validateNickname(name) {
  const s = String(name ?? '').trim();
  if (!s) return '請輸入暱稱';
  if ([...s].length > NICKNAME_MAX) return `暱稱最多 ${NICKNAME_MAX} 個字`; // 和資料庫的 char_length 一樣以字元計
  if (/[\u0000-\u001f\u007f-\u009f]/.test(s)) return '暱稱不能有換行或特殊字元';
  return '';
}

/** 第一次設定暱稱（建立 profile）；回傳 { ok, error } */
export async function createProfile(nickname) {
  const error = validateNickname(nickname);
  if (error) return { ok: false, error };
  await cloud.createProfile(nickname.trim());
  return { ok: true };
}

export async function updateNickname(userId, nickname) {
  const error = validateNickname(nickname);
  if (error) return { ok: false, error };
  await cloud.updateNickname(userId, nickname.trim());
  return { ok: true };
}

/** 使用者選的頭像 → 256×256 JPEG Blob（重新編碼、移除 EXIF）；格式不對會丟出錯誤，message 可直接顯示 */
export const prepareAvatar = (file) => compressAvatar(file);
export const saveAvatar = (userId, blob) => cloud.saveAvatar(userId, blob);
export const removeAvatar = (userId) => cloud.removeAvatar(userId);

/* ----- 好友代碼 ----- */

// 10 碼，不含易混淆的 0 O 1 I L（和資料庫的 friend_code_format 一致）
const FRIEND_CODE = /^[A-HJKMNP-Z2-9]{10}$/;

/** 使用者輸入的代碼：轉大寫、去掉空白和 -（資料庫也會做一次） */
export const normalizeFriendCode = (input) => String(input ?? '').toUpperCase().replace(/[\s-]/g, '');
export const formatFriendCode = (code) => `${code.slice(0, 5)} ${code.slice(5)}`;

/** QR code 的內容：打開 App 的「加好友」頁並帶入代碼 */
export const friendInviteUrl = (code) => `${location.origin}${location.pathname}#/friends/add?code=${encodeURIComponent(code)}`;

/** 文字 → QR code 的 SVG（只有 path，顏色由 CSS 決定）；程式庫只在用到時才載入 */
export async function qrSvg(text) {
  const { default: qrcode } = await import('./vendor/qrcode-generator-2.0.4.js');
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4; // QR code 規定的四格留白
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + quiet},${r + quiet}h1v1h-1z`;
  }
  const size = n + quiet * 2;
  return `<svg class="qr" viewBox="0 0 ${size} ${size}" role="img" aria-label="好友邀請 QR code" shape-rendering="crispEdges">`
    + `<rect width="${size}" height="${size}" class="qr-bg"/><path d="${d}" class="qr-fg"/></svg>`;
}

export const regenerateFriendCode = () => cloud.regenerateFriendCode();

const REQUEST_MESSAGES = {
  sent: { ok: true, message: '已送出邀請，等對方接受' },
  accepted: { ok: true, message: '對方之前也邀請過你，你們已經是好友了' },
  already_sent: { ok: true, message: '已經邀請過了，等對方接受' },
  already_friends: { ok: true, message: '你們已經是好友了' },
  not_found: { ok: false, message: '找不到這個好友代碼，請確認是否輸入正確' },
  you_blocked: { ok: false, message: '你封鎖了這個人，要先在下方的封鎖名單解除封鎖' },
  rate_limited: { ok: false, message: '嘗試太多次，請稍後再試' },
  no_profile: { ok: false, message: '請先到「帳號」設定暱稱' },
};

/** 用代碼送出好友邀請；回傳 { ok, message } */
export async function sendFriendRequest(input) {
  const code = normalizeFriendCode(input);
  if (!FRIEND_CODE.test(code)) return { ok: false, message: '好友代碼是 10 個英文字母和數字（不含 0、O、1、I、L）' };
  const result = await cloud.sendFriendRequest(code);
  return REQUEST_MESSAGES[result] ?? { ok: false, message: '發生錯誤，請稍後再試' };
}

/* ----- 好友名單 ----- */

/**
 * { incoming: 收到的邀請, outgoing: 送出的邀請, friends: 好友, blocked: 封鎖名單 }
 * 每個人是 { id, nickname, avatarUrl, since }；好友另有 blocked（封鎖了但仍是好友）；他人的暱稱顯示時一律要跳脫
 */
export async function listFriends(myId) {
  const [{ rows, profiles }, blocks] = await Promise.all([cloud.listFriendships(), cloud.listBlocks()]);
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const urls = await cloud.avatarUrls(profiles.map((p) => p.avatar_path));
  const person = (id, since) => {
    const p = byId.get(id);
    return { id, nickname: p?.nickname ?? '（不明）', avatarUrl: urls[p?.avatar_path] ?? null, since };
  };
  const newestFirst = (a, b) => String(b.since).localeCompare(String(a.since));
  const blockedIds = new Set(blocks.map((b) => b.blocked));
  return {
    incoming: rows.filter((r) => r.status === 'pending' && r.addressee === myId)
      .map((r) => person(r.requester, r.created_at)).sort(newestFirst),
    outgoing: rows.filter((r) => r.status === 'pending' && r.requester === myId)
      .map((r) => person(r.addressee, r.created_at)).sort(newestFirst),
    friends: rows.filter((r) => r.status === 'accepted')
      .map((r) => {
        const id = r.requester === myId ? r.addressee : r.requester;
        return { ...person(id, r.accepted_at), blocked: blockedIds.has(id) };
      }).sort(newestFirst),
    blocked: blocks.map((b) => ({ id: b.blocked, nickname: b.blocked_nickname || '（不明）', avatarUrl: null, since: b.created_at })),
  };
}

/** 接受邀請；邀請已經不在（對方取消了）會丟出錯誤 */
export async function acceptFriend(myId, requesterId) {
  if (!(await cloud.acceptFriendRequest(myId, requesterId))) throw new Error('這個邀請已經不存在');
}
/** 拒絕邀請、取消邀請、解除好友 */
export const removeFriendship = (myId, otherId) => cloud.deleteFriendship(myId, otherId);
/** 封鎖：不解除好友（只刪掉待處理的邀請），雙方互相看不到對方的貼文、留言、讚；對方不會知道被封鎖 */
export const blockUser = (otherId) => cloud.block(otherId);
export const unblockUser = (otherId) => cloud.unblock(otherId);

/* ----- 同步（本機 friends 紀錄 → 雲端） ----- */

/**
 * 要求在背景同步（不等結果、不丟錯誤）；沒登入或沒有要同步的紀錄時不會載入 supabase-js
 * 存檔、刪除、匯入後自動呼叫；app.js 在啟動、恢復網路、切回前景時呼叫
 */
export function requestSync() {
  if (!socialAvailable) return;
  sync.request().catch((err) => console.warn('同步失敗', err));
}

/** 立即同步並等結果 { status, uploaded, deleted, failed }（測試、重試按鈕用） */
export const syncNow = () => sync.request();

const SHARE_STATUS = {
  'signed-out': { tone: 'warn', text: '還沒登入：登入並設定暱稱後才會分享給好友' },
  synced: { tone: 'ok', text: '已分享給好友' },
  pending: { tone: '', text: '等待上傳：連上網路後會自動分享給好友' },
  rate_limited: { tone: 'warn', text: '今天的分享額度（30 筆）已用完，明天會自動上傳' },
  invalid: { tone: 'warn', text: '內容不符合雲端的限制，無法分享，請修改內容' },
  failed: { tone: 'warn', text: '上傳失敗，稍後會自動再試' },
};

/** 紀錄的分享狀態 { tone, text }（只讀本機）；只有我的紀錄回傳 null */
export async function getShareStatus(brewId) {
  const brew = await db.get('brews', brewId);
  return SHARE_STATUS[await sync.brewStatus(brew)] ?? null;
}

/* ----- 社群（動態牆） ----- */

export const FEED_PAGE_SIZE = 20;

/** 雲端的一列 → 畫面用的資料（中文標籤、衍生值算好）；文字多半來自他人，顯示時一律要跳脫 */
function toFeedItem(row, { myId, profiles, avatarUrls, photoUrls, likes, commentCounts, newCommentKeys }) {
  const owner = profiles.get(row.owner);
  const brewLikes = likes.filter((l) => l.brew_owner === row.owner && l.brew_id === row.id);
  const likers = brewLikes.map((l) => profiles.get(l.user_id)).filter(Boolean);
  const num = (v) => (v == null ? null : Number(v)); // numeric 欄位
  const brew = { coffeeG: num(row.coffee_g), waterG: num(row.water_g) };
  const key = `${row.owner}/${row.id}`;
  return {
    owner: row.owner,
    id: row.id,
    mine: row.owner === myId,
    nickname: owner?.nickname ?? '（不明）',
    avatarUrl: avatarUrls[owner?.avatar_path] ?? null,
    beanName: row.bean_name,
    origin: row.bean_origin,
    process: PROCESS[row.bean_process] ?? '',
    roastLevel: ROAST_LEVEL[row.roast_level] ?? '',
    restDays: restDays(row.brewed_at, row.roast_date),
    brewedAt: row.brewed_at,
    dripper: row.dripper,
    grinderName: row.grinder_name,
    grindSetting: row.grind_setting,
    ...brew,
    ratio: ratio(brew),
    tempC: num(row.temp_c),
    totalTimeS: row.total_time_s,
    rating: row.rating,
    flavor: Object.fromEntries(Object.keys(FLAVOR).map((k) => [k, row[k] ?? null])),
    flavorNotes: sortFlavorNotes((row.flavor_notes ?? []).filter(isFlavorNote)),
    notes: row.notes,
    photoUrl: photoUrls[row.photo_path] ?? null,
    likeCount: brewLikes.length,
    likedByMe: brewLikes.some((l) => l.user_id === myId),
    // 按讚的人：看得到 profile 的列出暱稱（自己排最前面），其他人（不是我的好友）只算人數
    likers: likers.sort((a, b) => Number(b.id === myId) - Number(a.id === myId)).map((p) => (p.id === myId ? '你' : p.nickname)),
    otherLikers: brewLikes.length - likers.length,
    commentCount: commentCounts[key] ?? 0,
    hasNewComments: newCommentKeys.has(key),
  };
}

/** 一批雲端紀錄 → 畫面用的資料（一起查讚、留言數、profile、頭像與照片的 signed URL） */
async function toFeedItems(myId, rows, { newCommentKeys = new Set() } = {}) {
  if (!rows.length) return [];
  const [likes, commentCounts] = await Promise.all([cloud.listLikes(rows), cloud.countComments(rows)]);
  const profileRows = await cloud.listProfiles([...rows.map((r) => r.owner), ...likes.map((l) => l.user_id)]);
  const [avatarUrls, photoUrls] = await Promise.all([
    cloud.avatarUrls(profileRows.map((p) => p.avatar_path)),
    cloud.brewPhotoUrls(rows.map((r) => r.photo_path)),
  ]);
  const profiles = new Map(profileRows.map((p) => [p.id, p]));
  return rows.map((row) => toFeedItem(row, { myId, profiles, avatarUrls, photoUrls, likes, commentCounts, newCommentKeys }));
}

/**
 * 動態牆（依沖煮時間新→舊）：{ items, hasMore }；offset 是已載入的筆數
 * mine 為 false（全部）：自己＋好友的；true（我的）：只有自己的
 * 讀第一頁時記下「看過了」（社群分頁的數字）：全部＝好友新貼文、我貼文的新留言、回覆我的；我的＝後兩個
 * 有新留言的貼文 hasNewComments 為 true（只在這次標示）
 */
export async function listFeed(myId, { offset = 0, mine = false } = {}) {
  // 先查「最新的時間」再讀動態牆：讀的期間才新增的比它新，下次仍會算進數字
  let latestPost = null;
  let activity = null;
  if (offset === 0) {
    [latestPost, activity] = await Promise.all([
      mine ? null : cloud.latestFriendBrewAt(myId),
      Promise.all([seenAt(COMMENTS_SEEN_KEY, myId), seenAt(REPLIES_SEEN_KEY, myId)])
        .then(([p, r]) => cloud.commentActivity(p, r)),
    ]);
  }
  const rows = await cloud.listFeed(myId, { offset, limit: FEED_PAGE_SIZE + 1, mine }); // 多拿一筆判斷還有沒有
  const items = await toFeedItems(myId, rows.slice(0, FEED_PAGE_SIZE), { newCommentKeys: new Set(activity?.posts ?? []) });
  const seen = (key, at) => (at ? db.setMeta(key, { userId: myId, at }) : null);
  await Promise.all([
    seen(FEED_SEEN_KEY, latestPost),
    seen(COMMENTS_SEEN_KEY, activity?.latest_post_comment_at),
    seen(REPLIES_SEEN_KEY, activity?.latest_reply_at),
  ]);
  return { items, hasMore: rows.length > FEED_PAGE_SIZE };
}

/* ----- 提示：☰ 按鈕（收到好友邀請）、底部「社群」分頁（新通知的數字） ----- */

// 上次看社群頁時，各種通知最新一則的建立時間（雲端的時間，不受手機時鐘影響）；記在 meta，換帳號就不算數
const FEED_SEEN_KEY = 'feedSeenAt';         // 好友的新貼文
const COMMENTS_SEEN_KEY = 'commentsSeenAt'; // 別人在我的貼文留言
const REPLIES_SEEN_KEY = 'repliesSeenAt';   // 別人在別人的貼文回覆我
const BADGE_COUNT_MAX = 100;                // 每種最多算到 100（畫面顯示 99+）

/** meta 記下的「看過了」時間；不是這個帳號記的、或還沒看過回傳 null（全部算新的） */
async function seenAt(key, userId) {
  const seen = await db.getMeta(key);
  return seen?.userId === userId ? seen.at : null;
}

/**
 * { requests: 有沒有收到好友邀請, count: 社群分頁的數字（好友新貼文＋我貼文的新留言＋回覆我的） }
 * 沒登入直接回傳都沒有（只讀本機，不載入 supabase-js）；連不上伺服器會丟出錯誤（呼叫端維持原本的顯示）
 */
export async function getSocialBadges() {
  const none = { requests: false, count: 0 };
  if (!socialAvailable) return none;
  const userId = await sync.sessionUserId();
  if (!userId) return none;
  const [feedSeen, commentsSeen, repliesSeen] = await Promise.all(
    [FEED_SEEN_KEY, COMMENTS_SEEN_KEY, REPLIES_SEEN_KEY].map((key) => seenAt(key, userId)),
  );
  const [requests, posts, activity] = await Promise.all([
    cloud.hasIncomingRequests(userId),
    cloud.countFriendBrewsSince(userId, feedSeen, BADGE_COUNT_MAX),
    cloud.commentActivity(commentsSeen, repliesSeen),
  ]);
  return { requests, count: posts + (activity?.post_comments ?? 0) + (activity?.replies ?? 0) };
}

/** 數字徽章的文字：0 → ''（隱藏）、1–99、超過 99 → '99+' */
export const badgeText = (n) => (!n ? '' : n > 99 ? '99+' : String(n));

/**
 * 動態牆的一筆紀錄（好友的或自己的）；讀不到（不是好友、被封鎖、已刪除或改回只有我）回傳 null
 * 自己的紀錄：這台裝置有這筆時 canEdit 為 true（詳細頁顯示「編輯」）
 */
export async function getFeedBrew(myId, owner, id) {
  const row = await cloud.getSharedBrew(owner, id);
  if (!row) return null;
  const [item] = await toFeedItems(myId, [row]);
  item.canEdit = item.mine && Boolean(await db.get('brews', id));
  return item;
}

/** 按讚／收回讚 */
export const setLike = (myId, owner, id, liked) => (liked ? cloud.like(owner, id) : cloud.unlike(myId, owner, id));

/* ----- 留言與回覆 ----- */

export const COMMENT_MAX = 300; // 和資料庫的 check 一致

/** 留言內容驗證（資料庫也有同樣的 check）：去掉前後空白後 1–300 字；回傳錯誤訊息或 '' */
export function validateComment(body) {
  const s = String(body ?? '').trim();
  if (!s) return '請輸入留言';
  const n = charLength(s);
  if (n > COMMENT_MAX) return `最多 ${COMMENT_MAX} 字（目前 ${n} 字）`;
  if (/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/.test(s)) return '不能有特殊字元';
  return '';
}

/** 留言失敗時的訊息 */
export function commentErrorMessage(err) {
  if (err?.code === 'P0001') return '今天的留言已達上限（100 則），明天再試';
  // 不是好友、被封鎖、紀錄已刪除或改回只有我、回覆的留言已刪除：都一樣
  if (['42501', '403', '23503'].includes(err?.code)) return '這篇紀錄或留言已經看不到了，重新整理看看';
  return socialErrorMessage(err);
}

/** 相對時間：剛剛、5 分鐘前、3 小時前、2 天前；超過 7 天顯示日期 */
export function formatRelative(iso, now = Date.now()) {
  const t = new Date(iso).getTime();
  const minutes = Math.floor((now - t) / 60000);
  if (minutes < 1) return '剛剛';
  if (minutes < 60) return `${minutes} 分鐘前`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} 小時前`;
  if (minutes < 60 * 24 * 7) return `${Math.floor(minutes / (60 * 24))} 天前`;
  const d = new Date(t);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return `${sameYear ? '' : `${d.getFullYear()}/`}${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * 雲端的一列留言 → 畫面用的資料
 * 暱稱：看得到對方的 profile（自己、好友）就用現在的暱稱和頭像；看不到（好友的好友）用留言當下記下的暱稱
 * 所有文字都可能來自他人，顯示時一律要跳脫
 */
function toComment(row, { myId, brewOwner, profiles, avatarUrls }) {
  const author = profiles.get(row.author);
  const replyTo = row.reply_to_user ? profiles.get(row.reply_to_user) : null;
  return {
    id: row.id,
    parentId: row.parent_id,
    author: row.author,
    nickname: author?.nickname ?? (row.author_nickname || '（不明）'),
    avatarUrl: avatarUrls[author?.avatar_path] ?? null,
    replyToUser: row.reply_to_user,
    replyToNickname: row.reply_to_user ? (replyTo?.nickname ?? row.reply_to_nickname ?? null) : null,
    body: row.body,
    createdAt: row.created_at,
    mine: row.author === myId,
    canDelete: row.author === myId || brewOwner === myId, // 和資料庫的刪除政策一致
  };
}

async function toComments(myId, brewOwner, rows) {
  const profileRows = await cloud.listProfiles(rows.flatMap((r) => [r.author, r.reply_to_user]).filter(Boolean));
  const avatarUrls = await cloud.avatarUrls(profileRows.map((p) => p.avatar_path));
  const profiles = new Map(profileRows.map((p) => [p.id, p]));
  return rows.map((row) => toComment(row, { myId, brewOwner, profiles, avatarUrls }));
}

/**
 * 一筆紀錄的留言：{ threads: [{ ...主留言, replies: [回覆, ...] }], count }
 * 主留言、回覆都是舊→新；回覆的回覆也在同一則主留言下（replyToNickname 顯示「@暱稱」）
 */
export async function listComments(myId, owner, id) {
  const comments = await toComments(myId, owner, await cloud.listComments(owner, id));
  const threads = comments.filter((c) => !c.parentId).map((c) => ({ ...c, replies: [] }));
  const byId = new Map(threads.map((t) => [t.id, t]));
  for (const c of comments) if (c.parentId) byId.get(c.parentId)?.replies.push(c);
  return { threads, count: comments.length };
}

/**
 * 留言或回覆；回傳 { ok, error } 或 { ok: true, comment }
 * replyTo：要回覆的那則留言（主留言或回覆）。回覆一律掛在主留言下；回覆別人的回覆時記下對象（@暱稱）
 * 被資料庫拒絕會丟出錯誤（用 commentErrorMessage 顯示）
 */
export async function addComment(myId, owner, id, { body, replyTo = null }) {
  const error = validateComment(body);
  if (error) return { ok: false, error };
  const parentId = replyTo ? (replyTo.parentId ?? replyTo.id) : null;
  const replyToUser = replyTo?.parentId && replyTo.author !== myId ? replyTo.author : null;
  const row = await cloud.insertComment({ owner, id, body: String(body).trim(), parentId, replyToUser });
  const [comment] = await toComments(myId, owner, [row]);
  return { ok: true, comment };
}

/** 刪除留言（主留言的回覆由資料庫一起刪除）；沒刪到（沒有權限或已經刪除）丟出錯誤 */
export async function deleteComment(commentId) {
  if (!(await cloud.deleteComment(commentId))) throw new Error('這則留言已經刪除，或你沒有權限刪除');
}

/* ----- 檢舉、刪除帳號 ----- */

export const REPORT_REASONS = { spam: '垃圾訊息或廣告', inappropriate: '不當內容', harassment: '騷擾或霸凌', other: '其他' };
export const REPORT_DETAIL_MAX = 300;

/**
 * 檢舉好友的一筆紀錄（只有站長在 Supabase 後台看得到，對方不會知道）；回傳 { ok, errors }
 * 每天最多 10 次（資料庫強制）
 */
export async function reportBrew(owner, id, { reason, detail = '' }) {
  const errors = {};
  if (!Object.hasOwn(REPORT_REASONS, reason ?? '')) errors.reason = '請選擇原因';
  const text = String(detail).trim();
  if (charLength(text) > REPORT_DETAIL_MAX) errors.detail = `說明最多 ${REPORT_DETAIL_MAX} 字`;
  if (Object.keys(errors).length) return { ok: false, errors };
  await cloud.insertReport({ owner, id, reason, detail: text });
  return { ok: true };
}

/* ----- 意見回饋 ----- */

export const FEEDBACK_CATEGORIES = { bug: '問題回報', idea: '功能建議', other: '其他' };
export const FEEDBACK_MAX = 1000;      // 和資料庫的 check 一致
export const FEEDBACK_DAILY_MAX = 5;   // 每天上限（資料庫強制）
// 'x.y.z'，或舊版 Service Worker 的整數版本（'18'）；和資料庫 feedback_app_version_format 一致
const APP_VERSION_FORMAT = /^(\d{1,4}\.\d{1,4}\.\d{1,4}|[1-9]\d{0,6})$/;

/**
 * 送出意見回饋（只有開發者在 Supabase 後台看得到，送出後寄 Email 通知開發者）；回傳 { ok, errors }
 * appVersion：送出時的 App 版本號字串（ui.js 的 appVersion()，'1.2.3' 或舊版的 '18'；沒有就 null）；作者由資料庫用 auth.uid() 決定
 */
export async function sendFeedback({ category, message, appVersion = null }) {
  const errors = {};
  if (!Object.hasOwn(FEEDBACK_CATEGORIES, category ?? '')) errors.category = '請選擇類型';
  const text = String(message ?? '').trim();
  if (!text) errors.message = '請輸入內容';
  else if (charLength(text) > FEEDBACK_MAX) errors.message = `最多 ${FEEDBACK_MAX} 字（目前 ${charLength(text)} 字）`;
  if (Object.keys(errors).length) return { ok: false, errors };
  const version = typeof appVersion === 'string' && APP_VERSION_FORMAT.test(appVersion) ? appVersion : null;
  await cloud.sendFeedback({ category, message: text, appVersion: version });
  return { ok: true };
}

/**
 * 刪除我的帳號：雲端的 profile、分享的紀錄、照片、頭像、讚、好友關係、意見回饋全部刪除，立即生效
 * 本機資料保留；分享給好友的紀錄全部改回「只有我」（之後用新帳號登入也不會自動上傳），清掉同步狀態
 */
export async function deleteAccount() {
  await cloud.deleteAccount();
  const shared = (await db.getAll('brews')).filter((b) => b.visibility === 'friends');
  await db.transact(['brews', 'sync'], (s) => {
    for (const b of shared) s.brews.put({ ...b, visibility: 'private' });
    s.sync.clear();
  });
  return { privatized: shared.length };
}
