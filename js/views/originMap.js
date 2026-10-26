// #/origins 產地地圖（☰ 選單）、#/origins/<國家代碼> 放大到一個國家；上方切換「我的足跡｜認識產區」（?mode=explore，在 originExplore.js）
// 我的足跡：只用這支手機的豆子和紀錄（models.getOriginMap → js/origins.js），不連網路、不上傳；豆子沒選國家時用名稱和產地文字猜
// 地圖自己用 SVG 畫（國界：js/worldMap.js，用到才載入）；顏色只用主題變數：國家依杯數 --heat-1～4、產區圓點 --accent
// 點國家、圓點、清單才顯示詳細（手機沒有 hover）；豆子名稱是使用者輸入：一律經過 esc()
import { getOriginMap, loadWorldMap, COUNTRY_BY_CODE, REGION_BY_KEY, CUP_LEVELS, regionsOf } from '../models.js';
import { esc, setTitle } from './ui.js';
import {
  WORLD, WORLD_W, WORLD_H, WORLD_PX, cupsText, score, countryCenter, scrollWorldTo, countryHits, countrySvg, markSelected,
  originHref, modeSwitchHtml, bindModeSwitch, hbarSvg, flavorTagsHtml, beansHtml,
} from './originMapSvg.js';

export async function render(container, { id, query, isCurrent }) {
  const code = id && COUNTRY_BY_CODE.has(id) ? id : null;
  const mode = query.mode === 'explore' ? 'explore' : 'mine';
  if (id && !code) {
    location.replace(originHref({ mode }));
    return;
  }
  setTitle(code ? COUNTRY_BY_CODE.get(code).zh : '產地地圖');
  const [summary, { COUNTRY_SHAPES, MAP_SCALE }, explore] = await Promise.all([
    getOriginMap(), loadWorldMap(), mode === 'explore' ? import('./originExplore.js') : null,
  ]);
  if (!isCurrent()) return;
  const map = { shapes: COUNTRY_SHAPES, scale: MAP_SCALE };
  if (explore) return explore.render(container, { summary, map, code, region: query.region ?? '', isCurrent });
  return code ? renderCountry(container, summary, map, code) : renderWorld(container, summary, map);
}

/* ===== 世界地圖 ===== */

function renderWorld(container, summary, map) {
  const byCode = new Map(summary.countries.map((c) => [c.code, c]));
  const regionCount = summary.countries.reduce((n, c) => n + c.regions.length, 0);
  const max = summary.countries[0]?.cups ?? 1;

  const paths = map.shapes.map((s) => {
    const c = byCode.get(s.code);
    const known = COUNTRY_BY_CODE.has(s.code);
    return `<path class="origin-land heat-${c?.level ?? 0}${known ? ' is-link' : ''}" d="${s.d}"${known ? ` data-code="${s.code}"` : ''}></path>`;
  }).join('');
  // 喝過的國家加一個圓點：盧安達、薩爾瓦多這些小國在世界地圖上點不到
  const markers = summary.countries.map((c) => {
    const [x, y] = countryCenter(map, c.code);
    return `<circle class="origin-marker" cx="${x}" cy="${y}" r="${4 * WORLD_PX}"></circle>`;
  }).join('') + countryHits(map, summary.countries.map((c) => c.code));
  const label = summary.countries.length
    ? `世界地圖：喝過 ${summary.countries.length} 個國家，${summary.countries.map((c) => `${COUNTRY_BY_CODE.get(c.code).zh} ${c.cups} 杯`).join('、')}`
    : '世界地圖：還沒有喝過的產地';

  container.innerHTML = `<div class="origin-page" id="origin-page">
    ${modeSwitchHtml('mine')}
    <section class="origin-card">
      <h2>喝過的產地</h2>
      <p class="hint">${summary.countries.length
        ? `${summary.countries.length} 個國家・${regionCount} 個產區・共 ${summary.totalCups - summary.unknown.cups} 杯`
        : summary.totalCups ? '還認不出喝過的產地，到下面的豆子選一下國家' : '記下第一杯之後，喝過的產地會出現在這裡'}</p>
      <div class="chart-scroll origin-scroll">
        <svg class="origin-map origin-world" width="${WORLD_W}" height="${WORLD_H}" viewBox="${WORLD.x} ${WORLD.y} ${WORLD.w} ${WORLD.h}"
          role="img" aria-label="${esc(label)}">${paths}${markers}</svg>
      </div>
      ${legendHtml()}
      ${summary.countries.length ? `<div class="hbars">
        ${summary.countries.map((c) => `<a class="hbar-row" href="${originHref({ code: c.code })}" data-country="${c.code}"
            aria-label="${esc(`${COUNTRY_BY_CODE.get(c.code).zh}：${cupsText(c.cups)}，${c.regions.length} 個產區，看產區`)}">
          <span class="hbar-name">${esc(COUNTRY_BY_CODE.get(c.code).zh)}</span>
          ${hbarSvg(c.cups, max)}
          <span class="hbar-value">${cupsText(c.cups)}</span>
        </a>`).join('')}
      </div>` : ''}
      <p class="hint">點國家看產區・顏色依杯數（${levelText()}）</p>
    </section>
    ${unknownHtml(summary.unknown)}
  </div>`;

  const page = container.querySelector('#origin-page');
  bindModeSwitch(page, '');
  page.querySelector('.origin-world').addEventListener('click', (e) => {
    const target = e.target.closest('[data-code]');
    if (target) location.hash = originHref({ code: target.dataset.code });
  });
  // 打開時把喝最多的國家捲到中間
  scrollWorldTo(page.querySelector('.origin-scroll'), map, summary.countries[0]?.code);
}

