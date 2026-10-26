// js/stats.js 的單元測試（統計頁的計算）：不需要 Chrome、Supabase，Node 直接載入
// 空資料、只有 1 杯、沒評分的紀錄、跨年的週、移動平均、粉水比分組的邊界、水溫分組、樣本少的排序、期間與豆子篩選、封存
//
// 用法：node scripts/stats-test.mjs

process.env.TZ = 'Asia/Taipei'; // 本機日期用台灣時間算（和使用者的手機一樣）；要在任何 Date 運算之前設定

const { computeStats, ratioBucket, weekStart, localDate, addDays, MA_WINDOW } = await import('../js/stats.js');

let passed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) passed++;
  else failures.push(name);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
const q = JSON.stringify;
const near = (a, b) => Math.abs(a - b) < 1e-9;

let seq = 0;
/** 一杯紀錄：at 是本機時間 'YYYY-MM-DDTHH:mm' */
const brew = (at, extra = {}) => ({
  id: `brew-${++seq}`, beanId: 'bean-a', grinderId: '', dripperId: 'd-v60', brewedAt: new Date(at).toISOString(),
  dripper: 'V60', grindSetting: '', coffeeG: 15, waterG: 240, tempC: 92, totalTimeS: null, rating: null,
  flavor: {}, flavorNotes: [], notes: '', visibility: 'private', ...extra,
});
const beans = [
  { id: 'bean-a', name: '耶加雪菲', archived: false },
  { id: 'bean-b', name: '肯亞', archived: true }, // 已封存也要算
  { id: 'bean-c', name: '哥倫比亞', archived: false },
];
const grinders = [{ id: 'g-1', name: 'C40', archived: true }, { id: 'g-2', name: 'Ode', archived: false }];
const drippers = [{ id: 'd-v60', name: 'V60', archived: false }, { id: 'd-kalita', name: 'Kalita', archived: true }];
const NOW = new Date('2026-10-25T12:00');

/* ===== 日期工具 ===== */
check('週一是一週的開始（2026-10-25 是週日 → 10/19）', weekStart('2026-10-25') === '2026-10-19');
check('週一當天就是那週的開始', weekStart('2026-10-19') === '2026-10-19');
check('跨年：2026-01-01（週四）那週從 2025-12-29 開始', weekStart('2026-01-01') === '2025-12-29');
check('跨年：2027-01-03（週日）那週從 2026-12-28 開始', weekStart('2027-01-03') === '2026-12-28');
check('addDays 跨月、跨年', addDays('2026-12-30', 3) === '2027-01-02' && addDays('2026-03-01', -1) === '2026-02-28');
check('localDate 用本機時間（台灣 00:30 還是當天）', localDate(new Date('2026-10-25T00:30').toISOString()) === '2026-10-25');

/* ===== 粉水比分組的邊界 ===== */
check('15.49 → 1:15–1:15.5', ratioBucket(15.49) === 15);
check('15.5 → 1:15.5–1:16（下限包含）', ratioBucket(15.5) === 15.5);
check('15.999 → 1:15.5–1:16', ratioBucket(15.999) === 15.5);
check('16.0 → 1:16–1:16.5', ratioBucket(16) === 16);
check('240/15 = 16 → 1:16（不會因浮點誤差落到前一組）', ratioBucket(240 / 15) === 16);
check('浮點誤差：248/15.5 = 16 → 1:16', ratioBucket(248 / 15.5) === 16 && ratioBucket(0.1 * 3 * 10 * 5.5) === ratioBucket(16.5));

/* ===== 空資料 ===== */
const empty = computeStats({ brews: [], beans, grinders, drippers, now: NOW });
check('空資料：0 杯、不夠畫圖', empty.cups === 0 && empty.enough === false);
check('空資料：總覽沒有平均、最常沖的豆子', empty.overview.avgRating === null && empty.overview.topBean === null && empty.overview.totalCoffeeG === 0);
check('空資料：每個圖表都是空的（不會丟錯）', [empty.ratingTrend.points, empty.ratingTrend.movingAvg, empty.beans, empty.ratios,
  empty.temps, empty.drippers, empty.grinders, empty.weeks].every((a) => a.length === 0));

