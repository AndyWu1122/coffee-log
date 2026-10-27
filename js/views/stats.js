// #/stats 統計（☰ 選單）：只用這支手機上的紀錄計算（models.getStats → js/stats.js），不連網路、不上傳
// 圖表自己用 SVG 畫（CSP 只允許 'self' 的 script）；顏色一律用 CSS 變數（.chart-* 的樣式在 style.css），深淺色都清楚
// 點圓點、長條才顯示詳細數字（手機沒有 hover）；豆子、器材名稱是使用者輸入：一律經過 esc()
import { getStats, getMyHeatmap, STATS_PERIODS, formatGrams } from '../models.js';
import { esc, setTitle, segmentedHtml, bindSegmented } from './ui.js';
import { heatmapHtml, bindHeatmap } from './heatmap.js';

// 篩選條件在切頁後保留（和紀錄列表一樣）；熱度圖固定是近一年，不受期間、豆子篩選影響
const filter = { period: '30', beanId: '', method: '', heatMode: 'cups' };

const md = (dateStr) => { const [, m, d] = dateStr.split('-').map(Number); return `${m}/${d}`; };
const mdOf = (iso) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()}`; };
const score = (n) => (n == null ? '—' : n.toFixed(1));
/** 粉水比的分組：1:15.5–1:16（整數不寫 .0） */
const ratioRange = (from, to) => `1:${from}–1:${to}`;

export async function render(container, { isCurrent }) {
  setTitle('統計');
  const [{ stats, beanOptions, beanId, methodOptions, method }, heatmap] = await Promise.all([getStats(filter), getMyHeatmap(filter.heatMode)]);
  if (!isCurrent()) return;
  filter.beanId = beanId;
  filter.method = method;

  container.innerHTML = `<div id="stats-page" class="stats">
    ${heatmapHtml(heatmap, { modes: true, mode: filter.heatMode })}
    <div class="stats-filters">
      ${segmentedHtml('period', STATS_PERIODS, filter.period)}
      <select id="stats-bean" aria-label="依豆子篩選">
        <option value="">全部豆子</option>
        ${beanOptions.map((b) => `<option value="${esc(b.id)}" ${b.id === filter.beanId ? 'selected' : ''}>
          ${esc(b.name)}${b.archived ? '（已封存）' : ''}</option>`).join('')}
      </select>
      ${methodOptions.length ? `<select id="stats-method" aria-label="依沖煮方式篩選">
        <option value="">全部沖煮方式</option>
        ${methodOptions.map((o) => `<option value="${o.value}" ${o.value === filter.method ? 'selected' : ''}>${o.label}</option>`).join('')}
      </select>` : ''}
    </div>
    ${stats.enough ? chartsHtml(stats) : `<div class="empty stats-empty">
      <p>${stats.cups ? `這段期間只有 ${stats.cups} 杯，` : '這段期間還沒有紀錄，'}多記幾杯就能看到趨勢</p>
      ${filter.period !== 'all' && beanOptions.length ? '<p class="hint">也可以切到「全部」看看。</p>' : ''}
    </div>`}
  </div>`;

  const page = container.querySelector('#stats-page');
  const rerender = () => render(container, { isCurrent });
  bindHeatmap(page, heatmap, { mode: filter.heatMode, onMode: (mode) => { filter.heatMode = mode; rerender(); } });
  bindSegmented(page.querySelector('.stats-filters'), (name, value) => { filter.period = value || filter.period; rerender(); });
  page.querySelector('#stats-bean').addEventListener('change', (e) => { filter.beanId = e.target.value; rerender(); });
  page.querySelector('#stats-method')?.addEventListener('change', (e) => { filter.method = e.target.value; rerender(); });
  if (!stats.enough) return;
  bindRatingChart(page, stats.ratingTrend);
  bindDetails(page);
  // 每週的圖很寬時（在自己的框裡橫向捲動）：預設捲到最新的一週
  const weekScroll = page.querySelector('.stats-card .chart-scroll');
  if (weekScroll) weekScroll.scrollLeft = weekScroll.scrollWidth;
}

function chartsHtml(s) {
  return `
    ${overviewHtml(s.overview)}
    ${card('評分變化', '每一杯一個點（沒評分的不算）', ratingChartHtml(s.ratingTrend), { detail: true })}
    ${card('每支豆子的平均分數', '點長條看那支豆子的紀錄・只算有評分的杯', beanBarsHtml(s.beans))}
    ${card('最常用的參數', '前 3 名和次數', paramsHtml(s), { detail: true })}
    ${card('器材比較', '平均分數和杯數・只算有評分的杯', equipmentHtml(s), { detail: true })}
    ${card('每週沖幾杯', '週一到週日', weeklyChartHtml(s.weeks), { detail: true })}`;
}

/** 一張卡片；detail：圖下方顯示點擊後的詳細數字 */
function card(title, subtitle, body, { detail = false } = {}) {
  return `<section class="stats-card">
    <h2>${esc(title)}</h2>
    <p class="hint">${esc(subtitle)}</p>
    ${body}
    ${detail ? '<p class="chart-detail" aria-live="polite">點圖表看詳細數字</p>' : ''}
  </section>`;
}
const notEnough = (text) => `<p class="hint chart-empty">${esc(text)}</p>`;

/* ===== 1. 總覽 ===== */

function overviewHtml(o) {
  const tile = (label, value, sub = '', { name = false } = {}) => `<div class="stat-tile">
    <div class="stat-label">${esc(label)}</div>
    <div class="stat-value${name ? ' is-name' : ''}">${esc(value)}</div>
    ${sub ? `<div class="hint">${esc(sub)}</div>` : ''}
  </div>`;
  return `<section class="stats-overview" aria-label="總覽">
    ${tile('總杯數', `${o.cups} 杯`)}
    ${tile('平均評分', score(o.avgRating), o.ratedCups < o.cups ? `${o.ratedCups} 杯有評分` : '')}
    ${tile('用掉的咖啡豆', formatGrams(o.totalCoffeeG))}
    ${tile('最常沖的豆子', o.topBean?.name ?? '—', o.topBean ? `${o.topBean.cups} 杯` : '', { name: Boolean(o.topBean) })}
  </section>`;
}

/* ===== 2. 評分變化：折線圖 ===== */

const LINE = { w: 340, h: 190, left: 26, right: 10, top: 12, bottom: 26 };
const lineX = (i, n) => LINE.left + (n === 1 ? 0.5 : i / (n - 1)) * (LINE.w - LINE.left - LINE.right);
const lineY = (v) => LINE.top + ((5 - v) / 4) * (LINE.h - LINE.top - LINE.bottom);

function ratingChartHtml({ points, movingAvg }) {
  if (points.length < 3) return notEnough('有評分的紀錄少於 3 杯，多記幾杯有評分的就能看到變化');
  const n = points.length;
  const grid = [1, 2, 3, 4, 5].map((v) => `
    <line class="chart-grid" x1="${LINE.left}" x2="${LINE.w - LINE.right}" y1="${lineY(v)}" y2="${lineY(v)}"></line>
    <text class="chart-label" x="${LINE.left - 8}" y="${lineY(v) + 4}" text-anchor="end">${v}</text>`).join('');
  const ma = movingAvg.length > 1
    ? `<polyline class="chart-ma" points="${movingAvg.map((m) => `${lineX(m.index, n).toFixed(1)},${lineY(m.value).toFixed(1)}`).join(' ')}"></polyline>`
    : '';
  const r = n > 60 ? 3 : 4;
  const dots = points.map((p, i) => `<circle class="chart-dot" data-i="${i}" cx="${lineX(i, n).toFixed(1)}" cy="${lineY(p.rating).toFixed(1)}" r="${r}"></circle>`).join('');
  const xLabels = `
    <text class="chart-label" x="${LINE.left}" y="${LINE.h - 6}" text-anchor="start">${esc(mdOf(points[0].brewedAt))}</text>
    <text class="chart-label" x="${LINE.w - LINE.right}" y="${LINE.h - 6}" text-anchor="end">${esc(mdOf(points[n - 1].brewedAt))}</text>`;
  return `
    <div class="chart-legend">
      <span><i class="legend-dot"></i>每一杯</span>
      ${movingAvg.length > 1 ? '<span><i class="legend-line"></i>7 杯平均</span>' : '<span class="hint">滿 8 杯會畫出 7 杯平均</span>'}
    </div>
    <svg class="chart chart-rating" viewBox="0 0 ${LINE.w} ${LINE.h}" role="img"
      aria-label="評分變化，${n} 杯，從 ${esc(mdOf(points[0].brewedAt))} 到 ${esc(mdOf(points[n - 1].brewedAt))}">
      ${grid}${ma}${dots}${xLabels}
      <rect class="chart-hit" x="${LINE.left - 10}" y="0" width="${LINE.w - LINE.left - LINE.right + 20}" height="${LINE.h - LINE.bottom + 6}"></rect>
    </svg>`;
}

/** 折線圖：點哪裡就選最近的那一杯（點很密時也點得到） */
function bindRatingChart(page, { points, movingAvg }) {
  const svg = page.querySelector('.chart-rating');
  if (!svg) return;
  const detail = svg.closest('.stats-card').querySelector('.chart-detail');
  const maAt = new Map(movingAvg.map((m) => [m.index, m.value]));
  svg.querySelector('.chart-hit').addEventListener('click', (e) => {
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * LINE.w;
    let best = 0;
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(lineX(i, points.length) - x) < Math.abs(lineX(best, points.length) - x)) best = i;
    }
    for (const dot of svg.querySelectorAll('.chart-dot')) dot.classList.toggle('is-selected', Number(dot.dataset.i) === best);
    const p = points[best];
    const avg = maAt.has(best) ? `（7 杯平均 ${maAt.get(best).toFixed(1)}）` : '';
    detail.textContent = `${mdOf(p.brewedAt)} ${p.beanName}：${p.rating} 分${avg}`;
  });
}

/* ===== 3–5. 橫條（名稱和數字是 HTML，長條是 SVG，名稱太長時截斷，不會和數字重疊） ===== */

/** 橫條的 SVG：value / max 的比例，4px 圓角在資料端、基線端是直角 */
function hbarSvg(value, max) {
  const w = Math.max(2, (value / max) * 100);
  const r = Math.min(4, w / 2);
  return `<svg class="hbar" viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true">
    <path class="chart-bar" d="M0,0 H${(w - r).toFixed(2)} Q${w.toFixed(2)},0 ${w.toFixed(2)},${r} V${12 - r} Q${w.toFixed(2)},12 ${(w - r).toFixed(2)},12 H0 Z"></path>
  </svg>`;
}

/** 0–5 分的刻度（和長條同寬，對齊在長條下方） */
const scoreAxis = () => `<div class="hbar-row hbar-axis" aria-hidden="true">
  <span></span>
  <div class="hbar-ticks">
    <svg class="hbar-scale" viewBox="0 0 100 4" preserveAspectRatio="none">
      ${[0, 1, 2, 3, 4, 5].map((v) => `<line class="chart-grid" x1="${v * 20}" x2="${v * 20}" y1="0" y2="4"></line>`).join('')}
    </svg>
    ${[0, 1, 2, 3, 4, 5].map((v) => `<span style="left:${v * 20}%">${v}</span>`).join('')}
  </div>
  <span></span>
