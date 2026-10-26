// 產地地圖的共用部分（originMap.js「我的足跡」、originExplore.js「認識產區」）：座標換算、放大範圍、可以放大拖曳的地圖、國名、模式切換、小元件
// 放大、拖曳的計算與國名的擺放在 js/mapView.js（純函式，經 models 轉出）；這裡只管 DOM 和手勢
import { COUNTRY_BY_CODE, regionsOf, flavorNote, fitView, viewBox, clampView, zoomAt, panBy, placeLabels } from '../models.js';
import { esc, segmentedHtml, bindSegmented } from './ui.js';

// 世界地圖：緯度 62°N～48°S（南極、北極圈不畫）；打開時的縮放和以前 760px 寬的世界地圖一樣
export const WORLD = { x: 0, y: 2800, w: 36000, h: 11000 };
const WORLD_K = 760 / WORLD.w; // 打開時 1 個地圖單位幾 px
const MAX_ZOOM = 16;           // 世界地圖最多放大幾倍（以打開時為準）
const COUNTRY_ZOOM = 8;        // 國家頁最多再放大幾倍
const TAP_SLOP = 8;            // 手指移動超過幾 px 就算拖曳，不算點擊

export const cupsText = (n) => `${n} 杯`;
/** 國旗（icons/flags，flag-icons 的 SVG）：旁邊一定寫了國名，所以只是裝飾，alt 留空；code 只來自 COUNTRIES */
export const flagHtml = (code) => `<img class="flag" src="icons/flags/${code.toLowerCase()}.svg" alt="" width="4" height="3">`;
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

/** 地圖上的國名：產咖啡的國家用 App 的名稱（台灣的寫法，太長的用短名），其他用地圖資料的 */
const shapeName = (shape) => {
  const c = COUNTRY_BY_CODE.get(shape.code);
  return c ? c.short ?? c.zh : shape.zh;
};
const boxArea = ([x0, y0, x1, y1]) => (x1 - x0) * (y1 - y0);

/** 世界地圖上國家的點擊範圍（小國在世界地圖上點不到）：codes 每個國家一個，半徑固定 14px（放大也不變） */
export const countryHits = (map, codes) => codes.map((code) => {
  const [x, y] = countryCenter(map, code);
  return `<circle class="origin-hit" data-code="${code}" cx="${x}" cy="${y}" data-px="14"></circle>`;
}).join('');

/** 世界地圖上一個國家的形狀：都有 data-shape（點了顯示國名用），產咖啡的國家另外有 data-code */
export function landPath(map, i, cls) {
  const s = map.shapes[i];
  const known = COUNTRY_BY_CODE.has(s.code);
  return `<path class="origin-land ${cls}${known ? ' is-link' : ''}" d="${s.d}" data-shape="${i}"${known ? ` data-code="${s.code}"` : ''}></path>`;
}

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

/* ===== 可以放大、拖曳的地圖（世界、國家共用） ===== */

/**
 * 地圖框：SVG＋國名圖層＋右下角的「＋」「－」「⟲」；kind 是 'world' 或 'country'
 * 圓點、點擊範圍的半徑寫在 data-px（px），由 bindMap 依縮放換算，放大後大小不變
 */
export function mapFrameHtml({ kind, svgClass, label, body, ratio = null }) {
  return `<div class="origin-frame is-${kind}"${ratio ? ` style="aspect-ratio: ${ratio.w} / ${ratio.h}"` : ''}>
    <svg class="origin-map ${svgClass}" role="img" aria-label="${esc(label)}">${body}<g class="map-pick"></g><g class="map-labels" aria-hidden="true"></g></svg>
    <div class="map-zoom">
      <button type="button" class="map-zoom-btn" data-zoom="in" aria-label="放大">＋</button>
      <button type="button" class="map-zoom-btn" data-zoom="out" aria-label="縮小">－</button>
      <button type="button" class="map-zoom-btn" data-zoom="home" aria-label="${kind === 'world' ? '回到原本的範圍' : '回到整個國家'}">⟲</button>
    </div>
  </div>`;
}

// 國名的字（px、粗細）：rank 0 是國家頁的國名、1 是主要的（產國、產區）、2 是其他國家（淡色）
const LABEL_FONT = { 0: [15, 700], 1: [12, 600], 2: [11, 400] };