/* ===== 只有 1 杯 ===== */
const one = computeStats({ brews: [brew('2026-10-20T08:00', { rating: 4 })], beans, grinders, drippers, now: NOW });
check('只有 1 杯：不夠畫圖（少於 3 杯）', one.cups === 1 && one.enough === false);
check('只有 1 杯：總覽照樣算', one.overview.avgRating === 4 && one.overview.totalCoffeeG === 15 && one.overview.topBean?.name === '耶加雪菲');
check('只有 1 杯：沒有移動平均', one.ratingTrend.points.length === 1 && one.ratingTrend.movingAvg.length === 0);
check('只有 1 杯：樣本少', one.beans[0]?.small === true && one.beans[0]?.cups === 1);
check('「全部」的每週從第一杯那週到本週（同一週＝1 格）', q(one.weeks) === q([{ start: '2026-10-19', end: '2026-10-25', count: 1 }]));

/* ===== 沒評分的紀錄 ===== */
const unrated = computeStats({
  brews: [brew('2026-10-20T08:00'), brew('2026-10-21T08:00'), brew('2026-10-22T08:00', { rating: 5 })], beans, grinders, drippers, now: NOW,
});
check('沒評分的也算杯數、克數', unrated.cups === 3 && unrated.overview.totalCoffeeG === 45 && unrated.enough);
check('平均評分只算有評分的', unrated.overview.avgRating === 5 && unrated.overview.ratedCups === 1);
check('評分變化只有有評分的點', unrated.ratingTrend.points.length === 1);
check('每支豆子、器材的平均只算有評分的', unrated.beans[0].cups === 1 && unrated.drippers[0].cups === 1);
const noRating = computeStats({ brews: [brew('2026-10-20T08:00'), brew('2026-10-21T08:00'), brew('2026-10-22T08:00')], beans, grinders, drippers, now: NOW });
check('全部沒評分：平均是 null，評分相關的圖是空的', noRating.overview.avgRating === null && noRating.ratingTrend.points.length === 0
  && noRating.beans.length === 0 && noRating.drippers.length === 0);
check('全部沒評分：參數、每週照樣有', noRating.ratios.length === 1 && noRating.weeks.length === 1);

/* ===== 移動平均 ===== */
const ratings = [1, 2, 3, 4, 5, 5, 5, 1, 1];
const trend = computeStats({
  brews: ratings.map((rating, i) => brew(`2026-10-${String(10 + i).padStart(2, '0')}T08:00`, { rating })), beans, grinders, drippers, now: NOW,
}).ratingTrend;
check(`移動平均從第 ${MA_WINDOW} 杯開始`, trend.movingAvg.length === ratings.length - MA_WINDOW + 1 && trend.movingAvg[0].index === MA_WINDOW - 1);
check('移動平均的值（1–7 杯 25/7、2–8 杯 25/7、3–9 杯 24/7）',
  near(trend.movingAvg[0].value, 25 / 7) && near(trend.movingAvg[1].value, 25 / 7) && near(trend.movingAvg[2].value, 24 / 7),
  q(trend.movingAvg.map((m) => m.value.toFixed(3))));
check('評分的點依時間舊→新', trend.points.map((p) => p.rating).join() === ratings.join());
const shuffled = computeStats({
  brews: [brew('2026-10-12T08:00', { rating: 3 }), brew('2026-10-10T08:00', { rating: 1 }), brew('2026-10-11T08:00', { rating: 2 })],
  beans, grinders, drippers, now: NOW,
});
check('輸入順序亂的也依時間排', shuffled.ratingTrend.points.map((p) => p.rating).join() === '1,2,3');

