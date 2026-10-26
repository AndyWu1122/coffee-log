// 產地（js/origins.js、js/worldMap.js）：不需要 Supabase、不需要瀏覽器
// 清單本身（代碼、key、別名不重複）、每個產區的點落在自己的國家裡、從文字比對產地、顯示用的產地、產地地圖的統計
//
// 用法：node scripts/origins-test.mjs

const {
  COUNTRIES, REGIONS, COUNTRY_BY_CODE, ORIGIN_GROUPS, matchOrigin, beanPlace, originLabel, normalizeText, cupLevel, summarizeOrigins,
} = await import('../js/origins.js');
const { COUNTRY_SHAPES, MAP_SCALE } = await import('../js/worldMap.js');

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

console.log(`\n${passed}/${passed + failures.length} 通過`);
if (failures.length) {
  console.log(`失敗：\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
}
