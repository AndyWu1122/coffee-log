// 產地（js/origins.js、js/worldMap.js）：不需要 Supabase、不需要瀏覽器
// 清單本身（代碼、key、別名不重複）、每個產區的點落在自己的國家裡、地圖的國名與標字位置、產地介紹的格式、從文字比對產地、顯示用的產地、
// 產地地圖的統計、地圖的放大拖曳與國名的擺放（js/mapView.js）
//
// 用法：node scripts/origins-test.mjs

const {
  COUNTRIES, REGIONS, COUNTRY_BY_CODE, ORIGIN_GROUPS, matchOrigin, beanPlace, originLabel, normalizeText, cupLevel, summarizeOrigins,
} = await import('../js/origins.js');
const { COUNTRY_SHAPES, MAP_SCALE } = await import('../js/worldMap.js');
const { COUNTRY_GUIDE, REGION_GUIDE, GUIDE_PROCESS } = await import('../js/originGuide.js');
const { isFlavorNote } = await import('../js/flavorWheel.js');
const { fitView, viewBox, clampView, zoomAt, panBy, placeLabels, toScreen } = await import('../js/mapView.js');

let passed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) passed++;
  else failures.push(name);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
const q = JSON.stringify;

/* ===== 清單本身 ===== */
{
  const codes = COUNTRIES.map((c) => c.code);
  check('國家代碼不重複', new Set(codes).size === codes.length);
  const keys = REGIONS.map((r) => r.key);
  check('產區 key 不重複、格式 <國家>.<小寫英文>', new Set(keys).size === keys.length && keys.every((k) => /^[A-Z]{2}\.[a-z]+$/.test(k)));
  check('每個產區的國家都在清單裡', REGIONS.every((r) => COUNTRY_BY_CODE.has(r.country)));
  check('每個國家都有分組', COUNTRIES.every((c) => Object.hasOwn(ORIGIN_GROUPS, c.group)));
  check(`產區至少 40 個（目前 ${REGIONS.length}）`, REGIONS.length >= 40);
  const owner = new Map();
  const dup = [];
  for (const [id, aliases] of [...COUNTRIES.map((c) => [c.code, c.aliases]), ...REGIONS.map((r) => [r.key, r.aliases])]) {
    for (const a of aliases) {
      const t = normalizeText(a);
      if (!t.trim()) dup.push(`${id}：空的別名`);
      if (owner.has(t) && owner.get(t) !== id) dup.push(`${t}：${owner.get(t)}、${id}`);
      owner.set(t, id);
    }
  }
  check('同一個別名不會指到兩個地方', dup.length === 0, dup.join('；'));
  check('每個國家的中文名稱、英文名稱都是別名（選了國家的豆子也比對得到）',
    COUNTRIES.every((c) => matchOrigin(c.zh)?.country === c.code));
  // 盧安達的「西部省」「南部省」太籠統，不當別名（用地名比對）
  const unmatched = REGIONS.filter((r) => !r.aliases.every((a) => matchOrigin(a)?.region === r.key));
  check('每個產區的每個別名都比對得到自己', unmatched.length === 0, unmatched.map((r) => r.key).join(', '));
}

