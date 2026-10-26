// 產地地圖的「認識產區」（#/origins?mode=explore、#/origins/<國家代碼>?mode=explore[&region=<產區>]），由 originMap.js 呼叫
// 不管有沒有喝過，所有產咖啡的國家、產區都畫出來；點進去看介紹（js/originGuide.js，用到才載入）和「你喝到的」對照
// 產區圖鑑（已探索幾個產區）、想買清單（models 的 wishlist，只存在這支手機、會進備份）
// 介紹是 App 內建的靜態內容；你喝到的風味、豆子名稱是使用者輸入：一律經過 esc()
import {
  loadOriginGuide, listWishlist, setWishlistRegion, COUNTRIES, REGIONS, ORIGIN_GROUPS, COUNTRY_BY_CODE, REGION_BY_KEY, regionsOf,
} from '../models.js';
import { esc, toast } from './ui.js';
import {
  WORLD, WORLD_W, WORLD_H, WORLD_PX, cupsText, score, toMap, scrollWorldTo, countryHits, countrySvg, markSelected,
  originHref, modeSwitchHtml, bindModeSwitch, hbarSvg, flavorTagsHtml, beansHtml,
} from './originMapSvg.js';

export async function render(container, { summary, map, code, region, isCurrent }) {
  const [{ COUNTRY_GUIDE, REGION_GUIDE, GUIDE_PROCESS }, wishlist] = await Promise.all([loadOriginGuide(), listWishlist()]);
  if (!isCurrent()) return;
  const ctx = {
    summary, map, guide: { countries: COUNTRY_GUIDE, regions: REGION_GUIDE, process: GUIDE_PROCESS },
    wished: new Set(wishlist.map((w) => w.target)),
    drunk: new Map(summary.countries.flatMap((c) => c.regions.map((r) => [r.key, r]))),
  };
  return code ? renderCountry(container, ctx, code, region) : renderWorld(container, ctx, wishlist);
}

const altitudeText = ([min, max]) => `海拔約 ${min.toLocaleString('en-US')}–${max.toLocaleString('en-US')} 公尺`;
const processText = (keys, labels) => `常見處理法：${keys.map((k) => labels[k]).join('、')}`;
const placeName = (key) => {
  const r = REGION_BY_KEY.get(key);
  return `${COUNTRY_BY_CODE.get(r.country).zh}・${r.zh}`;
};

/* ===== 世界：所有產地 ===== */

function renderWorld(container, ctx, wishlist) {
  const { summary, map } = ctx;
  const drunkCountries = new Map(summary.countries.map((c) => [c.code, c]));
  const paths = map.shapes.map((s) => (COUNTRY_BY_CODE.has(s.code)
    ? `<path class="origin-land is-coffee is-link" d="${s.d}" data-code="${s.code}"></path>`
    : `<path class="origin-land heat-0" d="${s.d}"></path>`)).join('');
  // 所有產區的小圓點：喝過實心、沒喝過空心（只是標示，點擊用國家的範圍）
  const dots = [...REGIONS].sort((a, b) => Number(ctx.drunk.has(a.key)) - Number(ctx.drunk.has(b.key))).map((r) => {
    const [x, y] = toMap(map.scale, r.lat, r.lon);
    return `<circle class="origin-dot is-small${ctx.drunk.has(r.key) ? ' is-drunk' : ''}" cx="${x}" cy="${y}" r="${3 * WORLD_PX}"></circle>`;
  }).join('');
  const explored = ctx.drunk.size;

  container.innerHTML = `<div class="origin-page" id="origin-page">
    ${modeSwitchHtml('explore')}
    <section class="origin-card">
      <h2>世界的咖啡產地</h2>
      <p class="hint">${COUNTRIES.length} 個國家・${REGIONS.length} 個主要產區・點國家看介紹</p>
      <div class="chart-scroll origin-scroll">
        <svg class="origin-map origin-world" width="${WORLD_W}" height="${WORLD_H}" viewBox="${WORLD.x} ${WORLD.y} ${WORLD.w} ${WORLD.h}"
          role="img" aria-label="${esc(`世界的咖啡產地：${COUNTRIES.length} 個國家，你喝過其中 ${explored} 個產區`)}">${paths}${dots}${countryHits(map, COUNTRIES.map((c) => c.code))}</svg>
      </div>
      ${dotLegendHtml()}
    </section>
    <section class="origin-card origin-progress">
      <h2>產區圖鑑</h2>
      <p class="origin-progress-text">已探索 <strong>${explored}</strong>／${REGIONS.length} 個產區</p>
      <div class="origin-progress-bar">${hbarSvg(explored, REGIONS.length)}</div>
      <p class="hint">喝過 ${drunkCountries.size}／${COUNTRIES.length} 個國家・喝過的產區會自動算進來</p>
    </section>
    ${wishlistHtml(wishlist, ctx)}
    <section class="origin-card">
      <h2>產咖啡的國家</h2>
      ${Object.entries(ORIGIN_GROUPS).map(([group, label]) => `
        <h3 class="origin-group">${esc(label)}</h3>
        <div class="origin-rows">
          ${COUNTRIES.filter((c) => c.group === group).map((c) => {
            const all = regionsOf(c.code);
            const n = all.filter((r) => ctx.drunk.has(r.key)).length;
            return `<a class="origin-row" href="${originHref({ code: c.code, mode: 'explore' })}" data-country="${c.code}">
              <span class="origin-row-name">${esc(c.zh)}</span>
              <span class="origin-row-status${n ? ' is-drunk' : ''}">${n ? `喝過 ${n}／${all.length}` : `${all.length} 個產區`}</span>
            </a>`;
          }).join('')}
        </div>`).join('')}
    </section>
  </div>`;

  const page = container.querySelector('#origin-page');
  bindModeSwitch(page, '');
  page.querySelector('.origin-world').addEventListener('click', (e) => {
    const target = e.target.closest('[data-code]');
    if (target) location.hash = originHref({ code: target.dataset.code, mode: 'explore' });
  });
  // 打開時捲到非洲（咖啡的發源地）
  scrollWorldTo(page.querySelector('.origin-scroll'), map, 'ET');
}

