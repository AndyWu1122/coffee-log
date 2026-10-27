// #/beans 豆子列表
import { listBeans, formatStock, formatGrams, originLabel, PROCESS, ROAST_LEVEL } from '../models.js';
import { esc, setTitle } from './ui.js';

let showArchived = false; // 切頁後保留勾選狀態

// 卡片縮圖的 objectURL：每次重繪（含切換「顯示已封存」）與離開頁面時 revoke
let thumbUrls = [];
const revokeThumbs = () => {
  for (const u of thumbUrls) URL.revokeObjectURL(u);
  thumbUrls = [];
};
const thumbUrl = (blob) => {
  const u = URL.createObjectURL(blob);
  thumbUrls.push(u);
  return u;
};

export async function render(container, { isCurrent }) {
  setTitle('豆子');
  const beans = sortEmptyLast(await listBeans({ includeArchived: showArchived }));
  if (!isCurrent()) return;
  revokeThumbs();

  container.innerHTML = `
    <div class="toolbar">
      <label class="switch-row is-compact"><input type="checkbox" id="show-archived" ${showArchived ? 'checked' : ''}><span>顯示已封存</span></label>
    </div>
    ${beans.length ? `<ul class="list">${beans.map(beanCard).join('')}</ul>` : `
      <div class="empty">
        <p>還沒有豆子，先新增一支吧</p>
        <a class="btn btn-primary" href="#/beans/new">新增豆子</a>
      </div>`}
    <a class="fab" href="#/beans/new" aria-label="新增豆子">＋</a>
  `;

  container.querySelector('#show-archived').addEventListener('change', (e) => {
    showArchived = e.target.checked;
    render(container, { isCurrent });
  });
  return revokeThumbs;
}

/** 用完的豆子排到還沒用完的後面（封存的照樣在最後；sort 是穩定的，同一組維持原本的順序） */
const rank = (b) => (b.archived ? 2 : b.stock?.empty ? 1 : 0);
const sortEmptyLast = (beans) => beans.sort((a, b) => rank(a) - rank(b));

/** 卡片上的剩餘量：用完時標籤已寫「已用完」，記錄的用量比整包多才另外說明 */
function stockText(stock) {
  return stock.remainingG < 0 ? `記錄的用量比整包多 ${formatGrams(-stock.remainingG)}` : formatStock(stock);
}

function beanCard(b) {
  const roast = b.roastDate
    ? `烘焙 ${esc(b.roastDate)}${b.daysSinceRoast != null ? `（第 ${b.daysSinceRoast} 天）` : ''}`
    : '未填烘焙日';
  return `
    <li><a class="card${b.thumb ? ' has-thumb' : ''}${!b.archived && b.stock?.empty ? ' is-empty' : ''}" href="#/beans/${esc(b.id)}">
      <div class="card-body">
        <div class="card-head">
          <span class="card-title">${esc(b.name)}</span>
          ${b.archived ? '<span class="badge">已封存</span>' : stockBadge(b.stock)}
        </div>
        <div class="card-row">
          ${originLabel(b) ? `<span>${esc(originLabel(b))}</span>` : ''}
          <span>${esc(PROCESS[b.process] ?? '')}</span>
          <span>${esc(ROAST_LEVEL[b.roastLevel] ?? '')}</span>
        </div>
        <div class="card-row"><span>${roast}</span></div>
        ${b.stock && b.stock.remainingG !== 0 /* 剛好用完時標籤已寫「已用完」，不重複 */
          ? `<div class="card-row stock-row"><span>${esc(stockText(b.stock))}</span></div>` : ''}
      </div>
      ${b.thumb ? `<img class="card-thumb" src="${thumbUrl(b.thumb)}" alt="" loading="lazy" decoding="async">` : ''}
    </a></li>`;
}

/** 快沒了／已用完的標籤（文字＋顏色，不只靠顏色） */
function stockBadge(stock) {
  if (stock?.empty) return '<span class="badge badge-warn">已用完</span>';
  if (stock?.low) return '<span class="badge badge-warn">快沒了</span>';
  return '';
}