/* ===== 地圖：每個產區的點落在自己的國家裡 ===== */
const shapeOf = new Map(COUNTRY_SHAPES.filter((s) => s.code).map((s) => [s.code, s]));
/** 路徑（M x y l dx dy … z）→ 每個環的點 */
function rings(d) {
  return d.split('M').filter(Boolean).map((part) => {
    const nums = part.match(/-?\d+/g).map(Number);
    const pts = [[nums[0], nums[1]]];
    for (let i = 2; i < nums.length; i += 2) {
      const [x, y] = pts.at(-1);
      pts.push([x + nums[i], y + nums[i + 1]]);
    }
    return pts;
  });
}
/** even-odd：點在國家的任何一塊陸地裡（湖等內環扣掉） */
function inside(shape, [px, py]) {
  let hit = false;
  for (const ring of rings(shape.d)) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
    }
  }
  return hit;
}
const toMap = (lat, lon) => [(lon + 180) * MAP_SCALE, (90 - lat) * MAP_SCALE];
{
  check('每個國家都有地圖形狀', COUNTRIES.every((c) => shapeOf.has(c.code)), COUNTRIES.filter((c) => !shapeOf.has(c.code)).map((c) => c.code).join(', '));
  const outside = REGIONS.filter((r) => shapeOf.has(r.country) && !inside(shapeOf.get(r.country), toMap(r.lat, r.lon)));
  check('每個產區的點都在自己的國家裡', outside.length === 0, outside.map((r) => `${r.key} (${r.lat}, ${r.lon})`).join('；'));
  const badView = COUNTRIES.filter((c) => c.view).filter((c) => {
    const [w, s, e, n] = c.view;
    return !REGIONS.filter((r) => r.country === c.code).every((r) => r.lon > w && r.lon < e && r.lat > s && r.lat < n);
  });
  check('自訂的放大範圍包含那個國家所有的產區', badView.length === 0, badView.map((c) => c.code).join(', '));
  check('南極洲不畫', !shapeOf.has('AQ'));
  const kb = Buffer.byteLength(JSON.stringify(COUNTRY_SHAPES)) / 1024;
  check(`地圖資料 ≤ 200KB（目前 ${kb.toFixed(0)}KB）`, kb <= 200);
  const badLabel = COUNTRY_SHAPES.filter((sh) => typeof sh.zh !== 'string' || !(sh.label?.length === 2 && sh.label.every(Number.isFinite)));
  check('每個國家都有國名（字串）和標字位置', badLabel.length === 0, badLabel.map((sh) => sh.code).join(', '));
  const named = new Map(COUNTRY_SHAPES.filter((sh) => sh.zh).map((sh) => [sh.code, sh]));
  check('產咖啡的國家都有標國名的那一塊', COUNTRIES.every((c) => named.has(c.code)));
  const sameCode = COUNTRY_SHAPES.filter((sh) => sh.code && sh.zh).map((sh) => sh.code);
  check('同一個代碼只標一次國名', new Set(sameCode).size === sameCode.length);
  const zh = (code) => named.get(code)?.zh;
  check('國名用台灣的寫法（台灣、中國、紐西蘭、澳洲）', zh('TW') === '台灣' && zh('CN') === '中國' && zh('NZ') === '紐西蘭' && zh('AU') === '澳洲',
    [zh('TW'), zh('CN'), zh('NZ'), zh('AU')].join('、'));
  // 標字位置在最大那塊陸地的外框裡（例外：產國的國名在 App 裡另外處理的美國→本土、印尼→群島中間，外框只是最大那塊）
  const labelOutside = COUNTRIES.filter((c) => !['US', 'ID'].includes(c.code)).filter((c) => {
    const { label: [x, y], box: [x0, y0, x1, y1] } = named.get(c.code);
    return x < x0 || x > x1 || y < y0 || y > y1;
  });
  check('產國的標字位置落在那個國家', labelOutside.length === 0, labelOutside.map((c) => c.code).join(', '));
}

