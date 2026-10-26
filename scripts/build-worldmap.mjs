// 產生 js/worldMap.js（產地地圖的國界）：不是測試，資料有更新時才需要重跑
// 來源：Natural Earth 1:50m Admin 0 – Countries（公有領域，https://www.naturalearthdata.com/about/terms-of-use/）
//   curl -L -o ne_50m.geojson https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_countries.geojson
//   node scripts/build-worldmap.mjs ne_50m.geojson
// 投影：等距圓柱（x = 經度 + 180、y = 90 − 緯度），單位 0.01°、一律整數，路徑用相對座標縮小檔案
// 簡化：Douglas–Peucker（容許誤差 TOLERANCE），太小的島嶼（外框 < MIN_RING）略過；南極洲不畫
// 國名：Natural Earth 的 NAME_ZHT（繁中），不是台灣慣用的寫法用 ZH_FIX 改；標字位置用 Natural Earth 建議的 LABEL_X／LABEL_Y
//   同一個代碼有好幾塊（例如澳洲的屬地）時只有最大的那塊標國名
import { readFile, writeFile } from 'node:fs/promises';

const TOLERANCE = 4;  // 0.04°（產地地圖放大到單一國家時也看不出來）
const MIN_RING = 20;  // 0.2°

// 產咖啡的國家在 App 裡一律用 js/origins.js 的名稱，這裡只改其他國家
const ZH_FIX = {
  TW: '台灣', CN: '中國', KR: '南韓', KP: '北韓', NZ: '紐西蘭', AU: '澳洲', HR: '克羅埃西亞', CZ: '捷克', ML: '馬利', MN: '蒙古',
  GY: '蓋亞那', MT: '馬爾他', PS: '巴勒斯坦', CG: '剛果共和國', '北賽普勒斯土耳其共和國': '北賽普勒斯', '錫亞琴冰川': '',
};

const input = process.argv[2];
if (!input) {
  console.error('用法：node scripts/build-worldmap.mjs <ne_50m_admin_0_countries.geojson>');
  process.exit(1);
}
const geo = JSON.parse(await readFile(input, 'utf8'));

const project = ([lon, lat]) => [Math.round((lon + 180) * 100), Math.round((90 - lat) * 100)];

function simplify(points) {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const len = Math.hypot(bx - ax, by - ay);
    let max = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      // 點到線段 a–b 的距離（環的起點＝終點時 len 是 0，改用到起點的距離）
      const d = len ? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len : Math.hypot(px - ax, py - ay);
      if (d > max) { max = d; idx = i; }
    }
    if (max > TOLERANCE) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const bbox = (pts) => pts.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)],
  [Infinity, Infinity, -Infinity, -Infinity]);
const area = (pts) => Math.abs(pts.reduce((s, [x, y], i) => {
  const [nx, ny] = pts[(i + 1) % pts.length];
  return s + x * ny - nx * y;
}, 0)) / 2;

const countries = [];
for (const f of geo.features) {
  const p = f.properties;
  if (p.ADM0_A3 === 'ATA') continue;
  const code = [p.ISO_A2_EH, p.ISO_A2].find((c) => /^[A-Z]{2}$/.test(c ?? '')) ?? '';
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  let d = '';
  let main = null;
  for (const poly of polys) {
    for (const ring of poly) {
      const pts = simplify(ring.map(project).filter((pt, i, arr) => i === 0 || pt[0] !== arr[i - 1][0] || pt[1] !== arr[i - 1][1]));
      const b = bbox(pts);
      if (pts.length < 4 || Math.max(b[2] - b[0], b[3] - b[1]) < MIN_RING) continue;
      const a = area(pts);
      if (!main || a > main.a) main = { a, b };
      const closed = pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1] ? pts.slice(0, -1) : pts;
      d += `M${closed[0][0]} ${closed[0][1]}l${closed.slice(1).map(([x, y], i) => `${x - closed[i][0]} ${y - closed[i][1]}`).join(' ')}z`
        .replace(/ -/g, '-');
    }
  }
  if (!d) continue;
  const name = String(p.NAME_ZHT ?? '').trim();
  const zh = ZH_FIX[code] ?? ZH_FIX[name] ?? name;
  countries.push({ code, d, box: main.b, size: main.a, zh, label: project([p.LABEL_X, p.LABEL_Y]) });
}
countries.sort((a, b) => a.code.localeCompare(b.code) || b.size - a.size);
for (const [i, c] of countries.entries()) {
  if (c.code && countries[i - 1]?.code === c.code) c.zh = '';
}

const out = `// 由 scripts/build-worldmap.mjs 產生，不要手動修改
// 國界：Natural Earth 1:50m（公有領域）；等距圓柱投影，x = (經度 + 180) × 100、y = (90 − 緯度) × 100
// code：ISO 3166-1 alpha-2（沒有代碼的地區是 ''，只畫出來、不能點）；box：最大那塊陸地的外框 [minX, minY, maxX, maxY]
// zh：繁中國名（'' ＝不標國名：同一個代碼較小的那幾塊）；label：標國名的位置 [x, y]
export const MAP_SCALE = 100;
export const COUNTRY_SHAPES = [
${countries.map((c) => `  { code: '${c.code}', zh: '${c.zh}', label: [${c.label.join(', ')}], box: [${c.box.join(', ')}], d: '${c.d}' },`).join('\n')}
];
`;
await writeFile(new URL('../js/worldMap.js', import.meta.url), out);
console.log(`js/worldMap.js：${countries.length} 個國家、${(Buffer.byteLength(out) / 1024).toFixed(0)} KB`);
