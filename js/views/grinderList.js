// #/grinders 磨豆機列表（從右上角 ☰ 選單進入）
import { listGrinders } from '../models.js';
import { esc, setTitle } from './ui.js';

let showArchived = false; // 切頁後保留勾選狀態

export async function render(container, { isCurrent }) {
  setTitle('磨豆機');
  const grinders = await listGrinders({ includeArchived: showArchived });
  if (!isCurrent()) return;

  container.innerHTML = `
    <div class="toolbar">
      <label class="switch-row is-compact"><input type="checkbox" id="show-archived" ${showArchived ? 'checked' : ''}><span>顯示已封存</span></label>
    </div>
    ${grinders.length ? `<ul class="list">${grinders.map(grinderCard).join('')}</ul>` : `
      <div class="empty">
        <p>還沒有磨豆機。新增後，沖煮紀錄就能記下用哪一台磨的</p>
        <a class="btn btn-primary" href="#/grinders/new">新增磨豆機</a>
      </div>`}
    <a class="fab" href="#/grinders/new" aria-label="新增磨豆機">＋</a>
  `;

  container.querySelector('#show-archived').addEventListener('change', (e) => {
    showArchived = e.target.checked;
    render(container, { isCurrent });
  });
}

function grinderCard(g) {
  const firstLine = g.notes.split('\n')[0];
  return `
    <li><a class="card" href="#/grinders/${esc(g.id)}">
      <div class="card-head">
        <span class="card-title">${esc(g.name)}</span>
        ${g.archived ? '<span class="badge">已封存</span>' : ''}
      </div>
      ${firstLine ? `<div class="card-row"><span>${esc(firstLine)}</span></div>` : ''}
    </a></li>`;
}