/* ===== 放大、拖曳（js/mapView.js） ===== */
{
  const size = { w: 400, h: 200 };
  const limits = { bounds: { x: 0, y: 0, w: 4000, h: 2000 }, minK: 0.1, maxK: 2 };
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const fit = fitView({ x: 100, y: 100, w: 800, h: 200 }, size);
  check('fitView：放得下整個範圍（取寬、高比較小的那個）、中心在範圍中間', near(fit.k, 0.5) && fit.cx === 500 && fit.cy === 200, q(fit));
  const vb = viewBox({ cx: 500, cy: 200, k: 0.5 }, size);
  check('viewBox：依地圖框大小和縮放', q(vb) === q({ x: 100, y: 0, w: 800, h: 400 }), q(vb));
  check('toScreen：中心點在地圖框正中間', q(toScreen({ cx: 500, cy: 200, k: 0.5 }, size, 500, 200)) === q([200, 100]));
  let v = clampView({ cx: -500, cy: 5000, k: 1 }, size, limits);
  check('clampView：不能拖到範圍外', v.cx === 200 && v.cy === 1900, q(v));
  v = clampView({ cx: 3000, cy: 300, k: 0.05 }, size, limits);
  check('clampView：縮放有下限；比範圍大的那一邊置中', v.k === 0.1 && v.cx === 2000 && v.cy === 1000, q(v));
  check('clampView：縮放有上限', clampView({ cx: 2000, cy: 1000, k: 9 }, size, limits).k === 2);
  const before = { cx: 2000, cy: 1000, k: 0.5 };
  const p = [300, 50];
  const mapPoint = (view) => [view.cx + (p[0] - size.w / 2) / view.k, view.cy + (p[1] - size.h / 2) / view.k];
  const zoomed = zoomAt(before, 2, p[0], p[1], size, limits);
  check('zoomAt：放大 2 倍、手指下的那一點不動', zoomed.k === 1 && mapPoint(zoomed).every((n, i) => near(n, mapPoint(before)[i])), q(zoomed));
  check('zoomAt：超過上限就停在上限', zoomAt(before, 100, 200, 100, size, limits).k === 2);
  const panned = panBy(before, 50, -20, size, limits);
  check('panBy：手指往右拖 50px，看的範圍往左（地圖跟著手指）', panned.cx === 1900 && panned.cy === 1040 && panned.k === 0.5, q(panned));
}

/* ===== 國名的擺放（js/mapView.js 的 placeLabels） ===== */
{
  const size = { w: 300, h: 200 };
  const view = { cx: 150, cy: 100, k: 1 };
  const L = (id, x, y, extra = {}) => ({ id, x, y, w: 60, h: 16, rank: 1, priority: 0, ...extra });
  let shown = placeLabels([L('a', 100, 100), L('b', 120, 100, { priority: 5 }), L('c', 200, 100)], view, size);
  check('重疊時 priority 大的先放，被擋住的不顯示；不重疊的照樣顯示', q([...shown.keys()].sort()) === q(['b', 'c']), q([...shown]));
  shown = placeLabels([L('low', 100, 100, { rank: 2, priority: 99 }), L('high', 110, 100, { rank: 1 })], view, size);
  check('rank 小的先放（不管 priority）', shown.has('high') && !shown.has('low'), q([...shown]));
  shown = placeLabels([L('edge', 10, 100), L('out', 500, 100), L('ok', 150, 100)], view, size);
  check('超出地圖框（含部分超出）的不顯示', q([...shown]) === q([['ok', 'middle']]), q([...shown]));
  shown = placeLabels([L('dot', 150, 100)], view, size, { obstacles: [{ x: 150, y: 100, r: 6 }] });
  check('會蓋住圓點的不顯示', shown.size === 0);
  const side = (extra) => L('s', 150, 100, { anchor: 'side', dx: 10, ...extra });
  shown = placeLabels([side()], view, size, { obstacles: [{ x: 150, y: 100, r: 6 }] });
  check('產區名放在圓點右邊（不蓋住自己的圓點）', shown.get('s') === 'right', q([...shown]));
  shown = placeLabels([side(), L('block', 200, 100, { rank: 0 })], view, size, { obstacles: [{ x: 150, y: 100, r: 6 }] });
  check('右邊被擋住就放左邊', shown.get('s') === 'left' && shown.get('block') === 'middle', q([...shown]));
  shown = placeLabels([side({ x: 40 }), L('block', 90, 100, { rank: 0 })], view, size);
  check('兩邊都放不下就不顯示', !shown.has('s'), q([...shown]));
  shown = placeLabels([L('btn', 260, 180), L('ok', 150, 100)], view, size, { reserved: [[250, 120, 300, 200]] });
  check('reserved（放大按鈕）蓋住的地方不放字', q([...shown.keys()]) === q(['ok']), q([...shown]));
  shown = placeLabels([L('a', 100, 100), L('b', 100, 117)], view, size);
  check('上下貼太近（間隔 < 2px）也算重疊', shown.size === 1, q([...shown]));
  shown = placeLabels([L('a', 100, 100), L('b', 100, 125)], view, size);
  check('隔得夠遠就兩個都顯示', shown.size === 2, q([...shown]));
  const zoomedIn = placeLabels([L('a', 100, 100), L('b', 110, 100)], { cx: 105, cy: 100, k: 8 }, size);
  check('放大後原本擠在一起的都放得下', zoomedIn.size === 2, q([...zoomedIn]));
}

