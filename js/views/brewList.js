// #/ 沖煮紀錄列表
import { listBrews, listBeans, formatRatio, formatSeconds } from '../models.js';
import { esc, setTitle } from './ui.js';

const dateFmt = new Intl.DateTimeFormat('zh-TW', {
  month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
});

export async function render(container, { isCurrent }) {
  setTitle('手沖紀錄');
  const [brews, beans] = await Promise.all([listBrews(), listBeans()]);
  if (!isCurrent()) return;

  if (brews.length === 0) {
    container.innerHTML = beans.length === 0
      ? `<div class="empty">
           <p>歡迎！先新增一支豆子，再開始記錄沖煮</p>
           <a class="btn btn-primary" href="#/beans/new">新增豆子</a>
         </div>`
      : `<div class="empty">
           <p>還沒有沖煮紀錄</p>
           <a class="btn btn-primary" href="#/brew/new">新增第一筆</a>
         </div>`;
    return;
  }

  container.innerHTML = `
    <ul class="list">${brews.map(brewCard).join('')}</ul>
    <a class="fab" href="#/brew/new" aria-label="新增紀錄">＋</a>
  `;
}

function brewCard(b) {
  const stars = b.rating ? '★'.repeat(b.rating) + '☆'.repeat(5 - b.rating) : '';
  const details = [
    b.dripper,
    `${b.coffeeG}g → ${b.waterG}g`,
    formatRatio(b.ratio),
    b.tempC != null ? `${b.tempC}°C` : '',
    b.totalTimeS != null ? formatSeconds(b.totalTimeS) : '',
  ].filter(Boolean);

  return `
    <li><a class="card" href="#/brew/${esc(b.id)}">
      <div class="card-head">
        <span class="card-title">${esc(b.beanName)}</span>
        <span class="stars" aria-label="評分 ${b.rating ?? '未評'}">${stars}</span>
      </div>
      <div class="card-row">${details.map((d) => `<span>${esc(d)}</span>`).join('')}</div>
      <div class="card-row">
        <span>${esc(dateFmt.format(new Date(b.brewedAt)))}</span>
        ${b.restDays != null ? `<span>養豆 ${b.restDays} 天</span>` : ''}
      </div>
    </a></li>`;
}
