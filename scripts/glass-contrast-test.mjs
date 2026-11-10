// 玻璃（1.23.0）上的文字對比：不需要 Supabase、不需要 Chrome；Node 直接讀 css/style.css 的變數來算
// 玻璃是半透明的，後面的內容會透出來，所以算最差的情況：後面整片全白、整片全黑（中間的顏色都落在兩者之間）
// 做法和瀏覽器一樣：後面的顏色先經過 --glass-filter 的 brightness（模糊、飽和度不影響全白／全黑），再蓋上 --glass-bg
// 要求：--text ≥ 7:1、--text-dim ≥ 4.5:1（分頁列沒選的分頁）；目前的分頁再疊一層 --tab-active-bg 後 --text ≥ 7:1；
//       字多的 --glass-strong（☰ 選單、提示、教學卡片）上 --text ≥ 7:1、--text-dim ≥ 4.5:1
// 改 --glass-bg、--glass-strong、--glass-filter、--tab-active-bg、--text、--text-dim 之後要重跑
//
// 用法：node scripts/glass-contrast-test.mjs

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = await readFile(path.join(root, 'css/style.css'), 'utf8');

let passed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) passed++;
  else failures.push(name);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

/** 一個主題區塊裡的變數 */
function vars(selector) {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`找不到 ${selector}`);
  const block = css.slice(start, css.indexOf('\n}', start));
  return Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

/** '#rrggbb' 或 'rgba(r, g, b, a)' → [r, g, b, a] */
function color(value) {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1);
  const rgba = value.match(/^rgba?\(([^)]+)\)$/);
  if (!rgba) throw new Error(`看不懂的顏色：${value}`);
  const [r, g, b, a = 1] = rgba[1].split(',').map(Number);
  return [r, g, b, a];
}
const over = ([r, g, b, a], [br, bg, bb]) => [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)];
const luminance = (rgb) => rgb.slice(0, 3).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

const dark = vars(':root');
const themes = { 深色: dark, 淺色: { ...dark, ...vars(':root[data-theme="light"]') } };

for (const [name, v] of Object.entries(themes)) {
  const brightness = Number(v['--glass-filter'].match(/brightness\(([\d.]+)\)/)?.[1] ?? 1);
  check(`${name}：--glass-filter 有模糊（blur ≥ 12px）`, Number(v['--glass-filter'].match(/blur\((\d+)px\)/)?.[1]) >= 12, v['--glass-filter']);
  const text = color(v['--text']);
  const dim = color(v['--text-dim']);
  for (const [label, backdrop] of [['全白', [255, 255, 255]], ['全黑', [0, 0, 0]]]) {
    const behind = backdrop.map((c) => Math.min(255, c * brightness));
    const glass = over(color(v['--glass-bg']), behind);
    const strong = over(color(v['--glass-strong']), behind);
    const active = over(color(v['--tab-active-bg']), glass);
    const r = (x) => x.toFixed(2);
    check(`${name}・後面${label}：玻璃上的 --text ≥ 7:1`, contrast(text, glass) >= 7, r(contrast(text, glass)));
    check(`${name}・後面${label}：玻璃上的 --text-dim ≥ 4.5:1`, contrast(dim, glass) >= 4.5, r(contrast(dim, glass)));
    check(`${name}・後面${label}：目前的分頁（疊上 --tab-active-bg）--text ≥ 7:1`, contrast(text, active) >= 7, r(contrast(text, active)));
    check(`${name}・後面${label}：--glass-strong 上的 --text ≥ 7:1`, contrast(text, strong) >= 7, r(contrast(text, strong)));
    check(`${name}・後面${label}：--glass-strong 上的 --text-dim ≥ 4.5:1`, contrast(dim, strong) >= 4.5, r(contrast(dim, strong)));
  }
}

// 不支援模糊、或開了「降低透明度」時要退回實心
const fallback = (rule) => {
  const at = css.indexOf(rule);
  const block = at < 0 ? '' : css.slice(at, css.indexOf('\n}', at));
  return /--glass-bg:\s*var\(--surface\)/.test(block) && /--glass-strong:\s*var\(--surface-2\)/.test(block) && /--glass-filter:\s*none/.test(block);
};
check('不支援 backdrop-filter：退回實心', fallback('@supports not ((backdrop-filter'));
check('prefers-reduced-transparency：退回實心', fallback('@media (prefers-reduced-transparency: reduce)'));
// 裡面還有玻璃（☰ 選單）的頁首：玻璃要畫在 ::before，自己不能設 backdrop-filter
const plain = css.replace(/\/\*[\s\S]*?\*\//g, ''); // 註解裡也有這個字
const header = plain.slice(plain.indexOf('.app-header {'), plain.indexOf('.app-header::before'));
check('頁首自己不設 backdrop-filter（畫在 ::before，裡面的 ☰ 選單才模糊得到頁面）', !/backdrop-filter/.test(header) && /\.app-header::before \{[^}]*backdrop-filter/.test(css));

console.log(`\n${passed}/${passed + failures.length} 通過`);
if (failures.length) {
  console.log(`失敗：\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
}