/* ===== 產地介紹（js/originGuide.js） ===== */
{
  const codes = COUNTRIES.map((c) => c.code);
  check('每個國家都有介紹、沒有多出來的', codes.every((c) => COUNTRY_GUIDE[c]) && Object.keys(COUNTRY_GUIDE).every((c) => codes.includes(c)),
    codes.filter((c) => !COUNTRY_GUIDE[c]).join(', '));
  const regionKeys = Object.keys(REGION_GUIDE);
  check(`產區的詳細介紹至少 20 個（目前 ${regionKeys.length}）`, regionKeys.length >= 20);
  check('產區介紹的 key 都在產區清單裡', regionKeys.every((k) => REGIONS.some((r) => r.key === k)), regionKeys.filter((k) => !REGIONS.some((r) => r.key === k)).join(', '));
  const entries = [...Object.entries(COUNTRY_GUIDE), ...Object.entries(REGION_GUIDE)];
  const problems = [];
  for (const [key, g] of entries) {
    const [min, max] = g.altitude ?? [];
    if (!(Number.isInteger(min) && Number.isInteger(max) && min > 0 && min < max && max <= 3000)) problems.push(`${key}：海拔`);
    if (!g.processes?.length || !g.processes.every((p) => Object.hasOwn(GUIDE_PROCESS, p))) problems.push(`${key}：處理法`);
    const flavors = Array.isArray(g.flavors) ? g.flavors : Object.values(g.flavors ?? {}).flat();
    if (!flavors.length || !flavors.every(isFlavorNote)) problems.push(`${key}：風味 ${flavors.filter((f) => !isFlavorNote(f)).join(' ')}`);
    if (!Array.isArray(g.flavors) && !Object.keys(g.flavors).every((p) => g.processes.includes(p))) problems.push(`${key}：風味的處理法不在 processes 裡`);
    if (!(typeof g.text === 'string' && g.text.length >= 30 && g.text.length <= 200)) problems.push(`${key}：文字長度 ${g.text?.length}`);
  }
  check('介紹的格式：海拔、處理法、風味（都是風味輪的 key）、文字 30–200 字', problems.length === 0, problems.join('；'));
  check('產區介紹的處理法都有寫風味', Object.entries(REGION_GUIDE).every(([, g]) => g.processes.every((p) => g.flavors[p]?.length)));
  check('產區介紹裡的海拔在國家的範圍附近（±500m）', Object.entries(REGION_GUIDE).every(([k, g]) => {
    const [cmin, cmax] = COUNTRY_GUIDE[k.split('.')[0]].altitude;
    return g.altitude[0] >= cmin - 500 && g.altitude[1] <= cmax + 500;
  }));
}

