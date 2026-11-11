// #/ 紀錄列表：上方切換「手沖｜拉花」（記住上次選的）；拉花的列表在 latteList.js
import {
  listBrews, listBeans, latestBrewByBean, formatRatio, formatSeconds, flavorNote, getBackupStatus, snoozeBackupReminder,
  formatDaysAgo, getInstallHint, dismissInstallHint, METHODS, isInAppBrowser, getHomeTab, setHomeTab, HOME_TABS,
} from '../models.js';
import { esc, setTitle, toast, segmentedHtml, bindSegmented } from './ui.js';
import { exportBackup, errorReason } from './backup.js';
import { latteContent } from './latteList.js';

const timeFmt = new Intl.DateTimeFormat('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
const weekdayFmt = new Intl.DateTimeFormat('zh-TW', { weekday: 'narrow' });

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

export async function render(container, { query = {}, isCurrent }) {
  setTitle('咖啡紀錄');
  // #/?bean=<id>（統計頁點豆子的長條）：只看這支豆子的紀錄；套用後把網址改回 #/，之後照常保留篩選
  if (query.bean) {
    filter.beanId = query.bean;
    filter.minRating = '';
    history.replaceState(null, '', `${location.pathname}${location.search}#/`);
    await setHomeTab('brews'); // 從統計頁點豆子過來：一定是看手沖
  }
  const [beans, latestByBean, backup, installHint, tab] = await Promise.all([
    listBeans({ includeArchived: true }), latestBrewByBean(), getBackupStatus(), getInstallHint(), getHomeTab(),
  ]);
  const rerender = () => render(container, { isCurrent });

  // 上方：安裝 App 的小提示（一行）、備份提醒＋「手沖｜拉花」切換；兩個分頁都有
  const top = `${installHint.show ? installHintHtml(installHint) : ''}${backup.remind ? backupReminderHtml(backup) : ''}
    <div class="home-tabs">${segmentedHtml('homeTab', HOME_TABS, tab)}</div>`;
  // 監聽器掛在這一頁自己的 .home 上（不是 #app）
  const bindTop = (root) => {
    bindReminders(root, rerender);
    bindSegmented(root.querySelector('.home-tabs'), async (name, value) => {
      if (!value || value === tab) return;
      await setHomeTab(value);
      rerender();
    });
  };

  if (tab === 'latte') {
    const latte = await latteContent();
    if (!isCurrent()) { latte.cleanup(); return; }
    revokeThumbs();
    container.innerHTML = `<div class="home">${top}${latte.html}</div>`;
    const root = container.querySelector('.home');
    bindTop(root);
    latte.bind(root, rerender);
    return latte.cleanup;
  }

  // 豆子選項：未封存的，加上有紀錄的已封存豆子
  const beanOptions = beans.filter((b) => !b.archived || latestByBean.has(b.id));
  if (filter.beanId && !beanOptions.some((b) => b.id === filter.beanId)) filter.beanId = '';

  const brews = await listBrews({ beanId: filter.beanId, minRating: Number(filter.minRating) || null });
  if (!isCurrent()) return;
  revokeThumbs();

  if (latestByBean.size === 0) {
    container.innerHTML = `<div class="home">${top}${beans.length === 0
      ? `<div class="empty">
           <p>歡迎！先新增一支豆子，再開始記錄沖煮</p>
           <a class="btn btn-primary" href="#/beans/new">新增豆子</a>
         </div>`
      : `<div class="empty">
           <p>還沒有沖煮紀錄</p>
           <a class="btn btn-primary" href="#/brew/new">新增第一筆</a>
         </div>`}
      <a class="fab" href="#/brew/new" aria-label="新增紀錄">＋</a>
    </div>`;
    // 空白時也放 ＋（新手教學會標示它；沒有豆子時表單會請他先新增豆子）
    bindTop(container.querySelector('.home'));
    return;
  }

  const filtered = filter.beanId || filter.minRating;
  container.innerHTML = `<div class="home">
    ${top}
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
      ? groupByDay(brews).map(({ label, items }) => `
          <section class="day-group">
            <h2 class="list-date">${esc(label)}</h2>
            <ul class="list">${items.map(brewCard).join('')}</ul>
          </section>`).join('')
      : '<div class="empty"><p>沒有符合條件的紀錄</p></div>'}
    <a class="fab" href="#/brew/new" aria-label="新增紀錄">＋</a>
  </div>`;

  const root = container.querySelector('.home');
  root.querySelector('#filter-bean').addEventListener('change', (e) => { filter.beanId = e.target.value; rerender(); });
  root.querySelector('#filter-rating').addEventListener('change', (e) => { filter.minRating = e.target.value; rerender(); });
  root.querySelector('#clear-filter')?.addEventListener('click', () => {
    filter.beanId = '';
    filter.minRating = '';
    rerender();
  });
  bindTop(root);
  return revokeThumbs;
}

const backupReminderHtml = (backup) => `
  <div class="notice backup-reminder" role="alert">
    <p><strong>⚠ ${backup.lastBackupAt ? `上次備份是 ${formatDaysAgo(backup.daysSince)}` : '還沒備份過資料'}</strong></p>
    <p class="hint">資料只存在這支手機上，建議定期匯出備份。</p>
    <div class="reminder-actions">
      <button type="button" class="btn btn-primary" id="backup-now">立即備份</button>
      <button type="button" class="btn" id="backup-later">稍後</button>
    </div>
  </div>`;

/**
 * 還沒安裝（不是從主畫面開啟）的小提示：安裝教學按「稍後」3 天後才出現，一行字，按了打開安裝教學
 * ✕ 關掉就不再出現；sticky（iPhone 的瀏覽器裡已經有資料，7 天沒打開可能被清掉）只安靜 7 天
 */
const installHintHtml = ({ sticky }) => `
  <div class="install-hint" role="status" data-sticky="${sticky}">
    <button type="button" class="install-hint-open" id="install-hint-open">
      <span aria-hidden="true">📲</span><span>${sticky ? '加入主畫面，資料才安全' : '安裝到主畫面，更好用'}</span><span class="install-hint-go">怎麼做 ›</span>
    </button>
    <button type="button" class="install-hint-close" id="install-hint-close" aria-label="${sticky ? '關閉，7 天後再提醒' : '關閉，不再提醒'}">✕</button>
  </div>`;

/** 首頁提示的按鈕（安裝提示、備份提醒）：監聽器掛在提示自己身上 */
function bindReminders(container, rerender) {
  const hintOpen = container.querySelector('#install-hint-open');
  hintOpen?.addEventListener('click', async () => {
    const { startInstallGuide } = await import('./installGuide.js');
    await startInstallGuide({ manual: true, returnFocus: hintOpen });
  });
  container.querySelector('#install-hint-close')?.addEventListener('click', async () => {
    const sticky = container.querySelector('.install-hint').dataset.sticky === 'true';
    await dismissInstallHint();
    if (sticky) toast('7 天後再提醒');
    rerender();
  });
  container.querySelector('#backup-now')?.addEventListener('click', async () => {
    // LINE 等 App 內建的瀏覽器不能直接下載：到備份頁用「分享備份檔」，不在這裡假裝匯出了
    if (isInAppBrowser()) { location.hash = '#/backup'; return; }
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
}

const dayKey = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/** 依沖煮日（本機日期）分組，標題：今天、昨天、10/24（六）；不是今年的加年份 */
export function groupByDay(brews, now = new Date()) {
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const groups = [];
  for (const b of brews) {
    const d = new Date(b.brewedAt);
    const key = dayKey(d);
    if (groups.at(-1)?.key !== key) {
      const md = `${d.getMonth() + 1}/${d.getDate()}（${weekdayFmt.format(d)}）`;
      const label = key === today ? '今天'
        : key === yesterday ? '昨天'
          : d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}/${md}`;
      groups.push({ key, label, items: [] });
    }
    groups.at(-1).items.push(b);
  }
  return groups;
}

function brewCard(b) {
  const stars = b.rating ? '★'.repeat(b.rating) + '☆'.repeat(5 - b.rating) : '';
  // 參數固定兩行：器材｜數字
  const gear = [
    b.method === 'siphon' ? METHODS.siphon : b.dripperName, // 賽風不用濾杯；手沖不另外標
    [b.grinderName, b.grindSetting ? `刻度 ${b.grindSetting}` : ''].filter(Boolean).join(' '), // 例：C40 刻度 24
  ].filter(Boolean);
  const numbers = [
    `${b.coffeeG}g → ${b.waterG}g`,
    formatRatio(b.ratio),
    b.tempC != null ? `${b.tempC}°C` : '',
    b.totalTimeS != null ? formatSeconds(b.totalTimeS) : '',
  ].filter(Boolean);
  const row = (cls, items) => `<div class="card-row ${cls}">${items.map((d) => `<span>${esc(d)}</span>`).join('')}</div>`;

  return `
    <li><a class="card brew-card${b.thumb ? ' has-thumb' : ''}" href="#/brew/${esc(b.id)}">
      <div class="card-body">
        <div class="card-head">
          <span class="card-title">${esc(b.beanName)}${b.visibility === 'friends'
            ? ' <span class="shared-badge" title="好友看得到" aria-label="好友看得到">👥</span>' : ''}</span>
          <span class="stars" aria-label="評分 ${b.rating ?? '未評'}">${stars}</span>
        </div>
        ${gear.length ? row('card-gear', gear) : ''}
        ${row('card-numbers', numbers)}
        <div class="card-row card-time">
          <span>${esc(timeFmt.format(new Date(b.brewedAt)))}</span>
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
