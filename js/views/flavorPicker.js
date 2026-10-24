// 可縮放的咖啡風味輪（SVG）
// 總覽：完整三層輪盤，點任一處放大到該大類
// 放大：中心是大類（點中心返回），外圈是中類／細項，點一下選取或取消
import { FLAVOR_WHEEL, flavorNote, sortFlavorNotes } from '../models.js';
import { esc } from './ui.js';

const R = 170; // viewBox 半徑
const TAU = Math.PI * 2;

// 各層的內外半徑；葉節點會一路延伸到最外圈
const OVERVIEW_RADII = (node) => {
  if (node.depth === 1) return [34, 96];
  if (node.depth === 2) return [96, node.children.length ? 138 : R];
  return [138, R];
};
const ZOOM_CENTER = 54;
const ZOOM_RADII = (node) => (node.depth === 2 ? [ZOOM_CENTER, node.children.length ? 108 : R] : [108, R]);

const pt = (r, a) => [r * Math.sin(a), -r * Math.cos(a)]; // a=0 在正上方、順時針
const f = (v) => v.toFixed(2);

/** 環形扇區的 path */
function sectorPath(r0, r1, a0, a1) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = pt(r1, a0);
  const [x1, y1] = pt(r1, a1);
  const [x2, y2] = pt(r0, a1);
  const [x3, y3] = pt(r0, a0);
  return `M${f(x0)} ${f(y0)}A${r1} ${r1} 0 ${large} 1 ${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}`
    + `A${r0} ${r0} 0 ${large} 0 ${f(x3)} ${f(y3)}Z`;
}

/** 依葉節點數分配角度，遞迴產生所有扇區 */
function layout(nodes, a0, a1, radii, out = []) {
  const total = nodes.reduce((s, node) => s + node.leaves, 0);
  let a = a0;
  for (const node of nodes) {
    const span = ((a1 - a0) * node.leaves) / total;
    const [r0, r1] = radii(node);
    out.push({ node, a0: a, a1: a + span, r0, r1 });
    if (node.children.length) layout(node.children, a, a + span, radii, out);
    a += span;
  }
  return out;
}

/** 沿半徑方向的標籤；放不下時縮小字級，仍放不下就不顯示 */
function radialLabel(s, text, size, minSize) {
  const am = (s.a0 + s.a1) / 2;
  const rm = (s.r0 + s.r1) / 2;
  const arc = (s.a1 - s.a0) * rm;
  const room = s.r1 - s.r0 - 6;
  let fs = size;
  while (fs > minSize && (text.length * fs > room || arc < fs * 1.15)) fs -= 0.5;
  if (text.length * fs > room || arc < fs * 1.15) return '';
  const deg = (am * 180) / Math.PI;
  const rot = deg > 180 ? deg + 90 : deg - 90; // 左半邊翻轉，避免文字倒過來
  const [x, y] = pt(rm, am);
  return `<text x="${f(x)}" y="${f(y)}" font-size="${fs}" transform="rotate(${f(rot)} ${f(x)} ${f(y)})">${esc(text)}</text>`;
}

/**
 * 在 el 裡建立風味輪選擇器
 * @returns {{ value: () => string[] }} 目前選取的風味 key（依輪盤順序）
 */