/* ===== 從文字比對產地 ===== */
{
  const cases = [
    [['衣索比亞 耶加雪菲 G1'], 'ET', 'ET.yirgacheffe'],
    [['Ethiopia Yirga Chefe'], 'ET', 'ET.yirgacheffe'],
    [['耶加'], 'ET', 'ET.yirgacheffe'],
    [['Konga 處理站'], 'ET', 'ET.yirgacheffe'],
    [['Kenya AA'], 'KE', ''],
    [['KENYA  Nyeri  AA'], 'KE', 'KE.nyeri'],
    [['Colombia Nariño'], 'CO', 'CO.narino'],
    [['colombia narino'], 'CO', 'CO.narino'],
    [["Kenya Murang'a"], 'KE', 'KE.muranga'],
    [['印度尼西亞 曼特寧'], 'ID', 'ID.mandheling'],   // 不是印度
    [['黃金曼特寧'], 'ID', 'ID.mandheling'],
    [['葉門 哈拉茲'], 'YE', 'YE.haraz'],             // 不是衣索比亞的哈拉
    [['盧安達 基伍湖'], 'RW', ''],                   // 寫了盧安達，不採用剛果的基伍
    [['剛果 基伍'], 'CD', 'CD.kivu'],
    [['Shantawene'], 'ET', 'ET.sidama'],             // shan 不會比對到 shantawene
    [['巴拿馬 翡翠莊園 藝伎'], 'PA', 'PA.boquete'],
    [['Panama Volcan'], 'PA', ''],                   // 只有 volcan 不夠（瓜地馬拉也有很多火山）
    [['臺灣 阿里山'], 'TW', 'TW.alishan'],
    [['Guatemala Antigua'], 'GT', 'GT.antigua'],
    [['', '衣索比亞 古吉 罕貝拉'], 'ET', 'ET.guji'],     // 產地沒寫，用名稱
    [['西達摩', '衣索比亞 耶加雪菲'], 'ET', 'ET.sidama'], // 產地文字先出現的優先
  ];
  for (const [texts, country, region] of cases) {
    const m = matchOrigin(...texts);
    check(`比對「${texts.filter(Boolean).join('／')}」→ ${country} ${region || '（沒有產區）'}`, m?.country === country && m?.region === region, q(m));
  }
  check('比對不到：house blend、空字串', matchOrigin('house blend') === null && matchOrigin('') === null && matchOrigin() === null);
}

/* ===== 豆子的產地、顯示用的文字 ===== */
{
  const chosen = beanPlace({ country: 'KE', region: '', origin: '衣索比亞 耶加雪菲', name: '' });
  check('選了國家就用選的（不用文字猜）', q(chosen) === q({ country: 'KE', region: '', guessed: false }), q(chosen));
  const guessed = beanPlace({ country: '', region: '', origin: '', name: '肯亞 涅里 AA' });
  check('沒選就從名稱猜，標 guessed', q(guessed) === q({ country: 'KE', region: 'KE.nyeri', guessed: true }), q(guessed));
  check('猜不到回傳 null', beanPlace({ name: '配方豆', origin: '' }) === null);
  const label = (b) => originLabel({ country: '', region: '', origin: '', ...b });
  check('顯示：國家＋產區＋產地文字', label({ country: 'ET', region: 'ET.yirgacheffe', origin: 'Konga 處理站' }) === '衣索比亞 耶加雪菲 Konga 處理站');
  check('顯示：產地文字已經寫了就不重複', label({ country: 'ET', region: 'ET.yirgacheffe', origin: '衣索比亞 耶加雪菲 G1' }) === '衣索比亞 耶加雪菲 G1');
  check('顯示：只選國家', label({ country: 'KE' }) === '肯亞');
  check('顯示：沒選就是原本的產地文字（不用猜的）', label({ origin: 'Yirga' }) === 'Yirga' && label({}) === '');
}

