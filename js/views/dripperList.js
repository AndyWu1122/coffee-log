// #/drippers 濾杯列表（從右上角 ☰ 選單進入）
import { listDrippers } from '../models.js';
import { esc, setTitle } from './ui.js';

let showArchived = false; // 切頁後保留勾選狀態

export async function render(container, { isCurrent }) {
  setTitle('濾杯');
  const drippers = await listDrippers({ includeArchived: showArchived });
  if (!isCurrent()) return;

  container.innerHTML = `
    <div class="toolbar">
      <label class="switch-row is-compact"><input type="checkbox" id="show-archived" ${showArchived ? 'checked' : ''}><span>顯示已封存</span></label>
    </div>
    ${drippers.length ? `<ul class="list">${drippers.map(dripperCard).join('')}</ul>` : `
      <div class="empty">
        <p>還沒有濾杯。新增後，沖煮紀錄就能記下用哪一支沖的</p>
        <a class="btn btn-primary" href="#/drippers/new">新增濾杯</a>
      </div>`}
    <a class="fab" href="#/drippers/new" aria-label="新增濾杯">＋</a>
  `;

  container.querySelector('#show-archived').addEventListener('change', (e) => {
    showArchived = e.target.checked;
    render(container, { isCurrent });
  });
}

function dripperCard(d) {
  const firstLine = d.notes.split('\n')[0];
  return `
    <li><a class="card" href="#/drippers/${esc(d.id)}">
      <div class="card-head">
        <span class="card-title">${esc(d.name)}</span>
        ${d.archived ? '<span class="badge">已封存</span>' : ''}
      </div>
      ${firstLine ? `<div class="card-row"><span>${esc(firstLine)}</span></div>` : ''}
    </a></li>`;
}
