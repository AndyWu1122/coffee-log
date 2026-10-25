// 沖煮熱度圖的計算（js/heatmap.js）：不需要 Supabase、不需要瀏覽器
// 在台灣時區執行：空資料、跨年、閏年、23:59 和 00:01 算不同天、53×7 的格子、顏色級數、連續天數、近一年範圍、一天最多 50 杯
//
// 用法：node scripts/heatmap-test.mjs

process.env.TZ = 'Asia/Taipei'; // 在第一次用到 Date 之前設定

const { summarize, activityRows, fromActivity, streaks, level, buildHeatmap, windowStart, WEEKS, MAX_CUPS } = await import('../js/heatmap.js');
const { addDays } = await import('../js/stats.js');

let passed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) passed++;
  else failures.push(name);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
const q = JSON.stringify;

/** 台灣時間的 ISO 字串（紀錄存的是 UTC 的 ISO） */
const tw = (date, time = '08:00') => new Date(`${date}T${time}:00+08:00`).toISOString();
const brew = (date, time, rating = null) => ({ brewedAt: tw(date, time), rating });
const daysOf = (...dates) => summarize(dates.map((d) => brew(d, '09:00')));
const cells = (h) => h.weeks.flat().filter(Boolean);

/* ===== 空資料 ===== */
{
  const h = buildHeatmap(new Map(), { today: '2026-10-24' });
  check('空資料：53 欄 × 7 格', h.weeks.length === WEEKS && h.weeks.every((w) => w.length === 7));
  check('空資料：總杯數 0、連續 0、最長 0', h.total === 0 && h.current === 0 && h.longest === 0, q({ total: h.total, current: h.current, longest: h.longest }));
  check('空資料：每格都是 0 級', cells(h).every((c) => c.level === 0 && c.cups === 0));
  check('空資料：上傳的內容是空的', activityRows([], '2026-10-24').length === 0);
}

/* ===== 格子的排法 ===== */
{
  // 2026-10-24 是週六
  const h = buildHeatmap(new Map(), { today: '2026-10-24' });
  const last = h.weeks[WEEKS - 1];
  check('最右欄是本週：週一 10/19 開始', last[0].day === '2026-10-19', last[0].day);
  check('今天（週六）在最右欄第 6 格、標成今天', last[5].day === '2026-10-24' && last[5].isToday);
  check('今天之後（週日）不畫', last[6] === null);
  check('只有今天標成今天', cells(h).filter((c) => c.isToday).length === 1);
  check('第一欄也從週一開始、整整 52 週前', h.weeks[0][0].day === addDays('2026-10-19', -52 * 7), h.weeks[0][0].day);
  check('每一欄都是週一→週日、日期連續', h.weeks.every((w, col) => w.every((c, row) => !c || c.day === addDays(h.weeks[0][0].day, col * 7 + row))));
  const monday = buildHeatmap(new Map(), { today: '2026-10-19' });
  check('今天是週一：最右欄只有一格', monday.weeks[WEEKS - 1].filter(Boolean).length === 1);
  const sunday = buildHeatmap(new Map(), { today: '2026-10-25' });
  check('今天是週日：最右欄 7 格都有', sunday.weeks[WEEKS - 1].every(Boolean));
  check('月份標籤：寫在 1 號所在的那一欄，依序遞增、不擠在一起',
    h.months.length >= 11 && h.months.every((m, i) => {
      const firstOfMonth = h.weeks[m.col].some((c) => c && c.day.endsWith('-01') && Number(c.day.slice(5, 7)) === m.month);
      return firstOfMonth && (i === 0 || m.col - h.months[i - 1].col >= 3);
    }), q(h.months));
  check('月份標籤包含本月（10 月）', h.months.some((m) => m.month === 10));
}

/* ===== 時區：23:59 和 00:01 算不同天 ===== */
{
  const days = summarize([brew('2026-10-23', '23:59'), brew('2026-10-24', '00:01')]);
  check('台灣時間 23:59 和隔天 00:01 是不同天', days.get('2026-10-23')?.cups === 1 && days.get('2026-10-24')?.cups === 1, q([...days]));
  // UTC 是同一天（10/23 15:59Z 和 16:01Z），本機日期卻不同
  check('（UTC 的日期相同，照本機日期分開）', tw('2026-10-23', '23:59').slice(0, 10) === tw('2026-10-24', '00:01').slice(0, 10));
  const sameDay = summarize([brew('2026-10-24', '00:00'), brew('2026-10-24', '23:59')]);
  check('00:00 和 23:59 是同一天', sameDay.get('2026-10-24')?.cups === 2 && sameDay.size === 1);
}

/* ===== 跨年 ===== */
{
  const days = daysOf('2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02');
  const h = buildHeatmap(days, { today: '2026-01-02' });
  check('跨年：12/31 → 1/1 連續', h.current === 4 && h.longest === 4, q({ current: h.current, longest: h.longest }));
  const col = h.weeks.findIndex((w) => w.some((c) => c?.day === '2026-01-01'));
  check('跨年：1 月的標籤在 1/1 那一欄', h.months.some((m) => m.month === 1 && m.col === col), q(h.months.slice(-2)));
  check('跨年：12/31 和 1/1 是同一週（週三、週四）', h.weeks[col].some((c) => c?.day === '2025-12-31'));
}