/**
 * 讓地圖框可以放大、拖曳：單指拖曳、雙指縮放、滾輪、按鈕；拖曳過的不算點擊（click 在地圖框就被擋下）
 * home(size) → 打開時（和 ⟲）的 view；limits(size) → { bounds, minK, maxK }
 * labels：[{ text, x, y, rank, priority, anchor?, dx?（px）, minK? }]，minK 是放大到多少才考慮顯示；
 *   anchor 'side'（產區名）放在點的右邊，放不下改放左邊
 * obstacles：[{ x, y, r（px）}]：國名不能蓋住的圓點
 */
export function bindMap(frame, { home, limits, labels = [], obstacles = [] }) {
  const svg = frame.querySelector('svg');
  const sized = [...svg.querySelectorAll('[data-px]')];
  const labelLayer = svg.querySelector('.map-labels');
  const buttons = Object.fromEntries([...frame.querySelectorAll('[data-zoom]')].map((b) => [b.dataset.zoom, b]));

  // 國名的 <text> 先全部建好、量好寬度（px），之後只切換顯示
  const measure = document.createElement('canvas').getContext('2d');
  const family = getComputedStyle(svg).fontFamily;
  const items = labels.map((l, i) => {
    const [px, weight] = LABEL_FONT[l.rank];
    measure.font = `${weight} ${px}px ${family}`;
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    el.setAttribute('class', `map-label rank-${l.rank}`);
    el.setAttribute('x', l.x);
    el.setAttribute('y', l.y);
    el.setAttribute('text-anchor', 'middle');
    el.textContent = l.text;
    labelLayer.append(el);
    return { ...l, id: i, el, px, side: 'middle', w: measure.measureText(l.text).width + 4, h: px * 1.3 };
  });

  let size = { w: 0, h: 0 };
  let view = null;
  let frameReq = 0;
  let labelTimer = 0;
  const lim = () => limits(size);
  const measureFrame = () => {
    const r = svg.getBoundingClientRect();
    return { w: r.width, h: r.height };
  };

  function draw() {
    frameReq = 0;
    const vb = viewBox(view, size);
    svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    for (const el of sized) el.setAttribute('r', Number(el.dataset.px) / view.k);
    for (const it of items) {
      it.el.setAttribute('font-size', it.px / view.k);
      it.el.setAttribute('stroke-width', 3 / view.k);
      if (it.dx) it.el.setAttribute('dx', ((it.side === 'left' ? -1 : 1) * it.dx) / view.k);
    }
    const l = lim();
    buttons.in.disabled = view.k >= l.maxK * 0.999;
    buttons.out.disabled = view.k <= l.minK * 1.001;
  }
  const schedule = () => { if (!frameReq) frameReq = requestAnimationFrame(draw); };

  /** 重新決定哪些國名要顯示（手勢結束、按鈕、大小改變時；拖曳中的字只跟著縮放） */
  function relabel() {
    clearTimeout(labelTimer);
    // 右下角的按鈕蓋住的地方不放字
    const box = svg.getBoundingClientRect();
    const z = frame.querySelector('.map-zoom').getBoundingClientRect();
    const reserved = [[z.left - box.left, z.top - box.top, z.right - box.left, z.bottom - box.top]];
    const shown = placeLabels(items.filter((it) => view.k >= (it.minK ?? 0)), view, size, { obstacles, reserved });
    for (const it of items) {
      const side = shown.get(it.id);
      it.el.classList.toggle('is-shown', Boolean(side));
      if (!side || side === it.side) continue;
      it.side = side;
      it.el.setAttribute('text-anchor', { middle: 'middle', right: 'start', left: 'end' }[side]);
      if (it.dx) it.el.setAttribute('dx', ((side === 'left' ? -1 : 1) * it.dx) / view.k);
    }
    svg.dataset.k = String(view.k); // 測試用
  }
  const relabelSoon = () => {
    clearTimeout(labelTimer);
    labelTimer = setTimeout(relabel, 150);
  };

  function setView(next, { now = false } = {}) {
    view = clampView(next, size, lim());
    if (now) draw();
    else schedule();
  }

  function layout() {
    const next = measureFrame();
    if (!next.w || !next.h) return;
    const first = !view;
    size = next;
    setView(first ? home(size) : view, { now: true });
    relabel();
  }

  /* ===== 手勢：單指拖曳、雙指縮放（同時也跟著兩指的中點移動） ===== */
  const pointers = new Map(); // pointerId → { x, y }（地圖框裡的 px）
  let start = null;           // 第一根手指按下的位置
  let last = null;            // 上一次的位置：單指是手指，兩指是中點與距離
  let moved = false;
  let suppressUntil = 0;
  const local = (e) => {
    const r = svg.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const pinch = () => {
    const [a, b] = [...pointers.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
  };

  frame.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.map-zoom') || (e.pointerType === 'mouse' && e.button !== 0)) return;
    pointers.set(e.pointerId, local(e));
    if (pointers.size === 1) {
      start = local(e);
      last = start;
      moved = false;
    } else if (pointers.size === 2) {
      moved = true;
      last = pinch();
    }
  });
  frame.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, local(e));
    if (pointers.size >= 2) {
      const p = pinch();
      const zoomed = last.d > 0 ? zoomAt(view, p.d / last.d, p.x, p.y, size, lim()) : view;
      setView(panBy(zoomed, p.x - last.x, p.y - last.y, size, lim()));
      last = p;
      frame.classList.add('is-dragging');
      return;
    }
    const p = pointers.get(e.pointerId);
    if (!moved && Math.hypot(p.x - start.x, p.y - start.y) < TAP_SLOP) return;
    moved = true;
    frame.classList.add('is-dragging');
    setView(panBy(view, p.x - last.x, p.y - last.y, size, lim()));
    last = p;
  });
  const end = (e) => {
    if (!pointers.delete(e.pointerId)) return;
    if (pointers.size === 1) {
      last = [...pointers.values()][0]; // 兩指放開一指：剩下那指接著拖，不跳動
      return;
    }
    if (pointers.size) return;
    frame.classList.remove('is-dragging');
    if (moved) {
      suppressUntil = performance.now() + 80; // 放開後緊接著的那個 click；之後馬上點國家照常有反應
      relabel();
    }
  };
  frame.addEventListener('pointerup', end);
  frame.addEventListener('pointercancel', end);
  frame.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') end(e); });
  // 拖曳、縮放後放開手指，瀏覽器可能還會送 click：不算點國家、圓點
  frame.addEventListener('click', (e) => {
    if (performance.now() < suppressUntil && !e.target.closest('.map-zoom')) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);
  frame.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = local(e);
    setView(zoomAt(view, Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.002)), p.x, p.y, size, lim()));
    relabelSoon();
  }, { passive: false });
  frame.querySelector('.map-zoom').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-zoom]');
    if (!btn) return;
    const z = btn.dataset.zoom;
    setView(z === 'home' ? home(size) : zoomAt(view, z === 'in' ? 2 : 0.5, size.w / 2, size.h / 2, size, lim()), { now: true });
    relabel();
  });

  // 地圖框的大小會變（旋轉、調整視窗）；離開頁面（元素不在畫面上）就停止
  const ro = new ResizeObserver(() => {
    if (!frame.isConnected) {
      ro.disconnect();
      return;
    }
    const next = measureFrame();
    if (next.w !== size.w || next.h !== size.h) layout();
  });
  ro.observe(frame);
  layout();
}