/* ===== 產地地圖的統計 ===== */
{
  check('顏色級數：0 / 1–4 / 5–14 / 15–39 / 40+',
    q([0, 1, 4, 5, 14, 15, 39, 40, 100].map(cupLevel)) === q([0, 1, 1, 2, 2, 3, 3, 4, 4]));
  const beans = [
    { id: 'a', name: '耶加 A', country: 'ET', region: 'ET.yirgacheffe', origin: '' },
    { id: 'b', name: '衣索比亞 古吉', country: '', region: '', origin: '' },      // 猜的
    { id: 'c', name: '衣索比亞 日曬', country: 'ET', region: '', origin: '' },   // 有國家沒產區
    { id: 'd', name: '肯亞 AA', country: 'KE', region: 'KE.nyeri', origin: '' },
    { id: 'e', name: '配方豆', country: '', region: '', origin: '' },            // 猜不到
    { id: 'f', name: '沒沖過', country: 'BR', region: '', origin: '' },
  ];
  const brew = (beanId, rating = null, flavorNotes = []) => ({ beanId, rating, flavorNotes });
  const brews = [
    brew('a', 4, ['floral.jasmine', 'fruity.citrus']), brew('a', 5, ['floral.jasmine']), brew('a', null, ['fruity.citrus']),
    brew('b', 3), brew('c', 4), brew('c'),
    brew('d', 2, ['fruity.berry']),
    brew('e', 5), brew('e'),
    brew('gone'), // 豆子不存在（不應該發生）：不算
  ];
  const s = summarizeOrigins(beans, brews);
  check('總杯數（豆子不存在的不算）', s.totalCups === 9, String(s.totalCups));
  check('國家依杯數排：衣索比亞 6、肯亞 1；沒沖過的不算', q(s.countries.map((c) => [c.code, c.cups])) === q([['ET', 6], ['KE', 1]]));
  const et = s.countries[0];
  check('衣索比亞：顏色第 2 級、平均評分只算有評分的', et.level === 2 && et.ratedCups === 4 && et.avgRating === 4, q({ level: et.level, rated: et.ratedCups, avg: et.avgRating }));
  check('衣索比亞的產區：耶加雪菲 3、古吉 1（猜的也算）', q(et.regions.map((r) => [r.key, r.cups])) === q([['ET.yirgacheffe', 3], ['ET.guji', 1]]));
  check('有國家沒產區的另外算', et.unassigned.cups === 2 && q(et.unassigned.beans.map((b) => b.id)) === q(['c']));
  const yirga = et.regions[0];
  check('最常選的風味：次數多→少，同次數依 key', q(yirga.notes) === q([{ key: 'floral.jasmine', count: 2 }, { key: 'fruity.citrus', count: 2 }]), q(yirga.notes));
  check('產地是猜的豆子標 guessed', et.regions[1].beans[0].guessed === true && yirga.beans[0].guessed === false);
  check('猜不到的豆子另外列', s.unknown.cups === 2 && q(s.unknown.beans.map((b) => [b.id, b.cups])) === q([['e', 2]]));
  const empty = summarizeOrigins([], []);
  check('沒有資料', empty.totalCups === 0 && empty.countries.length === 0 && empty.unknown.cups === 0);
}

/* ===== 國旗（icons/flags，見 icons/flags/README.md） ===== */
{
  const { readFileSync, readdirSync } = await import('node:fs');
  const dir = new URL('../icons/flags/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.svg'));
  const wanted = COUNTRIES.map((c) => `${c.code.toLowerCase()}.svg`);
  check('每個國家都有國旗、沒有多的', q([...files].sort()) === q([...wanted].sort()),
    `少：${wanted.filter((f) => !files.includes(f)).join(',')} 多：${files.filter((f) => !wanted.includes(f)).join(',')}`);
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const missing = files.filter((f) => !sw.includes(`'icons/flags/${f}'`));
  check('國旗都在 sw.js 的 ASSETS（離線看得到）', missing.length === 0, missing.join(', '));
  const unsafe = files.filter((f) => {
    const svg = readFileSync(new URL(f, dir), 'utf8');
    return !svg.startsWith('<svg') || /<script|<foreignObject|<image|\son\w+=|href="(?!#)/i.test(svg);
  });
  check('國旗是單純的 SVG（沒有 script、外部連結、內嵌圖片）', unsafe.length === 0, unsafe.join(', '));
  const kb = files.reduce((sum, f) => sum + readFileSync(new URL(f, dir)).length, 0) / 1024;
  check(`國旗總共 ≤ 300KB（目前 ${kb.toFixed(0)}KB）`, kb <= 300);
}

console.log(`\n${passed}/${passed + failures.length} 通過`);
if (failures.length) {
  console.log(`失敗：\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
}
