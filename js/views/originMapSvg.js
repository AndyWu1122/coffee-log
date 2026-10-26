// 產地地圖的共用部分（originMap.js「我的足跡」、originExplore.js「認識產區」）：座標換算、放大範圍、模式切換、小元件
import { COUNTRY_BY_CODE, regionsOf, flavorNote } from '../models.js';
import { esc, segmentedHtml, bindSegmented } from './ui.js';

// 世界地圖：緯度 62°N～48°S（南極、北極圈不畫），寬 760px 在自己的框裡橫向捲動
export const WORLD = { x: 0, y: 2800, w: 36000, h: 11000 };
export const WORLD_W = 760;
export const WORLD_H = Math.round((WORLD_W * WORLD.h) / WORLD.w);
export const WORLD_PX = WORLD.w / WORLD_W; // 1px 等於幾個地圖單位

export const cupsText = (n) => `${n} 杯`;
export const score = (n) => (n == null ? '' : `・平均 ${n.toFixed(1)} 分`);

/** 經緯度 → 地圖座標 */
export const toMap = (scale, lat, lon) => [(lon + 180) * scale, (90 - lat) * scale];

/** 國家的中心：自訂的範圍（夏威夷）或最大那塊陸地的中心 */
export function countryCenter(map, code) {
  const view = COUNTRY_BY_CODE.get(code)?.view;
  if (view) {
    const [w, s, e, n] = view;
    return toMap(map.scale, (s + n) / 2, (w + e) / 2);
  }
  const [x0, y0, x1, y1] = map.shapes.find((sh) => sh.code === code).box;
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}

/** 世界地圖打開時把某個國家捲到中間（沒有就捲到正中間） */
export function scrollWorldTo(scroll, map, code) {
  if (!code) {
    scroll.scrollLeft = (scroll.scrollWidth - scroll.clientWidth) / 2;
    return;
  }
  const [x] = countryCenter(map, code);
  scroll.scrollLeft = (x - WORLD.x) / WORLD_PX - scroll.clientWidth / 2;
}

/** 世界地圖上國家的點擊範圍（小國在世界地圖上點不到）：codes 每個國家一個 */
export const countryHits = (map, codes) => codes.map((code) => {
  const [x, y] = countryCenter(map, code);
  return `<circle class="origin-hit" data-code="${code}" cx="${x}" cy="${y}" r="${14 * WORLD_PX}"></circle>`;
}).join('');