/* ===== 世界地圖 ===== */

export const worldMapHtml = (label, body) => mapFrameHtml({ kind: 'world', svgClass: 'origin-world', label, body });

/**
 * 世界地圖（兩個模式共用）：primary 是要標國名的產國（Map：代碼 → priority，越大越先放）；
 * 其他國家放大到 2 倍以上才標淡色的國名；focus 是打開時放在中間的國家
 */
export function bindWorldMap(page, map, { primary, focus }) {
  const labels = map.shapes.filter((s) => shapeName(s)).map((s) => {
    const main = primary.has(s.code);
    return {
      text: shapeName(s), x: s.label[0], y: s.label[1], rank: main ? 1 : 2,
      priority: main ? primary.get(s.code) : boxArea(s.box), minK: main ? 0 : WORLD_K * 2,
    };
  });
  const [fx, fy] = focus ? countryCenter(map, focus) : [WORLD.x + WORLD.w / 2, WORLD.y + WORLD.h / 2];
  bindMap(page.querySelector('.origin-frame'), {
    labels,
    home: () => ({ cx: fx, cy: fy, k: WORLD_K }),
    limits: (size) => {
      const minK = Math.min(size.w / WORLD.w, size.h / WORLD.h);
      return { bounds: WORLD, minK, maxK: Math.max(minK, WORLD_K * MAX_ZOOM) };
    },
  });
}

/**
 * 點世界地圖上的國家：外框標出來、地圖下面（.origin-pick-bar）顯示國名；再點那一行才進國家
 * describe(code) → { text, go, href }（產國）；不是產國的只顯示國名；點海上取消
 */