export function createFlavorPicker(el, initialKeys = []) {
  const selected = new Set(initialKeys);
  let zoomed = null; // 目前放大的大類節點；null 為總覽

  function sectorSvg(s, { labelSize, labelMin, dim }) {
    const { node } = s;
    const isSel = selected.has(node.key);
    const text = isSel ? `${node.zh}✓` : node.zh;
    return `
      <path class="sector${dim && !isSel ? ' dim' : ''}${isSel ? ' is-selected' : ''}" d="${sectorPath(s.r0, s.r1, s.a0, s.a1)}"
        fill="${node.color}" data-key="${esc(node.key)}" tabindex="0" role="button"
        aria-label="${esc(flavorNote(node.key).path.join(' › '))}" aria-pressed="${isSel}"></path>
      ${radialLabel(s, text, labelSize, labelMin)}`;
  }

  function wheelSvg() {
    if (!zoomed) {
      const sectors = layout(FLAVOR_WHEEL, 0, TAU, OVERVIEW_RADII);
      const size = { 1: [11, 8], 2: [8.5, 7], 3: [7, 6.5] };
      return `
        ${sectors.map((s) => sectorSvg(s, {
          labelSize: size[s.node.depth][0], labelMin: size[s.node.depth][1], dim: s.node.depth > 1,
        })).join('')}
        <text class="center-count" y="-2" font-size="18">${selected.size}</text>
        <text class="center-sub" y="14" font-size="8">已選</text>`;
    }
    const sectors = layout(zoomed.children, 0, TAU, ZOOM_RADII);
    const catSel = selected.has(zoomed.key);
    return `
      ${sectors.map((s) => sectorSvg(s, { labelSize: 12, labelMin: 8, dim: true })).join('')}
      <circle class="center-back" r="${ZOOM_CENTER - 1}" fill="${zoomed.color}" data-action="back"
        tabindex="0" role="button" aria-label="返回完整風味輪"></circle>
      <text class="center-title" y="-2" font-size="13">${esc(zoomed.zh)}${catSel ? '✓' : ''}</text>
      <text class="center-sub" y="16" font-size="9">‹ 返回</text>`;
  }

  function render() {
    const keys = sortFlavorNotes([...selected]);
    el.innerHTML = `
      <svg class="wheel${zoomed ? ' is-zoomed' : ''}" viewBox="${-R} ${-R} ${R * 2} ${R * 2}" role="group"
        aria-label="${zoomed ? `風味輪：${esc(zoomed.zh)}` : '風味輪'}">
        <g class="wheel-body">${wheelSvg()}</g>
      </svg>
      <p class="hint wheel-hint">${zoomed ? '點選喝到的風味，點中間返回' : '點選大類放大，再挑出喝到的風味'}</p>
      ${zoomed ? `
        <button type="button" class="btn btn-block" data-action="toggle-category">
          ${selected.has(zoomed.key) ? `取消選取「${esc(zoomed.zh)}」` : `只選大類「${esc(zoomed.zh)}」`}
        </button>` : ''}
      ${keys.length ? `
        <ul class="note-chips" aria-label="已選風味">
          ${keys.map((k) => {
            const note = flavorNote(k);
            return `<li><button type="button" class="note-chip" data-remove="${esc(k)}" aria-label="移除 ${esc(note.zh)}">
              <i style="background:${note.color}"></i>${esc(note.zh)}<span aria-hidden="true">×</span></button></li>`;
          }).join('')}
        </ul>` : ''}
    `;
  }

  function toggle(key) {
    if (selected.has(key)) selected.delete(key);
    else selected.add(key);
  }

  function activate(target) {
    if (target.closest('[data-action="back"]')) {
      zoomed = null;
    } else if (target.closest('[data-action="toggle-category"]')) {
      toggle(zoomed.key);
    } else if (target.closest('[data-remove]')) {
      selected.delete(target.closest('[data-remove]').dataset.remove);
    } else if (target.closest('.sector')) {
      const key = target.closest('.sector').dataset.key;
      if (zoomed) toggle(key);
      else zoomed = FLAVOR_WHEEL.find((c) => c.key === key.split('.')[0]);
    } else {
      return;
    }
    render();
  }

  el.addEventListener('click', (e) => activate(e.target));
  el.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.sector, .center-back')) {
      e.preventDefault();
      const key = e.target.dataset.key;
      activate(e.target);
      // 重畫後把焦點放回同一格；換頁（放大／返回）則放到第一格
      (key && el.querySelector(`.sector[data-key="${key}"]`) || el.querySelector('.sector'))?.focus();
    }
  });

  render();
  return { value: () => sortFlavorNotes([...selected]) };
}
