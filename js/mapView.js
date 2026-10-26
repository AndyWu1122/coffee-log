// 產地地圖的放大、拖曳與國名的擺放（純函式，不 import 任何東西，Node 可直接測）；由 js/views/originMapSvg.js 使用
// view ＝ { cx, cy, k }：地圖框中心的地圖座標、縮放（1 個地圖單位 ＝ k px）；size ＝ { w, h }：地圖框的大小（px）
// limits ＝ { bounds: { x, y, w, h }, minK, maxK }：可以看的範圍（地圖座標）與縮放的上下限

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** 剛好放得下 rect（地圖座標）的 view */
export function fitView(rect, size) {
  return { cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2, k: Math.min(size.w / rect.w, size.h / rect.h) };
}

/** view → SVG 的 viewBox（地圖座標） */
export function viewBox(view, size) {
  const w = size.w / view.k;
  const h = size.h / view.k;
  return { x: view.cx - w / 2, y: view.cy - h / 2, w, h };
}

/** 地圖座標 → 地圖框裡的 px */
export const toScreen = (view, size, x, y) => [(x - view.cx) * view.k + size.w / 2, (y - view.cy) * view.k + size.h / 2];

/** 縮放限制在上下限裡；看得到的範圍不超出 bounds（比 bounds 大的那一邊置中） */
export function clampView(view, size, limits) {
  const k = clamp(view.k, limits.minK, limits.maxK);
  const axis = (c, px, start, len) => {
    const visible = px / k;
    return visible >= len ? start + len / 2 : clamp(c, start + visible / 2, start + len - visible / 2);
  };
  const b = limits.bounds;
  return { cx: axis(view.cx, size.w, b.x, b.w), cy: axis(view.cy, size.h, b.y, b.h), k };
}

/** 以地圖框裡的 (px, py) 為中心縮放 factor 倍：手指（游標）下的那一點不動 */
export function zoomAt(view, factor, px, py, size, limits) {
  const ox = px - size.w / 2;
  const oy = py - size.h / 2;
  const mx = view.cx + ox / view.k;
  const my = view.cy + oy / view.k;
  const k = clamp(view.k * factor, limits.minK, limits.maxK);
  return clampView({ cx: mx - ox / k, cy: my - oy / k, k }, size, limits);
}

/** 手指移動 (dx, dy) px：地圖跟著手指走 */
export const panBy = (view, dx, dy, size, limits) => clampView({ ...view, cx: view.cx - dx / view.k, cy: view.cy - dy / view.k }, size, limits);

/**
 * 決定哪些國名（產區名）要顯示、放哪邊：依 rank 小→大、同 rank 依 priority 大→小一個一個放，
 * 和已經放好的字、obstacles（圓點）重疊，或超出地圖框就不顯示
 * labels：[{ id, x, y（地圖座標）, w, h（px）, anchor: 'middle'｜'side', dx（px，side 時字離點多遠）, rank, priority }]
 *   middle：字的中心在點上；side：先試點的右邊，放不下再試左邊
 * obstacles：[{ x, y（地圖座標）, r（px）}]；reserved：[[左, 上, 右, 下]]（地圖框裡的 px，例如放大按鈕）
 * 回傳 Map：id → 'middle'｜'right'｜'left'（沒有的就是不顯示）
 */
export function placeLabels(labels, view, size, { obstacles = [], reserved = [], gap = 2 } = {}) {
  const boxes = obstacles.map((o) => {
    const [sx, sy] = toScreen(view, size, o.x, o.y);
    return [sx - o.r, sy - o.r, sx + o.r, sy + o.r];
  }).concat(reserved);
  const hit = (a, b) => a[0] < b[2] + gap && b[0] < a[2] + gap && a[1] < b[3] + gap && b[1] < a[3] + gap;
  const fits = (box) => box[0] >= 0 && box[1] >= 0 && box[2] <= size.w && box[3] <= size.h
    && !placed.some((p) => hit(p, box)) && !boxes.some((o) => hit(o, box));
  const order = [...labels].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || (b.priority ?? 0) - (a.priority ?? 0));
  const shown = new Map();
  const placed = [];
  for (const l of order) {
    const [sx, sy] = toScreen(view, size, l.x, l.y);
    const dx = l.dx ?? 0;
    const tries = l.anchor === 'side' ? [['right', sx + dx], ['left', sx - dx - l.w]] : [['middle', sx - l.w / 2]];
    for (const [side, left] of tries) {
      const box = [left, sy - l.h / 2, left + l.w, sy + l.h / 2];
      if (!fits(box)) continue;
      placed.push(box);
      shown.set(l.id, side);
      break;
    }
  }
  return shown;
}