/** 放大的範圍：自訂的範圍，或最大那塊陸地加上所有產區；留邊、寬高比限制在 1～1.6 */
export function countryViewBox(map, code) {
  const view = COUNTRY_BY_CODE.get(code).view;
  let x0, y0, x1, y1;
  if (view) {
    const [w, s, e, n] = view;
    [x0, y0] = toMap(map.scale, n, w);
    [x1, y1] = toMap(map.scale, s, e);
  } else {
    [x0, y0, x1, y1] = map.shapes.find((sh) => sh.code === code).box;
    for (const r of regionsOf(code)) {
      const [x, y] = toMap(map.scale, r.lat, r.lon);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  const pad = Math.max(x1 - x0, y1 - y0) * 0.12;
  let w = x1 - x0 + pad * 2;
  let h = y1 - y0 + pad * 2;
  if (w / h > 1.6) h = w / 1.6;
  if (w / h < 1) w = h;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w: Math.round(w), h: Math.round(h) };
}

/**
 * 放大到一個國家的 SVG：這個國家有外框、鄰國淡淡的；產區圓點喝過實心、沒喝過空心（喝過的疊在上面），
 * 每個產區一個比圓點大的點擊範圍（data-region）
 */
export function countrySvg(map, code, drunk, label) {
  const all = regionsOf(code);
  const vb = countryViewBox(map, code);
  const px = vb.w / 360; // 大約 1px（手機寬度）
  const paths = map.shapes.map((s) => `<path class="origin-land ${s.code === code ? 'is-current' : 'is-other'}" d="${s.d}"></path>`).join('');
  const dots = [...all].sort((a, b) => Number(drunk.has(a.key)) - Number(drunk.has(b.key))).map((r) => {
    const [x, y] = toMap(map.scale, r.lat, r.lon);
    return `<circle class="origin-dot${drunk.has(r.key) ? ' is-drunk' : ''}" data-dot="${r.key}" cx="${x}" cy="${y}" r="${6 * px}"></circle>`;
  }).join('');
  const hits = all.map((r) => {
    const [x, y] = toMap(map.scale, r.lat, r.lon);
    return `<circle class="origin-hit" data-region="${r.key}" cx="${x}" cy="${y}" r="${16 * px}"></circle>`;
  }).join('');
  return `<svg class="origin-map origin-country" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}"
    role="img" aria-label="${esc(label)}">${paths}${dots}${hits}</svg>`;
}

/** 選取一個產區：地圖的圓點和清單那一列一起標示 */
export function markSelected(page, key) {
  for (const el of page.querySelectorAll('.is-selected')) el.classList.remove('is-selected');
  page.querySelector(`.origin-dot[data-dot="${key}"]`)?.classList.add('is-selected');
  page.querySelector(`[data-region="${key}"]:not(.origin-hit)`)?.classList.add('is-selected');
}

/* ===== 模式切換：我的足跡｜認識產區 ===== */

const MODES = [{ value: 'mine', label: '我的足跡' }, { value: 'explore', label: '認識產區' }];

/** 網址：#/origins[/<國家>][?mode=explore][&region=<產區>] */
export function originHref({ code = '', mode = 'mine', region = '' } = {}) {
  const query = new URLSearchParams();
  if (mode === 'explore') query.set('mode', 'explore');
  if (region) query.set('region', region);
  const qs = query.toString();
  return `#/origins${code ? `/${code}` : ''}${qs ? `?${qs}` : ''}`;
}

export const modeSwitchHtml = (mode) => `<div class="origin-modes">${segmentedHtml('origin-mode', MODES, mode)}</div>`;

/** 切換模式：留在同一個國家（產區的選取不帶過去） */
export function bindModeSwitch(page, code) {
  bindSegmented(page.querySelector('.origin-modes'), (name, value) => {
    if (value) location.hash = originHref({ code, mode: value });
  });
}

/* ===== 小元件 ===== */

/** 橫條的 SVG（和統計頁一樣）：value / max 的比例，圓角在資料端 */
export function hbarSvg(value, max) {
  const w = Math.max(2, (value / max) * 100);
  const r = Math.min(4, w / 2);
  return `<svg class="hbar" viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true">
    <path class="chart-bar" d="M0,0 H${(w - r).toFixed(2)} Q${w.toFixed(2)},0 ${w.toFixed(2)},${r} V${12 - r} Q${w.toFixed(2)},12 ${(w - r).toFixed(2)},12 H0 Z"></path>
  </svg>`;
}

/**
 * 風味標籤（風味輪的大類顏色＋名稱）：notes 是 [{ key, count?, match? }]
 * count：後面加次數；match：標「✓」（和一般常見的風味一樣）
 */
export function flavorTagsHtml(notes) {
  const tags = notes.map((n) => ({ ...n, ...flavorNote(n.key) })).filter((n) => n.zh);
  if (!tags.length) return '';
  return `<div class="note-tags">${tags.map((n) => `<span class="note-tag${n.match ? ' is-match' : ''}"><i style="background:${n.color}"></i>${esc(n.zh)}${
    n.count != null ? `<small>${n.count}</small>` : ''}${n.match ? '<span class="match-mark" aria-label="和一般常見的風味一樣">✓</span>' : ''}</span>`).join('')}</div>`;
}

/** 喝過的豆子：點了到只列那支豆子的紀錄；產地是猜的另外連到豆子頁確認（我的足跡、認識產區共用） */
export const beansHtml = (beans) => `<ul class="origin-beans">
  ${beans.map((b) => `<li><a href="#/?bean=${encodeURIComponent(b.id)}">${esc(b.name)}</a><span class="hint">${cupsText(b.cups)}</span>
    ${b.guessed ? `<a class="hint origin-confirm" href="#/beans/${encodeURIComponent(b.id)}">產地是從名稱猜的，點這裡確認</a>` : ''}</li>`).join('')}
</ul>`;