function dotLegendHtml() {
  const dot = (cls) => `<svg width="12" height="12" viewBox="0 0 12 12"><circle class="origin-dot ${cls}" cx="6" cy="6" r="4.5"></circle></svg>`;
  return `<div class="heatmap-legend origin-legend" aria-hidden="true">${dot('is-drunk')}<span>喝過的產區</span>${dot('')}<span>還沒喝過</span></div>`;
}

function wishlistHtml(wishlist, ctx) {
  return `<section class="origin-card origin-wishlist">
    <h2>想買清單</h2>
    ${wishlist.length ? `<ul class="origin-beans">
      ${wishlist.map((w) => {
        const r = REGION_BY_KEY.get(w.target);
        return `<li><a href="${originHref({ code: r.country, mode: 'explore', region: r.key })}">${esc(placeName(r.key))}</a>
          ${ctx.drunk.has(r.key) ? '<span class="hint">已經喝過</span>' : ''}</li>`;
      }).join('')}
    </ul>` : '<p class="hint">在產區介紹按「☆ 加入想買清單」，想試試的產區會列在這裡</p>'}
  </section>`;
}

/* ===== 一個國家：國家介紹＋所有產區 ===== */

function renderCountry(container, ctx, code, initialRegion) {
  const country = COUNTRY_BY_CODE.get(code);
  const g = ctx.guide.countries[code];
  const all = regionsOf(code);

  container.innerHTML = `<div class="origin-page" id="origin-page">
    <p class="origin-back"><a href="${originHref({ mode: 'explore' })}">‹ 世界地圖</a></p>
    ${modeSwitchHtml('explore')}
    <section class="origin-card">
      <h2>${esc(country.zh)} <small class="hint">${esc(country.en)}</small></h2>
      ${g ? `<p class="hint">${altitudeText(g.altitude)}・${processText(g.processes, ctx.guide.process)}</p>
        <p class="origin-text">${esc(g.text)}</p>
        <p class="origin-sub">常見風味</p>
        ${flavorTagsHtml(g.flavors.map((key) => ({ key })))}` : ''}
      ${countrySvg(ctx.map, code, ctx.drunk, `${country.zh}的地圖，圓點是產區（實心＝喝過）`)}
      <p class="chart-detail origin-detail" aria-live="polite">點地圖上的圓點或下面的產區，看介紹</p>
      <div class="origin-rows">${all.map((r) => regionRowHtml(r, ctx)).join('')}</div>
      <div class="origin-region-detail" id="origin-region-detail"></div>
    </section>
  </div>`;

  const page = container.querySelector('#origin-page');
  bindModeSwitch(page, code);
  const detailText = page.querySelector('.origin-detail');
  const detailBox = page.querySelector('.origin-region-detail');
  let current = '';
  const select = (key, { scroll = true } = {}) => {
    current = key;
    markSelected(page, key);
    const mine = ctx.drunk.get(key);
    detailText.textContent = `${REGION_BY_KEY.get(key).zh}：${mine ? `喝過 ${cupsText(mine.cups)}${score(mine.avgRating)}` : '還沒喝過'}`;
    detailBox.innerHTML = regionGuideHtml(key, ctx);
    if (scroll) detailBox.scrollIntoView({ block: 'start' });
  };
  page.addEventListener('click', async (e) => {
    const wish = e.target.closest('[data-wish]');
    if (wish) {
      const key = wish.dataset.wish;
      const wanted = !ctx.wished.has(key);
      await setWishlistRegion(key, wanted);
      if (wanted) ctx.wished.add(key);
      else ctx.wished.delete(key);
      toast(wanted ? '已加入想買清單' : '已從想買清單移除');
      page.querySelector(`.origin-row[data-region="${key}"]`).outerHTML = regionRowHtml(REGION_BY_KEY.get(key), ctx);
      detailBox.innerHTML = regionGuideHtml(key, ctx);
      markSelected(page, current);
      return;
    }
    const target = e.target.closest('[data-region]');
    if (target) select(target.dataset.region);
  });
  // 從想買清單、我的足跡點過來：直接打開那個產區
  if (REGION_BY_KEY.get(initialRegion)?.country === code) select(initialRegion);
}