const levelText = () => CUP_LEVELS.map((n, i) => (CUP_LEVELS[i + 1] ? `${n}–${CUP_LEVELS[i + 1] - 1}` : `${n}+`)).join('、') + ' 杯';

function legendHtml() {
  const S = 12;
  const boxes = [1, 2, 3, 4].map((lv, i) => `<rect class="heat-${lv}" x="${i * (S + 3)}" y="0" width="${S}" height="${S}" rx="2"></rect>`).join('');
  return `<div class="heatmap-legend" aria-hidden="true">
    <span>少</span><svg width="${4 * (S + 3) - 3}" height="${S}" viewBox="0 0 ${4 * (S + 3) - 3} ${S}">${boxes}</svg><span>多</span>
  </div>`;
}

/** 認不出產地的豆子：點過去選國家 */
function unknownHtml(unknown) {
  if (!unknown.beans.length) return '';
  return `<section class="origin-card origin-unknown">
    <h2>還沒選產地的豆子</h2>
    <p class="hint">${unknown.beans.length} 支、${cupsText(unknown.cups)}・從名稱認不出產地，點豆子選國家和產區</p>
    <ul class="origin-beans">
      ${unknown.beans.map((b) => `<li><a href="#/beans/${encodeURIComponent(b.id)}">${esc(b.name)}</a><span class="hint">${cupsText(b.cups)}</span></li>`).join('')}
    </ul>
  </section>`;
}

/* ===== 一個國家 ===== */

function renderCountry(container, summary, map, code) {
  const country = COUNTRY_BY_CODE.get(code);
  const c = summary.countries.find((x) => x.code === code) ?? null;
  const drunk = new Map((c?.regions ?? []).map((r) => [r.key, r]));
  const all = regionsOf(code);
  const max = Math.max(1, ...(c?.regions ?? []).map((r) => r.cups), c?.unassigned.cups ?? 0);
  const untried = all.filter((r) => !drunk.has(r.key));

  container.innerHTML = `<div class="origin-page" id="origin-page">
    <p class="origin-back"><a href="${originHref()}">‹ 世界地圖</a></p>
    ${modeSwitchHtml('mine')}
    <section class="origin-card">
      <h2>${esc(country.zh)} <small class="hint">${esc(country.en)}</small></h2>
      <p class="hint">${c ? `${cupsText(c.cups)}${score(c.avgRating)}・喝過 ${drunk.size}／${all.length} 個產區` : `還沒喝過${country.zh}的豆子`}</p>
      ${countrySvg(map, code, drunk, `${country.zh}的地圖，圓點是產區（實心＝喝過）`)}
      <p class="chart-detail origin-detail" aria-live="polite"></p>
      ${drunk.size || c?.unassigned.cups ? `<div class="hbars">
        ${(c?.regions ?? []).map((r) => regionRow(REGION_BY_KEY.get(r.key).zh, r.key, r.cups, max)).join('')}
        ${c?.unassigned.cups ? regionRow('沒指定產區', '', c.unassigned.cups, max) : ''}
      </div>` : ''}
      ${untried.length ? `<p class="hint origin-untried">還沒喝過：${untried.map((r) => esc(r.zh)).join('、')}</p>` : ''}
      <div class="origin-region-detail"></div>
    </section>
  </div>`;

  const page = container.querySelector('#origin-page');
  bindModeSwitch(page, code);
  const detailText = page.querySelector('.origin-detail');
  const detailBox = page.querySelector('.origin-region-detail');
  const select = (key) => {
    markSelected(page, key);
    const region = REGION_BY_KEY.get(key);
    const r = key ? drunk.get(key) : c?.unassigned;
    const name = region ? region.zh : '沒指定產區';
    detailText.textContent = r ? `${name}：${cupsText(r.cups)}${score(r.avgRating)}` : `${name}：還沒喝過`;
    detailBox.innerHTML = regionDetailHtml(region, r);
  };
  page.addEventListener('click', (e) => {
    const target = e.target.closest('[data-region]');
    if (target) select(target.dataset.region);
  });
  // 一打開就顯示喝最多的產區
  if (c?.regions.length) select(c.regions[0].key);
  else if (c?.unassigned.cups) select('');
}

const regionRow = (name, key, cups, max) => `
  <button type="button" class="hbar-row" data-region="${key}" aria-label="${esc(`${name}：${cupsText(cups)}，看詳細`)}">
    <span class="hbar-name">${esc(name)}</span>
    ${hbarSvg(cups, max)}
    <span class="hbar-value">${cupsText(cups)}</span>
  </button>`;

/** 產區的詳細：最常選的風味、喝過的豆子（點過去看那支豆子的紀錄；產地是猜的另外提示去確認）、連到這個產區的介紹 */
function regionDetailHtml(region, r) {
  const title = region ? `<h3>${esc(region.zh)} <small class="hint">${esc(region.en)}</small></h3>` : '<h3>沒指定產區</h3>';
  const guide = region ? `<p class="origin-guide-link"><a href="${originHref({ code: region.country, mode: 'explore', region: region.key })}">看這個產區的介紹 ›</a></p>` : '';
  if (!r) return `${title}<p class="hint">還沒喝過這個產區的豆子</p>${guide}`;
  const tags = flavorTagsHtml(r.notes);
  return `${title}
    ${tags ? `<p class="origin-sub">最常選的風味</p>${tags}` : '<p class="hint">這些紀錄沒有選風味</p>'}
    <p class="origin-sub">喝過的豆子</p>
    ${beansHtml(r.beans)}
    ${guide}`;
}
