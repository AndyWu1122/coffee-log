// 拉花（1.24.0）的計算：不需要 Supabase、不需要 Chrome；Node 直接載入 js/stats.js
// 驗證規則在 models.js（會 import IndexedDB 相關的模組），由 latte-ui-test.mjs 在瀏覽器裡測
//
// 用法：node scripts/latte-test.mjs（時區固定成台灣，月份邊界才測得準）
process.env.TZ = 'Asia/Taipei';
const { computeLatteStats, MA_WINDOW } = await import('../js/stats.js');

let passed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) passed++;
  else failures.push(name);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
const q = JSON.stringify;

const NAMES = { heart: '愛心', tulip: '鬱金香', rosetta: '葉子', swan: '天鵝', other: '其他' };
const patternName = (k) => NAMES[k] ?? k;
let n = 0;
const art = (madeAt, pattern, selfScore) => ({ id: `a${++n}`, madeAt: new Date(madeAt).toISOString(), pattern, selfScore });
const now = new Date('2026-11-11T12:00:00+08:00');

/* ===== 空資料 ===== */
const empty = computeLatteStats({ arts: [], now, patternName });
check('空資料：都是 0、空陣列，不會丟錯', empty.total === 0 && empty.cups === 0 && empty.thisMonth === 0 && !empty.enough
  && empty.patterns.length === 0 && empty.trend.points.length === 0 && empty.trend.movingAvg.length === 0, q(empty));

/* ===== 每種圖案的平均、樣本少排後面 ===== */
const arts = [
  art('2026-11-01T08:00:00+08:00', 'heart', 3),
  art('2026-11-02T08:00:00+08:00', 'heart', 4),
  art('2026-11-03T08:00:00+08:00', 'heart', 5),
  art('2026-11-04T08:00:00+08:00', 'tulip', 5),     // 只有 1 杯：樣本少
  art('2026-11-05T08:00:00+08:00', 'rosetta', 2),
  art('2026-11-06T08:00:00+08:00', 'rosetta', 2),
  art('2026-11-07T08:00:00+08:00', 'rosetta', 2),
];
const s = computeLatteStats({ arts, now, patternName });
check('期間全部：7 杯、夠畫圖', s.cups === 7 && s.enough && s.total === 7);
check('愛心平均 4.0、3 杯', s.patterns[0].pattern === 'heart' && s.patterns[0].avg === 4 && s.patterns[0].cups === 3 && !s.patterns[0].small, q(s.patterns[0]));
check('樣本少的（鬱金香 1 杯）排在最後、標樣本少', s.patterns.at(-1).pattern === 'tulip' && s.patterns.at(-1).small, q(s.patterns.map((p) => p.pattern)));
check('圖案名稱用中文', s.patterns.map((p) => p.name).join() === '愛心,葉子,鬱金香');

/* ===== 進步曲線：依時間舊→新、7 杯移動平均 ===== */
const shuffled = computeLatteStats({ arts: [...arts].reverse(), now, patternName });
check('輸入順序亂的也依時間排', shuffled.trend.points.map((p) => p.rating).join() === '3,4,5,5,2,2,2');
check('點有時間、名稱（給圖表顯示）', shuffled.trend.points[0].at === arts[0].madeAt && shuffled.trend.points[0].label === '愛心');
check(`第 ${MA_WINDOW} 杯開始才有移動平均`, s.trend.movingAvg.length === 1 && s.trend.movingAvg[0].index === MA_WINDOW - 1
  && Math.abs(s.trend.movingAvg[0].value - 23 / 7) < 1e-9, q(s.trend.movingAvg));

/* ===== 期間 ===== */
const old = [...arts, art('2026-07-01T08:00:00+08:00', 'swan', 1)];
const last30 = computeLatteStats({ arts: old, period: '30', now, patternName });
check('近 30 天：不算 7 月那杯；total 仍是全部', last30.cups === 7 && last30.total === 8 && !last30.patterns.some((p) => p.pattern === 'swan'));
const all = computeLatteStats({ arts: old, period: 'all', now, patternName });
check('全部：算進 7 月那杯', all.cups === 8 && all.patterns.some((p) => p.pattern === 'swan'));
const few = computeLatteStats({ arts: arts.slice(0, 2), now, patternName });
check('少於 3 杯：enough 是 false', few.cups === 2 && !few.enough);

/* ===== 本月：本機日期的日曆月，不受期間影響 ===== */
const edge = [
  art('2026-10-31T23:59:00+08:00', 'heart', 3), // 上個月最後一分鐘
  art('2026-11-01T00:01:00+08:00', 'heart', 3), // 這個月第一分鐘
  art('2026-11-30T23:59:00+08:00', 'heart', 3),
];
const month = computeLatteStats({ arts: edge, period: 'all', now, patternName });
check('本月：10/31 23:59 不算、11/1 00:01 算', month.thisMonth === 2, String(month.thisMonth));
const monthShort = computeLatteStats({ arts: [...edge, art('2026-11-01T09:00:00+08:00', 'tulip', 4)], period: '30', now: new Date('2026-11-30T12:00:00+08:00'), patternName });
check('本月不受期間影響', monthShort.thisMonth === 3);

/* ===== 不合法的自評不算進平均（舊資料保險） ===== */
const bad = computeLatteStats({ arts: [art('2026-11-01T08:00:00+08:00', 'heart', null), art('2026-11-02T08:00:00+08:00', 'heart', 4)], now, patternName });
check('沒有自評的不算進平均和曲線', bad.cups === 1 && bad.patterns[0].avg === 4 && bad.total === 2);

console.log(`\n${passed}/${passed + failures.length} 通過`);
if (failures.length) {
  console.log(`失敗：\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
}