export function bindWorldPick(page, map, describe) {
  const svg = page.querySelector('.origin-world');
  const pickLayer = svg.querySelector('.map-pick');
  const bar = page.querySelector('.origin-pick-bar');
  const pick = (shapes, info) => {
    pickLayer.innerHTML = shapes.map((i) => `<path class="origin-pick" d="${map.shapes[i].d}"></path>`).join('');
    svg.dataset.picked = info?.code ?? '';
    bar.innerHTML = !info ? ''
      : info.href ? `<a class="origin-pick-link" href="${info.href}"><span>${esc(info.text)}</span><span class="origin-pick-go">${esc(info.go)}</span></a>`
        : `<p class="origin-pick-text">${esc(info.text)}</p>`;
  };
  svg.addEventListener('click', (e) => {
    const coded = e.target.closest('[data-code]');
    if (coded) {
      const code = coded.dataset.code;
      pick(map.shapes.flatMap((s, i) => (s.code === code ? [i] : [])), { code, ...describe(code) });
      return;
    }
    const other = e.target.closest('[data-shape]');
    const s = other && map.shapes[Number(other.dataset.shape)];
    if (s && shapeName(s)) pick([Number(other.dataset.shape)], { code: s.code, text: `${shapeName(s)}（不在咖啡產地清單裡）` });
    else pick([], null);
  });
}

/* ===== 國家 ===== */

/**
 * 放大到一個國家的地圖：這個國家有外框、鄰國淡淡的；產區圓點喝過實心、沒喝過空心（喝過的疊在上面），
 * 每個產區一個比圓點大的點擊範圍（data-region）；畫完要呼叫 bindCountryMap
 */
export function countrySvg(map, code, drunk, label) {
  const all = regionsOf(code);
  const paths = map.shapes.map((s) => `<path class="origin-land ${s.code === code ? 'is-current' : 'is-other'}" d="${s.d}"></path>`).join('');
  const dots = [...all].sort((a, b) => Number(drunk.has(a.key)) - Number(drunk.has(b.key))).map((r) => {
    const [x, y] = toMap(map.scale, r.lat, r.lon);
    return `<circle class="origin-dot${drunk.has(r.key) ? ' is-drunk' : ''}" data-dot="${r.key}" cx="${x}" cy="${y}" data-px="6"></circle>`;
  }).join('');
  const hits = all.map((r) => {
    const [x, y] = toMap(map.scale, r.lat, r.lon);
    return `<circle class="origin-hit" data-region="${r.key}" cx="${x}" cy="${y}" data-px="16"></circle>`;
  }).join('');
  return mapFrameHtml({ kind: 'country', svgClass: 'origin-country', label, body: `${paths}${dots}${hits}`, ratio: countryViewBox(map, code) });
}

/** 國家頁的地圖：最多再放大 8 倍、可以拖到鄰國；標出這個國家、產區（喝過的優先）、鄰國的名稱 */
export function bindCountryMap(page, map, code, drunk) {
  const vb = countryViewBox(map, code);
  const points = regionsOf(code).map((r) => [r, ...toMap(map.scale, r.lat, r.lon)]);
  const [sx, sy] = COUNTRY_BY_CODE.get(code).view ? countryCenter(map, code) : map.shapes.find((s) => s.code === code).label;
  const labels = [
    { text: COUNTRY_BY_CODE.get(code).zh, x: sx, y: sy, rank: 0, priority: 0 },
    ...points.map(([r, x, y]) => ({ text: r.zh, x, y, rank: 1, priority: drunk.has(r.key) ? 1 : 0, anchor: 'side', dx: 10 })),
    ...map.shapes.filter((s) => s.code !== code && shapeName(s)).map((s) => ({
      text: shapeName(s), x: s.label[0], y: s.label[1], rank: 2, priority: boxArea(s.box),
    })),
  ];
  const bounds = { x: vb.x - vb.w / 2, y: vb.y - vb.h / 2, w: vb.w * 2, h: vb.h * 2 };
  bindMap(page.querySelector('.origin-frame'), {
    labels,
    obstacles: points.map(([, x, y]) => ({ x, y, r: 7 })),
    home: (size) => fitView(vb, size),
    limits: (size) => {
      const k = fitView(vb, size).k;
      return { bounds, minK: k / 2, maxK: k * COUNTRY_ZOOM };
    },
  });
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
