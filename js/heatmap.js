// 沖煮熱度圖的計算：純函式，只用傳進來的資料，不碰 IndexedDB、DOM、網路（Node 可以直接載入測試）
// 只由 models.js 使用；日期一律用本機日期（和統計頁一樣，台灣的使用者就是台灣時間），週一為一週的開始
// 只 import stats.js 的日期工具（它也是純函式、沒有任何相依）
import { localDate, addDays, weekStart } from './stats.js';

export const WEEKS = 53;        // 53 欄（週）× 7 列，最右欄是本週
export const WINDOW_DAYS = 365; // 「近一年」：含今天往前 365 天（好友看到的、上傳的都是這個範圍）
export const MAX_CUPS = 50;     // 上傳時一天最多算幾杯（和資料庫的 check 一致）

const isRated = (b) => Number.isFinite(b.rating) && b.rating >= 1 && b.rating <= 5;

/** 近一年的第一天 */
export const windowStart = (today) => addDays(today, -(WINDOW_DAYS - 1));

/** 本機紀錄 → Map<YYYY-MM-DD, { cups, avg }>（avg：當天有評分的杯的平均，沒有就是 null） */
export function summarize(brews) {
  const acc = new Map();
  for (const b of brews) {
    const day = localDate(b.brewedAt);
    const cur = acc.get(day) ?? { cups: 0, sum: 0, rated: 0 };
    cur.cups++;
    if (isRated(b)) { cur.sum += b.rating; cur.rated++; }
    acc.set(day, cur);
  }
  return new Map([...acc].map(([day, c]) => [day, { cups: c.cups, avg: c.rated ? c.sum / c.rated : null }]));
}

/** 上傳給好友看的內容：近一年有沖的日子 [{ day, cups }]（依日期排序；一天超過 50 杯算 50） */
export function activityRows(brews, today) {
  const from = windowStart(today);
  return [...summarize(brews)]
    .filter(([day]) => day >= from && day <= today)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, { cups }]) => ({ day, cups: Math.min(cups, MAX_CUPS) }));
}

/** 雲端的 [{ day, cups }] → 和 summarize 一樣的 Map（好友的資料沒有評分） */
export const fromActivity = (rows) => new Map(rows.map((r) => [r.day, { cups: r.cups, avg: null }]));

/**
 * 連續沖煮天數（只看近一年）：{ current, longest }
 * current：連到今天；今天還沒沖的話從昨天往回算（今天還有機會沖，不算中斷）
 */
export function streaks(days, today) {
  const from = windowStart(today);
  const has = (day) => (days.get(day)?.cups ?? 0) > 0;
  let current = 0;
  for (let d = has(today) ? today : addDays(today, -1); d >= from && has(d); d = addDays(d, -1)) current++;
  let longest = 0;
  let run = 0;
  for (let d = from; d <= today; d = addDays(d, 1)) {
    run = has(d) ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return { current, longest };
}

/** 顏色的級數 0–4：杯數 0、1、2、3、4 以上；平均評分：沒有評分 0，< 2、< 3、< 4、≥ 4 分別是 1–4 */
export function level(entry, mode) {
  if (!entry) return 0;
  if (mode === 'rating') {
    if (entry.avg == null) return 0;
    return entry.avg < 2 ? 1 : entry.avg < 3 ? 2 : entry.avg < 4 ? 3 : 4;
  }
  return Math.min(entry.cups, 4);
}

/**
 * 熱度圖的資料：
 * { weeks: 53 欄 × 7 格（週一→週日；今天之後是 null）, months: [{ col, month }], total, current, longest }
 * 每格 { day, cups, avg, level, isToday }；months：該月 1 號所在的那一欄（離上一個標籤太近時省略，避免文字重疊）
 * total：近一年的總杯數
 */
export function buildHeatmap(days, { today, mode = 'cups' }) {
  const first = addDays(weekStart(today), -(WEEKS - 1) * 7);
  const weeks = [];
  const months = [];
  for (let col = 0; col < WEEKS; col++) {
    const week = [];
    for (let row = 0; row < 7; row++) {
      const day = addDays(first, col * 7 + row);
      if (day > today) { week.push(null); continue; }
      const entry = days.get(day);
      week.push({ day, cups: entry?.cups ?? 0, avg: entry?.avg ?? null, level: level(entry, mode), isToday: day === today });
      if (day.endsWith('-01') && (!months.length || col - months[months.length - 1].col >= 3)) {
        months.push({ col, month: Number(day.slice(5, 7)) });
      }
    }
    weeks.push(week);
  }
  const from = windowStart(today);
  let total = 0;
  for (const [day, { cups }] of days) if (day >= from && day <= today) total += cups;
  return { weeks, months, total, ...streaks(days, today) };
}