/* ===== 跨年的週 ===== */
const newYear = computeStats({
  brews: [brew('2026-12-15T08:00'), brew('2026-12-31T08:00'), brew('2027-01-02T08:00'), brew('2027-01-04T08:00')],
  beans, grinders, drippers, now: new Date('2027-01-10T12:00'),
});
check('跨年的週：12/14、12/21（0 杯）、12/28（12/31＋1/2 同一週）、1/4、本週（1/4–1/10）',
  q(newYear.weeks.map((w) => [w.start, w.count])) === q([['2026-12-14', 1], ['2026-12-21', 0], ['2026-12-28', 2], ['2027-01-04', 1]]),
  q(newYear.weeks.map((w) => [w.start, w.count])));
check('沒沖的週是 0、每週的結束是週日', newYear.weeks[1].count === 0 && newYear.weeks[2].end === '2027-01-03');
const recent = computeStats({ brews: [brew('2026-10-24T08:00')], beans, grinders, drippers, period: '30', now: NOW });
check('近 30 天：從 30 天前那週開始，前面沒沖的週都是 0', recent.weeks[0].start === weekStart(localDate(new Date(NOW - 30 * 86400000)))
  && recent.weeks.at(-1).count === 1 && recent.weeks.slice(0, -1).every((w) => w.count === 0), `${recent.weeks.length} 週`);

/* ===== 期間、豆子篩選、封存的豆子與器材 ===== */
const mixed = [
  brew('2026-06-01T08:00', { beanId: 'bean-b', rating: 5, grinderId: 'g-1' }), // 146 天前，封存的豆子、磨豆機
  brew('2026-08-10T08:00', { beanId: 'bean-b', rating: 4, grinderId: 'g-1' }), // 76 天前
  brew('2026-10-01T08:00', { beanId: 'bean-a', rating: 3, grinderId: 'g-2', dripperId: 'd-kalita' }),
  brew('2026-10-20T08:00', { beanId: 'bean-a', rating: 4, grinderId: 'g-2', dripperId: 'd-kalita' }),
  brew('2026-10-21T08:00', { beanId: 'bean-a', rating: 5, grinderId: 'g-2', dripperId: '' }),
];
check('全部：5 杯（含已封存的豆子、磨豆機）', computeStats({ brews: mixed, beans, grinders, drippers, now: NOW }).cups === 5);
check('近 90 天：4 杯', computeStats({ brews: mixed, beans, grinders, drippers, period: '90', now: NOW }).cups === 4);
check('近 30 天：3 杯', computeStats({ brews: mixed, beans, grinders, drippers, period: '30', now: NOW }).cups === 3);
const onlyB = computeStats({ brews: mixed, beans, grinders, drippers, beanId: 'bean-b', now: NOW });
check('篩選單一支豆子（已封存的肯亞）', onlyB.cups === 2 && onlyB.beans.length === 1 && onlyB.beans[0].name === '肯亞');
const all = computeStats({ brews: mixed, beans, grinders, drippers, now: NOW });
check('封存的磨豆機也在器材比較裡', all.grinders.some((g) => g.name === 'C40' && g.cups === 2));
check('濾杯依 dripperId 分組、未指定的不算、封存的也算（V60 是肯亞那兩杯）', q(all.drippers.map((d) => [d.id, d.name, d.cups])) === q([['d-v60', 'V60', 2], ['d-kalita', 'Kalita', 2]]), q(all.drippers));
check('已刪除的濾杯顯示「已刪除的濾杯」', computeStats({ brews: [brew('2026-10-20T08:00', { dripperId: 'gone', rating: 3 })], beans, grinders, drippers, now: NOW })
  .drippers[0].name === '（已刪除的濾杯）');
check('最常沖的豆子：杯數最多', all.overview.topBean?.name === '耶加雪菲' && all.overview.topBean.cups === 3);
const tie = computeStats({ brews: mixed.slice(0, 2).concat(mixed.slice(3)), beans, grinders, drippers, now: NOW });
check('最常沖的豆子：同杯數取最近沖的', tie.overview.topBean?.name === '耶加雪菲', q(tie.overview.topBean));
check('已刪除的豆子顯示「已刪除的豆子」', computeStats({ brews: [brew('2026-10-20T08:00', { beanId: 'gone', rating: 3 })], beans, grinders, drippers, now: NOW })
  .beans[0].name === '（已刪除的豆子）');

