// 首頁（#/）的「拉花」分頁：拉花紀錄的列表（由 brewList.js 呼叫，不是單獨的路由）
// 卡片：照片縮圖、圖案、自評星星、時間；上方依圖案篩選（篩選在切頁後保留）
import { listLatteArts, countLatteArts, LATTE_PATTERNS } from '../models.js';
import { esc } from './ui.js';
import { groupByDay } from './brewList.js';

const timeFmt = new Intl.DateTimeFormat('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
const PATTERN_FILTERS = [{ value: '', label: '全部' }, ...Object.entries(LATTE_PATTERNS).map(([value, label]) => ({ value, label }))];

const filter = { pattern: '' };

/**
 * 拉花分頁的內容：{ html, bind(root, rerender), cleanup }
 * root：這一頁自己的元素（不是 #app），監聽器掛在它上面
 */
export async function latteContent() {
  const [total, arts] = await Promise.all([countLatteArts(), listLatteArts({ pattern: filter.pattern })]);
  const urls = [];
  const thumbUrl = (blob) => { const u = URL.createObjectURL(blob); urls.push(u); return u; };
  const cleanup = () => { for (const u of urls) URL.revokeObjectURL(u); urls.length = 0; };

  const fab = '<a class="fab" href="#/latte/new" aria-label="新增拉花">＋</a>';
  if (!total) {
    return {
      html: `<div class="empty latte-empty">
          <p>還沒有拉花紀錄。拍下每一杯、幫自己打分，就能看到進步。</p>
          <a class="btn btn-primary" href="#/latte/new">記錄第一杯拉花</a>
        </div>${fab}`,
      bind() {},
      cleanup,
    };
  }

  const html = `
    <div class="chips latte-filter" role="group" aria-label="依圖案篩選">
      ${PATTERN_FILTERS.map((p) => `<button type="button" class="chip" data-pattern="${esc(p.value)}"
        aria-pressed="${p.value === filter.pattern}">${esc(p.label)}</button>`).join('')}
    </div>
    <div class="list-meta"><span>共 ${arts.length} 杯</span></div>
    ${arts.length
      ? groupByDay(arts.map((a) => ({ ...a, brewedAt: a.madeAt }))).map(({ label, items }) => `
          <section class="day-group">
            <h2 class="list-date">${esc(label)}</h2>
            <ul class="list">${items.map((a) => latteCard(a, thumbUrl)).join('')}</ul>
          </section>`).join('')
      : '<div class="empty"><p>沒有這個圖案的紀錄</p></div>'}
    ${fab}`;

  return {
    html,
    bind(root, rerender) {
      root.querySelector('.latte-filter').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-pattern]');
        if (!btn) return;
        filter.pattern = btn.dataset.pattern;
        rerender();
      });
    },
    cleanup,
  };
}

/** 圖案名稱；「其他」有補充說明時顯示說明 */
export const patternLabel = (a) => (a.pattern === 'other' && a.patternNote ? a.patternNote : LATTE_PATTERNS[a.pattern] ?? '');

function latteCard(a, thumbUrl) {
  const stars = '★'.repeat(a.selfScore) + '☆'.repeat(5 - a.selfScore);
  const details = [a.milk, a.cup, a.beanName].filter(Boolean);
  return `
    <li><a class="card brew-card latte-card-item${a.thumb ? ' has-thumb' : ''}" href="#/latte/${esc(a.id)}">
      <div class="card-body">
        <div class="card-head">
          <span class="card-title">${esc(patternLabel(a))}${a.visibility === 'friends'
            ? ' <span class="shared-badge" title="好友看得到" aria-label="好友看得到">👥</span>' : ''}</span>
          <span class="stars" aria-label="自評 ${a.selfScore} 分">${stars}</span>
        </div>
        ${details.length ? `<div class="card-row card-gear">${details.map((d) => `<span>${esc(d)}</span>`).join('')}</div>` : ''}
        <div class="card-row card-time"><span>${esc(timeFmt.format(new Date(a.madeAt)))}</span></div>
      </div>
      ${a.thumb ? `<img class="card-thumb" src="${thumbUrl(a.thumb)}" alt="" loading="lazy" decoding="async">` : ''}
    </a></li>`;
}
