// #/beans 豆子列表
import { listBeans, PROCESS, ROAST_LEVEL } from '../models.js';
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
        ${b.archived ? '<span class="badge">已封存</span>' : ''}
      </div>
      <div class="card-row">
        ${b.origin ? `<span>${esc(b.origin)}</span>` : ''}
        <span>${esc(PROCESS[b.process] ?? '')}</span>
        <span>${esc(ROAST_LEVEL[b.roastLevel] ?? '')}</span>
      </div>
      <div class="card-row"><span>${roast}</span></div>
    </a></li>`;
}