/* ===== 樣本少的排序 ===== */
const ranking = computeStats({
  brews: [
    ...[3, 3, 4].map((rating) => brew('2026-10-01T08:00', { beanId: 'bean-a', rating })),        // 平均 3.33，3 杯
    ...[5, 5].map((rating) => brew('2026-10-02T08:00', { beanId: 'bean-b', rating })),           // 平均 5，2 杯（樣本少）
    ...[4, 4, 4, 5].map((rating) => brew('2026-10-03T08:00', { beanId: 'bean-c', rating })),     // 平均 4.25，4 杯
  ], beans, grinders, drippers, now: NOW,
});
check('每支豆子：樣本夠的先、平均高→低；樣本少的排後面（即使平均最高）',
  q(ranking.beans.map((b) => [b.name, b.small])) === q([['哥倫比亞', false], ['耶加雪菲', false], ['肯亞', true]]), q(ranking.beans));

/* ===== 常用參數 ===== */
const params = computeStats({
  brews: [
    brew('2026-10-01T08:00', { coffeeG: 15, waterG: 240, tempC: 92.5 }),  // 1:16、92
    brew('2026-10-02T08:00', { coffeeG: 15, waterG: 240, tempC: 92 }),    // 1:16、92
    brew('2026-10-03T08:00', { coffeeG: 20, waterG: 300, tempC: 93.9 }),  // 1:15、93
    brew('2026-10-04T08:00', { coffeeG: 16, waterG: 248, tempC: 90 }),    // 1:15.5、90
    brew('2026-10-05T08:00', { coffeeG: 15, waterG: 250, tempC: null }),  // 1:16.5（16.67）
    brew('2026-10-06T08:00', { coffeeG: 15, waterG: 250, tempC: null }),  // 1:16.5
  ], beans, grinders, drippers, now: NOW,
});
check('粉水比前 3 名（次數多→值小）', q(params.ratios) === q([{ from: 16, to: 16.5, count: 2 }, { from: 16.5, to: 17, count: 2 }, { from: 15, to: 15.5, count: 1 }]),
  q(params.ratios));
check('水溫以 1°C 分組（92.5 算 92）、沒填的不算、前 3 名', q(params.temps) === q([{ temp: 92, count: 2 }, { temp: 90, count: 1 }, { temp: 93, count: 1 }]),
  q(params.temps));

/* ===== 沖煮方式（1.21.0） ===== */
const methods = [
  brew('2026-10-20T08:00', { rating: 4 }),                                       // 舊紀錄沒有 method＝手沖
  brew('2026-10-21T08:00', { rating: 3, method: 'pourover' }),
  brew('2026-10-22T08:00', { rating: 5, method: 'siphon', dripperId: '' }),
  brew('2026-10-23T08:00', { rating: 5, method: 'siphon', dripperId: 'd-v60' }), // 就算有 dripperId，賽風也不算進濾杯
];
const mAll = computeStats({ brews: methods, beans, grinders, drippers, now: NOW });
const mPour = computeStats({ brews: methods, beans, grinders, drippers, method: 'pourover', now: NOW });
const mSiphon = computeStats({ brews: methods, beans, grinders, drippers, method: 'siphon', now: NOW });
check('沖煮方式：全部 4 杯、手沖 2 杯（含沒有 method 的舊紀錄）、賽風 2 杯', mAll.cups === 4 && mPour.cups === 2 && mSiphon.cups === 2);
check('濾杯比較只算手沖', mAll.drippers.length === 1 && mAll.drippers[0].cups === 2 && mSiphon.drippers.length === 0, q(mAll.drippers));
check('賽風的平均評分', mSiphon.overview.avgRating === 5);

console.log(`\n${passed}/${passed + failures.length} 通過`);
if (failures.length) {
  console.log(`失敗：\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
}
