// #/beans 豆子列表
import { listBeans, formatStock, PROCESS, ROAST_LEVEL } from '../models.js';
import { esc, setTitle } from './ui.js';

let showArchived = false; // 切頁後保留勾選狀態

export async function render(container, { isCurrent }) {
  setTitle('豆子');
  const beans = await listBeans({ includeArchived: showArchived });
  if (!isCurrent()) return;

  container.innerHTML = `
    <div class="toolbar">
      <label class="toggle"><input type="checkbox" id="show-archived" ${showArchived ? 'checked' : ''}>顯示已封存</label>
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
}

function beanCard(b) {
  const roast = b.roastDate
    ? `烘焙 ${esc(b.roastDate)}${b.daysSinceRoast != null ? `（第 ${b.daysSinceRoast} 天）` : ''}`
    : '未填烘焙日';
  return `
    <li><a class="card" href="#/beans/${esc(b.id)}">
      <div class="card-head">
        <span class="card-title">${esc(b.name)}</span>
        ${b.archived ? '<span class="badge">已封存</span>' : stockBadge(b.stock)}
      </div>
      <div class="card-row">
        ${b.origin ? `<span>${esc(b.origin)}</span>` : ''}
        <span>${esc(PROCESS[b.process] ?? '')}</span>
        <span>${esc(ROAST_LEVEL[b.roastLevel] ?? '')}</span>
      </div>
      <div class="card-row"><span>${roast}</span></div>
      ${b.stock && b.stock.remainingG !== 0 /* 剛好用完時標籤已寫「已用完」，不重複 */
        ? `<div class="card-row stock-row"><span>${esc(formatStock(b.stock))}</span></div>` : ''}
    </a></li>`;
}

/** 快沒了／已用完的標籤（文字＋顏色，不只靠顏色） */
function stockBadge(stock) {
  if (stock?.empty) return '<span class="badge badge-warn">已用完</span>';
  if (stock?.low) return '<span class="badge badge-warn">快沒了</span>';
  return '';
}
