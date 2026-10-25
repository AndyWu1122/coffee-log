// 沖煮熱度圖的畫面：SVG 繪製與點擊顯示詳細（統計、帳號、個人檔案共用；資料來自 models 的 getMyHeatmap／getFriendHeatmap）
// 自己畫 SVG（CSP 只允許 'self' 的 script）；顏色只用 CSS 變數 --heat-0～--heat-4（深淺主題各自定義、驗證過分得出 5 級）
// 點擊（不是 hover）才顯示那天的數字；用點擊位置換算是哪一格，點在圓點之間也算，手指比較好點
import { HEATMAP_MODES, getMyHeatmap } from '../models.js';
import { esc, segmentedHtml, bindSegmented } from './ui.js';

const CELL = 13;   // 每格的寬高
const R = 5;       // 圓點半徑
const TOP = 18;    // 上方月份的高度
const AXIS_W = 22; // 左邊「一、三、五」的寬度（畫在捲動框外面，固定不動）
const BOTTOM = 4;  // 底下留給「今天」外框的空間（外框比圓點大一圈）
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

const width = (h) => h.weeks.length * CELL + 3; // 右邊多留一點給今天的外框
const height = TOP + 7 * CELL + BOTTOM;
const cx = (col) => col * CELL + CELL / 2;
const cy = (row) => TOP + row * CELL + CELL / 2;

/** 2026-10-24 → 「10/24（六）」 */
function dayLabel(day) {
  const [y, m, d] = day.split('-').map(Number);
  const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // 0＝週一
  return `${m}/${d}（${WEEKDAYS[weekday]}）`;
}

/** 點一格時顯示的文字 */
function detailText(cell, mode) {
  const base = `${dayLabel(cell.day)}：${cell.cups} 杯`;
  if (mode !== 'rating' || !cell.cups) return base;
  return cell.avg == null ? `${base}・沒有評分` : `${base}・平均 ${cell.avg.toFixed(1)} 分`;
}

const summaryText = (h) => `近一年沖了 ${h.total} 杯，目前連續 ${h.current} 天，最長連續 ${h.longest} 天`;

/**
 * 熱度圖區塊的 HTML
 * title：標題；modes：顯示「杯數｜平均評分」的切換（只有自己的熱度圖）；mode：目前的模式
 */
export function heatmapHtml(h, { title = '沖煮熱度圖', modes = false, mode = 'cups' } = {}) {
  const months = h.months.map((m) => `<text class="chart-label" x="${m.col * CELL + 1}" y="12">${m.month}月</text>`).join('');
  const dots = h.weeks.map((week, col) => week.map((cell, row) => (cell
    ? `<circle class="heat-dot heat-${cell.level}" data-day="${cell.day}" cx="${cx(col)}" cy="${cy(row)}" r="${R}"></circle>`
      + (cell.isToday ? `<circle class="heat-today" cx="${cx(col)}" cy="${cy(row)}" r="${R + 1.75}"></circle>` : '')
    : '')).join('')).join('');
  const axis = [0, 2, 4].map((row) => `<text class="chart-label" x="${AXIS_W - 6}" y="${cy(row) + 4}" text-anchor="end">${WEEKDAYS[row]}</text>`).join('');
  const legendDots = [0, 1, 2, 3, 4].map((lv) => `<circle class="heat-dot heat-${lv}" cx="${lv * CELL + CELL / 2}" cy="${CELL / 2}" r="${R}"></circle>`).join('');
  return `<div class="heatmap-card" data-heatmap data-mode="${esc(mode)}">
    <h2>${esc(title)}</h2>
    <p class="hint">近一年・每天一個點${mode === 'rating' ? '・顏色是當天的平均評分' : ''}</p>
    ${modes ? `<div class="heatmap-modes">${segmentedHtml('heatmap-mode', HEATMAP_MODES, mode)}</div>` : ''}
    <div class="chart-scroll-wrap heatmap-wrap">
      <svg class="chart-axis" width="${AXIS_W}" height="${height}" viewBox="0 0 ${AXIS_W} ${height}" aria-hidden="true">${axis}</svg>
      <div class="chart-scroll heatmap-scroll">
        <svg class="chart heatmap" width="${width(h)}" height="${height}" viewBox="0 0 ${width(h)} ${height}"
          role="img" aria-label="${esc(summaryText(h))}">${months}${dots}</svg>
      </div>
    </div>
    <div class="heatmap-legend" aria-hidden="true">
      <span>少</span><svg width="${5 * CELL}" height="${CELL}" viewBox="0 0 ${5 * CELL} ${CELL}">${legendDots}</svg><span>多</span>
    </div>
    <p class="chart-detail" aria-live="polite">點圓點看那天沖了幾杯</p>
    <dl class="heatmap-stats">
      <div><dt>近一年</dt><dd>${h.total} 杯</dd></div>
      <div><dt>目前連續</dt><dd>${h.current} 天</dd></div>
      <div><dt>最長連續</dt><dd>${h.longest} 天</dd></div>
    </dl>
  </div>`;
}

/**
 * 熱度圖的行為（root：heatmapHtml 放進去之後的那個元素，已在畫面上）
 * 點格子顯示詳細、捲到最右邊（今天）；onMode(mode)：切換「杯數｜平均評分」時呼叫（有 modes 時）
 */
export function bindHeatmap(root, h, { mode = 'cups', onMode } = {}) {
  const card = root.matches('[data-heatmap]') ? root : root.querySelector('[data-heatmap]');
  const svg = card.querySelector('.heatmap');
  const detail = card.querySelector('.chart-detail');
  svg.addEventListener('click', (e) => {
    const rect = svg.getBoundingClientRect();
    const col = Math.floor(((e.clientX - rect.left) / rect.width) * width(h) / CELL);
    const row = Math.floor((((e.clientY - rect.top) / rect.height) * height - TOP) / CELL);
    const cell = h.weeks[col]?.[row];
    if (!cell) return;
    for (const dot of svg.querySelectorAll('.heat-dot.is-selected')) dot.classList.remove('is-selected');
    svg.querySelector(`[data-day="${cell.day}"]`)?.classList.add('is-selected');
    detail.textContent = detailText(cell, mode);
  });
  const scroll = card.querySelector('.heatmap-scroll');
  scroll.scrollLeft = scroll.scrollWidth; // 打開時看到的是最近（今天在最右欄）
  if (onMode) bindSegmented(card.querySelector('.heatmap-modes'), (name, value) => onMode(value || mode));
}

/**
 * 自己的熱度圖（只用這支手機上的紀錄，不需要網路），可以切換「杯數｜平均評分」：帳號頁、自己的個人檔案用
 * el：放熱度圖的元素；isCurrent：頁面還在不在（切頁後不畫）
 */
export async function renderMyHeatmap(el, { title = '我的沖煮熱度圖', isCurrent, mode = 'cups' }) {
  const h = await getMyHeatmap(mode);
  if (!isCurrent() || !el.isConnected) return;
  el.innerHTML = heatmapHtml(h, { title, modes: true, mode });
  bindHeatmap(el, h, { mode, onMode: (next) => renderMyHeatmap(el, { title, isCurrent, mode: next }) });
}
