// 統計頁（#/stats）的計算：純函式，只用傳進來的資料，不碰 IndexedDB、DOM、網路（Node 可以直接載入測試）
// 只由 models.js 使用；衍生值不儲存，每次打開統計頁重新算
// 日期一律用本機時間（和紀錄列表、養豆天數一樣）；週一為一週的開始

/** 期間：近 N 天，或全部（null） */
export const PERIODS = { '30': 30, '90': 90, all: null };
export const MIN_CUPS = 3;      // 期間內少於幾杯就不畫圖，只顯示提示
export const SMALL_SAMPLE = 3;  // 有評分少於幾杯標「樣本少」
export const MA_WINDOW = 7;     // 評分的移動平均：幾杯
const TOP_N = 3;                // 常用參數取前幾名
const DAY = 86400000;

const pad = (n) => String(n).padStart(2, '0');
/** Date 或 ISO 字串 → 本機日期 YYYY-MM-DD */
export function localDate(value) {
  const d = new Date(value);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** YYYY-MM-DD 加減天數（用 UTC 計算，不受夏令時間影響） */
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
/** 這一天所在那週的週一（YYYY-MM-DD） */
export function weekStart(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0＝週日
  return addDays(dateStr, -((weekday + 6) % 7));
}

/** 粉水比的分組：以 0.5 為一組，下限（16.0 屬於 1:16–1:16.5）；加一點點避免 15.999… 這類浮點誤差落到前一組 */
export const ratioBucket = (ratio) => Math.floor(ratio * 2 + 1e-9) / 2;

const average = (nums) => (nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : null);
const isRated = (b) => Number.isFinite(b.rating) && b.rating >= 1 && b.rating <= 5;

/** 有評分的杯依 key 分組 → [{ key, name, avg, cups, small }]：樣本夠的先（平均高→低、杯數多→少），樣本少的排後面 */
function rankByRating(brews, keyOf, nameOf) {
  const groups = new Map();
  for (const b of brews) {
    const key = keyOf(b);
    if (!key || !isRated(b)) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b.rating);
  }
  return [...groups].map(([key, ratings]) => ({
    key, name: nameOf(key), avg: average(ratings), cups: ratings.length, small: ratings.length < SMALL_SAMPLE,
  })).sort((a, b) => Number(a.small) - Number(b.small) || b.avg - a.avg || b.cups - a.cups || a.name.localeCompare(b.name));
}

/** 次數最多的前 N 名 [{ value, count }]（次數相同時值小的在前） */
function topCounts(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value - b.value).slice(0, TOP_N);
}

/** 每週杯數：從 fromDate 那週到 toDate 那週，每週一格（沒沖＝0） */
function weeklyCounts(brews, fromDate, toDate) {
  const counts = new Map();
  for (const b of brews) {
    const w = weekStart(localDate(b.brewedAt));
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  const weeks = [];
  for (let w = weekStart(fromDate), last = weekStart(toDate); w <= last; w = addDays(w, 7)) {
    weeks.push({ start: w, end: addDays(w, 6), count: counts.get(w) ?? 0 });
  }
  return weeks;
}

/**
 * 統計頁的所有數字
 * brews、beans、grinders、drippers：全部資料（含已封存的豆子、磨豆機、濾杯）；period：PERIODS 的 key；beanId：'' 為全部
 * method：'' 為全部，'pourover'／'siphon' 只算那一種（舊紀錄沒有 method＝手沖）
 * 回傳 { cups, enough, overview, ratingTrend, beans, ratios, temps, drippers, grinders, weeks }
 */
export function computeStats({ brews = [], beans = [], grinders = [], drippers = [], period = 'all', beanId = '', method = '', now = new Date() } = {}) {
  const days = PERIODS[period] ?? null;
  const since = days == null ? null : now.getTime() - days * DAY;
  const selected = brews
    .filter((b) => !beanId || b.beanId === beanId)
    .filter((b) => !method || (b.method || 'pourover') === method)
    .filter((b) => since == null || new Date(b.brewedAt).getTime() >= since)
    .sort((a, b) => a.brewedAt.localeCompare(b.brewedAt));

  const beanName = new Map(beans.map((b) => [b.id, b.name]));
  const grinderName = new Map(grinders.map((g) => [g.id, g.name]));
  const dripperName = new Map(drippers.map((d) => [d.id, d.name]));
  const nameOfBean = (id) => beanName.get(id) ?? '（已刪除的豆子）';
  const rated = selected.filter(isRated);

  // 最常沖的豆子：杯數最多；同數取最近沖的
  const beanCups = new Map();
  for (const b of selected) {
    const cur = beanCups.get(b.beanId) ?? { cups: 0, last: '' };
    beanCups.set(b.beanId, { cups: cur.cups + 1, last: b.brewedAt > cur.last ? b.brewedAt : cur.last });
  }
  const [topId, top] = [...beanCups].sort(([, a], [, b]) => b.cups - a.cups || b.last.localeCompare(a.last))[0] ?? [];

  const points = rated.map((b) => ({ brewId: b.id, brewedAt: b.brewedAt, rating: b.rating, beanName: nameOfBean(b.beanId) }));
  const movingAvg = [];
  for (let i = MA_WINDOW - 1; i < points.length; i++) {
    movingAvg.push({ index: i, value: average(points.slice(i - MA_WINDOW + 1, i + 1).map((p) => p.rating)) });
  }

  const ratios = topCounts(selected.filter((b) => b.coffeeG > 0 && b.waterG > 0).map((b) => ratioBucket(b.waterG / b.coffeeG)))
    .map(({ value, count }) => ({ from: value, to: value + 0.5, count }));
  const temps = topCounts(selected.filter((b) => Number.isFinite(b.tempC)).map((b) => Math.floor(b.tempC)))
    .map(({ value, count }) => ({ temp: value, count }));

  const fromDate = since == null ? (selected[0] ? localDate(selected[0].brewedAt) : null) : localDate(since);

  return {
    cups: selected.length,
    enough: selected.length >= MIN_CUPS,
    overview: {
      cups: selected.length,
      ratedCups: rated.length,
      avgRating: average(rated.map((b) => b.rating)),
      totalCoffeeG: Math.round(selected.reduce((s, b) => s + (b.coffeeG > 0 ? b.coffeeG : 0), 0) * 10) / 10,
      topBean: topId === undefined ? null : { id: topId, name: nameOfBean(topId), cups: top.cups },
    },
    ratingTrend: { points, movingAvg },
    beans: rankByRating(selected, (b) => b.beanId, nameOfBean).map(({ key, ...rest }) => ({ id: key, ...rest })),
    ratios,
    temps,
    // 賽風不用濾杯，只比手沖
    drippers: rankByRating(selected.filter((b) => (b.method || 'pourover') === 'pourover'), (b) => b.dripperId, (id) => dripperName.get(id) ?? '（已刪除的濾杯）')
      .map(({ key, ...rest }) => ({ id: key, ...rest })),
    grinders: rankByRating(selected, (b) => b.grinderId, (id) => grinderName.get(id) ?? '（已刪除的磨豆機）')
      .map(({ key, ...rest }) => ({ id: key, ...rest })),
    weeks: fromDate ? weeklyCounts(selected, fromDate, localDate(now)) : [],
  };
}