function regionRowHtml(r, ctx) {
  const mine = ctx.drunk.get(r.key);
  const status = [mine ? `喝過 ${cupsText(mine.cups)}` : '還沒喝過', ctx.wished.has(r.key) ? '★ 想買' : ''].filter(Boolean).join('・');
  return `<button type="button" class="origin-row" data-region="${r.key}">
    <span class="origin-row-name">${esc(r.zh)}<small class="hint">${esc(r.en)}</small></span>
    <span class="origin-row-status${mine ? ' is-drunk' : ''}">${status}</span>
  </button>`;
}

/** 兩個風味有關係（一樣，或其中一個是另一個的細項，例如「莓果」和「藍莓」） */
const related = (a, b) => a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);

/** 產區介紹：介紹（沒寫的用國家的）＋想買清單＋你喝到的（風味和介紹對得上的打勾） */
function regionGuideHtml(key, ctx) {
  const region = REGION_BY_KEY.get(key);
  const g = ctx.guide.regions[key];
  const common = g ? Object.values(g.flavors).flat() : ctx.guide.countries[region.country]?.flavors ?? [];
  const mine = ctx.drunk.get(key);
  const wished = ctx.wished.has(key);
  const myNotes = (mine?.notes ?? []).map((n) => ({ ...n, match: common.some((c) => related(n.key, c)) }));
  return `<h3>${esc(region.zh)} <small class="hint">${esc(region.en)}</small></h3>
    <button type="button" class="btn origin-wish${wished ? ' is-on' : ''}" data-wish="${key}" aria-pressed="${wished}">
      ${wished ? '★ 在想買清單裡' : '☆ 加入想買清單'}</button>
    ${g ? `<p class="hint">${altitudeText(g.altitude)}・${processText(g.processes, ctx.guide.process)}</p>
      <p class="origin-text">${esc(g.text)}</p>
      ${g.processes.filter((p) => g.flavors[p]).map((p) => `<p class="origin-sub">${esc(ctx.guide.process[p])}常見</p>
        ${flavorTagsHtml(g.flavors[p].map((k) => ({ key: k })))}`).join('')}`
      : '<p class="hint">這個產區的詳細介紹之後補上，可以先看上面的國家介紹。</p>'}
    <div class="origin-mine">
      <p class="origin-sub">你喝到的</p>
      ${mine ? `<p class="hint">${cupsText(mine.cups)}${score(mine.avgRating)}</p>
        ${myNotes.length ? `${flavorTagsHtml(myNotes)}
          ${myNotes.some((n) => n.match) ? '<p class="hint">✓＝和這裡常見的風味一樣（或是它的細項）</p>' : ''}`
          : '<p class="hint">這些紀錄沒有選風味</p>'}
        ${beansHtml(mine.beans)}`
      : '<p class="hint">還沒喝過這個產區的豆子</p>'}
    </div>`;
}