/* ===== 閏年 ===== */
{
  check('閏年：2028-02-28 的隔天是 02-29、再隔天是 03-01', addDays('2028-02-28', 1) === '2028-02-29' && addDays('2028-02-29', 1) === '2028-03-01');
  check('平年：2027-02-28 的隔天是 03-01', addDays('2027-02-28', 1) === '2027-03-01');
  const days = daysOf('2028-02-28', '2028-02-29', '2028-03-01');
  const h = buildHeatmap(days, { today: '2028-03-01' });
  check('閏年：2/29 有格子、算進連續天數', cells(h).some((c) => c.day === '2028-02-29' && c.cups === 1) && h.current === 3);
  check('閏年：近一年從 2027-03-03 開始（含今天共 365 天）', windowStart('2028-03-01') === '2027-03-03', windowStart('2028-03-01'));
  const all = cells(buildHeatmap(new Map(), { today: '2027-03-01' }));
  check('平年的熱度圖沒有 2/29', !all.some((c) => c.day.endsWith('-02-29')));
  check('格子日期都不重複', new Set(all.map((c) => c.day)).size === all.length);
}

/* ===== 顏色級數 ===== */
{
  check('杯數：0、1、2、3、4 以上分 5 級',
    [0, 1, 2, 3, 4, 9].map((cups) => level(cups ? { cups, avg: null } : null, 'cups')).join() === '0,1,2,3,4,4');
  check('平均評分：沒有評分 0，<2、<3、<4、≥4 是 1–4',
    [null, 1, 1.9, 2, 2.5, 3, 3.99, 4, 5].map((avg) => level({ cups: 1, avg }, 'rating')).join() === '0,1,1,2,2,3,3,4,4');
  const days = summarize([brew('2026-10-24', '08:00', 5), brew('2026-10-24', '09:00', 4), brew('2026-10-24', '10:00')]);
  check('平均只算有評分的杯（5、4、沒評 → 4.5，3 杯）', days.get('2026-10-24').avg === 4.5 && days.get('2026-10-24').cups === 3);
  const h = buildHeatmap(days, { today: '2026-10-24', mode: 'rating' });
  check('平均評分模式：今天是 4 級', cells(h).find((c) => c.isToday).level === 4);
  const unrated = buildHeatmap(daysOf('2026-10-24'), { today: '2026-10-24', mode: 'rating' });
  check('平均評分模式：有沖但沒評分是 0 級（杯數照樣在）', cells(unrated).find((c) => c.isToday).level === 0 && cells(unrated).find((c) => c.isToday).cups === 1);
}

/* ===== 連續天數 ===== */
{
  const today = '2026-10-24';
  const run = (n, end = today) => Array.from({ length: n }, (_, i) => addDays(end, -i));
  check('今天有沖：連續 3 天', streaks(daysOf(...run(3)), today).current === 3);
  check('今天還沒沖、昨天有：從昨天往回算', streaks(daysOf(...run(4, '2026-10-23')), today).current === 4);
  check('昨天和今天都沒沖：0', streaks(daysOf(...run(5, '2026-10-22')), today).current === 0);
  const broken = daysOf(...run(2), ...run(6, '2026-10-10'));
  const s = streaks(broken, today);
  check('中斷過：目前 2、最長 6', s.current === 2 && s.longest === 6, q(s));
  check('全年每天都有：365', q(streaks(daysOf(...run(400)), today)) === q({ current: 365, longest: 365 }));
  const old = daysOf(...run(30, '2025-06-01'));
  check('一年以前的連續不算最長', streaks(old, today).longest === 0);
}

/* ===== 上傳的內容（近 365 天、最多 50 杯） ===== */
{
  const today = '2026-10-24';
  const from = windowStart(today);
  const brews = [
    brew(from, '09:00'), brew(addDays(from, -1), '09:00'), brew(today, '23:59'), brew(addDays(today, 1), '09:00'),
    ...Array.from({ length: 60 }, () => brew('2026-10-01', '10:00')),
  ];
  const rows = activityRows(brews, today);
  check('只上傳近 365 天（含第一天和今天、不含 366 天前和明天）', q(rows.map((r) => r.day)) === q([from, '2026-10-01', today]), q(rows.map((r) => r.day)));
  check('一天超過 50 杯算 50', rows.find((r) => r.day === '2026-10-01').cups === MAX_CUPS);
  check('上傳的列只有 day 和 cups（沒有評分等其他資料）', rows.every((r) => q(Object.keys(r)) === q(['day', 'cups'])));
  const friend = buildHeatmap(fromActivity(rows), { today });
  check('好友的資料：總杯數＝雲端加總、沒有評分', friend.total === 52 && cells(friend).every((c) => c.avg === null), String(friend.total));
  const own = buildHeatmap(summarize(brews), { today });
  check('自己看的總杯數是實際杯數（不截 50）、不含一年前和未來', own.total === 62, String(own.total));
}

console.log(`\n${passed}/${passed + failures.length} 通過`);
if (failures.length) {
  console.log(`失敗：\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
}
