// 驗證、計算，以及提供給 views 的資料操作（views 只透過這裡存取資料）
import * as db from './db.js';

export const SCHEMA_VERSION = 1;

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
  if (!(b.process in PROCESS)) errors.process = '請選擇處理法';
  if (!(b.roastLevel in ROAST_LEVEL)) errors.roastLevel = '請選擇烘焙度';
  if (b.roastDate) {
    if (!isValidDateStr(b.roastDate)) errors.roastDate = '日期格式錯誤';
    else if (b.roastDate > todayLocal()) errors.roastDate = '烘焙日不能晚於今天';
  }
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
  return { ok: Object.keys(errors).length === 0, errors };
}

/* ===== 豆子 ===== */

/** 豆子列表：未封存在前，再依建立時間新→舊；附上「烘焙至今天數」 */
export async function listBeans({ includeArchived = false } = {}) {
  const beans = await db.getAll('beans');
  return beans
    .filter((b) => includeArchived || !b.archived)
    .sort((a, b) => Number(a.archived) - Number(b.archived) || b.createdAt.localeCompare(a.createdAt))
    .map((b) => ({ ...b, daysSinceRoast: restDays(new Date(), b.roastDate) }));
}

export const getBean = (id) => db.get('beans', id);

/** 新增或更新豆子；回傳 { ok, bean } 或 { ok: false, errors } */
export async function saveBean(input) {
  const existing = input.id ? await db.get('beans', input.id) : null;
  const bean = {
    id: existing?.id ?? newId(),
    name: String(input.name ?? '').trim(),
    origin: String(input.origin ?? '').trim(),
    process: input.process,
    roastLevel: input.roastLevel,
    roastDate: input.roastDate || '',
    archived: existing?.archived ?? false,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
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

/* ===== 沖煮紀錄 ===== */

/** 紀錄列表：依 brewedAt 新→舊，附上豆名、粉水比、養豆天數 */
export async function listBrews() {
  const [brews, beans] = await Promise.all([db.getAll('brews'), db.getAll('beans')]);
  const beanById = new Map(beans.map((b) => [b.id, b]));
  return brews
    .sort((a, b) => b.brewedAt.localeCompare(a.brewedAt))
    .map((brew) => {
      const bean = beanById.get(brew.beanId);
      return {
        ...brew,
        beanName: bean?.name ?? '（已刪除的豆子）',
        ratio: ratio(brew),
        restDays: restDays(brew.brewedAt, bean?.roastDate),
      };
    });
}

export const getBrew = (id) => db.get('brews', id);

/** 新增或更新紀錄；input 可直接是表單字串值。回傳 { ok, brew } 或 { ok: false, errors } */
export async function saveBrew(input) {
  const brew = {
    id: input.id || newId(),
    beanId: input.beanId || '',
    brewedAt: input.brewedAt,
    dripper: String(input.dripper ?? '').trim(),
    grindSetting: String(input.grindSetting ?? '').trim(),
    coffeeG: toNum(input.coffeeG),
    waterG: toNum(input.waterG),
    tempC: toNum(input.tempC),
    totalTimeS: input.totalTimeS ?? null,
    rating: toNum(input.rating),
    flavor: Object.fromEntries(Object.keys(FLAVOR).map((k) => [k, toNum(input.flavor?.[k])])),
    notes: String(input.notes ?? '').trim(),
  };
  const { ok, errors } = validateBrew(brew);
  if (ok && !(await db.get('beans', brew.beanId))) errors.beanId = '找不到這支豆子';
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

/** 「再沖一杯」要複製的參數；評分、風味、筆記、總時間是每杯的結果，不複製 */
export function brewTemplateFrom(brew) {
  const { beanId, dripper, grindSetting, coffeeG, waterG, tempC } = brew;
  return { beanId, dripper, grindSetting, coffeeG, waterG, tempC };
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
