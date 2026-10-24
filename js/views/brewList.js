// #/ 沖煮紀錄列表
import {
  listBrews, listBeans, latestBrewByBean, formatRatio, formatSeconds, flavorNote, getBackupStatus, snoozeBackupReminder,
  formatDaysAgo,
} from '../models.js';
import { esc, setTitle, toast } from './ui.js';
import { exportBackup, errorReason } from './backup.js';

const dateFmt = new Intl.DateTimeFormat('zh-TW', {
  month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
});

const RATING_FILTERS = [
  { value: '', label: '全部評分' },
  { value: '3', label: '3 分以上' },
  { value: '4', label: '4 分以上' },
  { value: '5', label: '5 分' },
];

// 篩選條件在切頁後保留
const filter = { beanId: '', minRating: '' };

// 卡片縮圖的 objectURL：每次重繪（含切換篩選）與離開頁面時 revoke
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
  setTitle('手沖紀錄');
  const [beans, latestByBean, backup] = await Promise.all([
    listBeans({ includeArchived: true }), latestBrewByBean(), getBackupStatus(),
  ]);
  // 豆子選項：未封存的，加上有紀錄的已封存豆子
  const beanOptions = beans.filter((b) => !b.archived || latestByBean.has(b.id));
  if (filter.beanId && !beanOptions.some((b) => b.id === filter.beanId)) filter.beanId = '';

  const brews = await listBrews({ beanId: filter.beanId, minRating: Number(filter.minRating) || null });
  if (!isCurrent()) return;
  revokeThumbs();

  if (latestByBean.size === 0) {
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

  const filtered = filter.beanId || filter.minRating;
  container.innerHTML = `
    ${backup.remind ? `
      <div class="notice backup-reminder" role="alert">
        <p><strong>⚠ ${backup.lastBackupAt ? `上次備份是 ${formatDaysAgo(backup.daysSince)}` : '還沒備份過資料'}</strong></p>
        <p class="hint">資料只存在這支手機上，建議定期匯出備份。</p>
        <div class="reminder-actions">
          <button type="button" class="btn btn-primary" id="backup-now">立即備份</button>
          <button type="button" class="btn" id="backup-later">稍後</button>
        </div>
      </div>` : ''}
    <div class="filter-bar">
      <select id="filter-bean" aria-label="依豆子篩選">
        <option value="">全部豆子</option>
        ${beanOptions.map((b) => `
          <option value="${esc(b.id)}" ${b.id === filter.beanId ? 'selected' : ''}>
            ${esc(b.name)}${b.archived ? '（已封存）' : ''}
          </option>`).join('')}
      </select>
      <select id="filter-rating" aria-label="依評分篩選">
        ${RATING_FILTERS.map((r) => `
          <option value="${r.value}" ${r.value === filter.minRating ? 'selected' : ''}>${r.label}</option>`).join('')}
      </select>
    </div>
    <div class="list-meta">
      <span>共 ${brews.length} 筆</span>
      ${filtered ? '<button type="button" class="link-btn" id="clear-filter">清除篩選</button>' : ''}
    </div>
    ${brews.length
      ? `<ul class="list">${brews.map(brewCard).join('')}</ul>`
      : '<div class="empty"><p>沒有符合條件的紀錄</p></div>'}
    <a class="fab" href="#/brew/new" aria-label="新增紀錄">＋</a>
  `;

  const rerender = () => render(container, { isCurrent });
  container.querySelector('#filter-bean').addEventListener('change', (e) => { filter.beanId = e.target.value; rerender(); });
  container.querySelector('#filter-rating').addEventListener('change', (e) => { filter.minRating = e.target.value; rerender(); });
  container.querySelector('#clear-filter')?.addEventListener('click', () => {
    filter.beanId = '';
    filter.minRating = '';
    rerender();
  });
  container.querySelector('#backup-now')?.addEventListener('click', async () => {
    try {
      await exportBackup();
    } catch (err) {
      console.error(err);
      toast(`匯出失敗：${errorReason(err)}`);
      return;
    }
    toast('已匯出備份');
    rerender();
  });
  container.querySelector('#backup-later')?.addEventListener('click', async () => {
    await snoozeBackupReminder();
    toast('3 天後再提醒');
    rerender();
  });
  return revokeThumbs;
}

function brewCard(b) {
  const stars = b.rating ? '★'.repeat(b.rating) + '☆'.repeat(5 - b.rating) : '';
  const details = [
    b.dripper,
    [b.grinderName, b.grindSetting].filter(Boolean).join(' '), // 例：C40 24 格
    `${b.coffeeG}g → ${b.waterG}g`,
    formatRatio(b.ratio),
    b.tempC != null ? `${b.tempC}°C` : '',
    b.totalTimeS != null ? formatSeconds(b.totalTimeS) : '',
  ].filter(Boolean);

  return `
    <li><a class="card${b.thumb ? ' has-thumb' : ''}" href="#/brew/${esc(b.id)}">
      <div class="card-body">
        <div class="card-head">
          <span class="card-title">${esc(b.beanName)}${b.visibility === 'friends'
            ? ' <span class="shared-badge" title="好友看得到" aria-label="好友看得到">👥</span>' : ''}</span>
          <span class="stars" aria-label="評分 ${b.rating ?? '未評'}">${stars}</span>
        </div>
        <div class="card-row">${details.map((d) => `<span>${esc(d)}</span>`).join('')}</div>
        <div class="card-row">
          <span>${esc(dateFmt.format(new Date(b.brewedAt)))}</span>
          ${b.restDays != null ? `<span>養豆 ${b.restDays} 天</span>` : ''}
        </div>
        ${noteTags(b.flavorNotes)}
      </div>
      ${b.thumb ? `<img class="card-thumb" src="${thumbUrl(b.thumb)}" alt="" loading="lazy" decoding="async">` : ''}
    </a></li>`;
}

/** 卡片上的風味標籤：最多 3 個，其餘顯示 +N */
function noteTags(keys = []) {
  const MAX = 3;
  const notes = keys.map(flavorNote).filter(Boolean);
  if (!notes.length) return '';
  return `<div class="note-tags">
    ${notes.slice(0, MAX).map((n) => `<span class="note-tag"><i style="background:${n.color}"></i>${esc(n.zh)}</span>`).join('')}
    ${notes.length > MAX ? `<span class="note-tag more">+${notes.length - MAX}</span>` : ''}
  </div>`;
}