</div>`;

/** 數值欄下方的小字：杯數，樣本少時加註（放在數值欄，不會被名稱的截斷切掉） */
const cupsNote = (cups, small) => `<small>${cups} 杯</small>${small ? '<small>樣本少</small>' : ''}`;

function beanBarsHtml(beans) {
  if (!beans.length) return notEnough('這段期間沒有評分過的紀錄');
  return `<div class="hbars is-stacked">
    ${beans.map((b) => `<a class="hbar-row" href="#/?bean=${encodeURIComponent(b.id)}" data-bean="${esc(b.id)}"
        aria-label="${esc(b.name)}：平均 ${score(b.avg)} 分，${b.cups} 杯${b.small ? '，樣本少' : ''}，看這支豆子的紀錄">
      <span class="hbar-name">${esc(b.name)}</span>
      ${hbarSvg(b.avg, 5)}
      <span class="hbar-value">${score(b.avg)}${cupsNote(b.cups, b.small)}</span>
    </a>`).join('')}
    ${scoreAxis()}
  </div>`;
}

/** 可以點的橫條（點了在詳細文字顯示 detail） */
const detailRow = ({ name, value, max, label, detail }) => `
  <button type="button" class="hbar-row" data-detail="${esc(detail)}">
    <span class="hbar-name">${esc(name)}</span>
    ${hbarSvg(value, max)}
    <span class="hbar-value">${label}</span>
  </button>`;

function paramsHtml({ ratios, temps, cups }) {
  const pct = (n) => `${Math.round((n / cups) * 100)}%`;
  const ratioRows = ratios.map((r) => detailRow({
    name: ratioRange(r.from, r.to), value: r.count, max: ratios[0].count, label: `${r.count} 次`,
    detail: `粉水比 ${ratioRange(r.from, r.to)}：${r.count} 杯（${pct(r.count)}）`,
  })).join('');
  const tempRows = temps.map((t) => detailRow({
    name: `${t.temp}°C`, value: t.count, max: temps[0].count, label: `${t.count} 次`,
    detail: `水溫 ${t.temp}°C：${t.count} 杯（${pct(t.count)}）`,
  })).join('');
  return `
    <h3 class="stats-sub">粉水比</h3>
    ${ratioRows ? `<div class="hbars">${ratioRows}</div>` : notEnough('沒有粉量、水量的紀錄')}
    <h3 class="stats-sub">水溫</h3>
    ${tempRows ? `<div class="hbars">${tempRows}</div>` : notEnough('沒有記錄水溫')}`;
}

function equipmentHtml({ drippers, grinders }) {
  const rows = (items, kind) => items.map((e) => detailRow({
    name: e.name, value: e.avg, max: 5, label: `${score(e.avg)}${cupsNote(e.cups, e.small)}`,
    detail: `${kind} ${e.name}：平均 ${score(e.avg)} 分，${e.cups} 杯${e.small ? '（樣本少，參考就好）' : ''}`,
  })).join('');
  return `
    ${filter.method === 'siphon' ? '' : `<h3 class="stats-sub">濾杯</h3>
    ${drippers.length ? `<div class="hbars is-stacked">${rows(drippers, '濾杯')}${scoreAxis()}</div>` : notEnough('沒有指定濾杯、或都沒有評分')}`}
    <h3 class="stats-sub">磨豆機</h3>
    ${grinders.length ? `<div class="hbars is-stacked">${rows(grinders, '磨豆機')}${scoreAxis()}</div>` : notEnough('沒有指定磨豆機、或都沒有評分')}`;
}

/* ===== 6. 每週沖幾杯：直條圖 ===== */

const WEEK = { h: 170, left: 26, right: 8, top: 16, bottom: 24, slot: 22, bar: 14 };
const SCALE_WEEKS = 14; // 超過幾週就改成固定寬度、在框裡橫向捲動

function weeklyChartHtml(weeks) {
  const n = weeks.length;
  const scroll = n > SCALE_WEEKS;
  // 捲動時 Y 軸另外畫在框外（固定不動），圖本身不留左邊的空間
  const left = scroll ? 4 : WEEK.left;
  const slot = scroll ? WEEK.slot : (340 - WEEK.left - WEEK.right) / n;
  const bar = Math.min(WEEK.bar, slot - 4);
  const w = left + WEEK.right + slot * n;
  const max = Math.max(...weeks.map((wk) => wk.count), 1);
  const top = max <= 4 ? max : Math.ceil(max / 2) * 2; // 刻度取整數、偶數
  const plotH = WEEK.h - WEEK.top - WEEK.bottom;
  const y = (v) => WEEK.top + plotH - (v / top) * plotH;
  const base = y(0);
  const ticks = [...new Set([0, Math.round(top / 2), top])];
  const tickLabels = (x) => ticks.map((v) => `<text class="chart-label" x="${x}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('');
  const grid = ticks.map((v) => `<line class="chart-grid" x1="${left}" x2="${w - WEEK.right}" y1="${y(v)}" y2="${y(v)}"></line>`).join('')
    + (scroll ? '' : tickLabels(WEEK.left - 6));
  const every = scroll ? 4 : Math.max(1, Math.ceil(n / 5)); // 日期標籤：縮放時最多約 5 個、捲動時每 4 週
  const cols = weeks.map((wk, i) => {
    const x = left + i * slot + (slot - bar) / 2;
    const barTop = y(wk.count);
    const r = Math.min(4, bar / 2, base - barTop);
    const path = wk.count ? `<path class="chart-bar" d="M${x},${base} V${barTop + r} Q${x},${barTop} ${x + r},${barTop} H${x + bar - r} Q${x + bar},${barTop} ${x + bar},${barTop + r} V${base} Z"></path>` : '';
    const cap = !scroll && wk.count ? `<text class="chart-value" x="${x + bar / 2}" y="${barTop - 4}" text-anchor="middle">${wk.count}</text>` : '';
    const label = (n - 1 - i) % every === 0 ? `<text class="chart-label" x="${x + bar / 2}" y="${WEEK.h - 6}" text-anchor="middle">${esc(md(wk.start))}</text>` : '';
    const hit = `<rect class="chart-hit-col" x="${left + i * slot}" y="${WEEK.top}" width="${slot}" height="${plotH + 4}"
      data-detail="${esc(`${md(wk.start)}–${md(wk.end)}：${wk.count} 杯`)}"></rect>`;
    return path + cap + label + hit;
  }).join('');
  const label = `每週沖幾杯，${n} 週，最多 ${max} 杯`;
  if (!scroll) {
    return `<svg class="chart chart-weeks" viewBox="0 0 ${w} ${WEEK.h}" role="img" aria-label="${esc(label)}">${grid}${cols}</svg>`;
  }
  return `<div class="chart-scroll-wrap">
    <svg class="chart-axis" viewBox="0 0 ${WEEK.left} ${WEEK.h}" width="${WEEK.left}" height="${WEEK.h}" aria-hidden="true">${tickLabels(WEEK.left - 6)}</svg>
    <div class="chart-scroll">
      <svg class="chart chart-weeks" viewBox="0 0 ${w} ${WEEK.h}" width="${w}" height="${WEEK.h}" role="img" aria-label="${esc(label)}">${grid}${cols}</svg>
    </div>
  </div>`;
}

/* ===== 點擊顯示詳細（長條、直條共用） ===== */

function bindDetails(page) {
  page.addEventListener('click', (e) => {
    const target = e.target.closest('[data-detail]');
    if (!target) return;
    const cardEl = target.closest('.stats-card');
    cardEl.querySelector('.chart-detail').textContent = target.dataset.detail;
    for (const el of cardEl.querySelectorAll('.is-selected')) el.classList.remove('is-selected');
    target.classList.add('is-selected');
  });
}
