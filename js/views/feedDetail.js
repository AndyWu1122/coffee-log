// #/feed/<owner>/<id> 好友紀錄的詳細內容：完整參數、風味、筆記、照片、按讚的人
// 這頁的內容全部來自他人：文字、網址一律經過 esc() 才放進 innerHTML
import { getSocialState, socialErrorMessage, getFeedBrew, FLAVOR, flavorNote, formatSeconds } from '../models.js';
import { esc, setTitle, showMessage } from './ui.js';
import { feedCardHtml, bindLikes } from './feed.js';

export async function render(container, { params: [owner, id], isCurrent }) {
  setTitle('好友的紀錄');
  const rerender = () => render(container, { params: [owner, id], isCurrent });
  if (!navigator.onLine) return showMessage(container, '需要網路才能看好友動態', rerender);

  container.innerHTML = '<p class="hint">載入中…</p>';
  let state;
  let item = null;
  try {
    state = await getSocialState();
    if (state.status === 'ready') item = await getFeedBrew(state.user.id, owner, id);
  } catch (err) {
    if (isCurrent()) showMessage(container, socialErrorMessage(err), rerender);
    return;
  }
  if (!isCurrent()) return;

  if (state.status === 'unavailable') return showMessage(container, '這個網址沒有開放社群功能');
  if (state.status !== 'ready') {
    container.innerHTML = '<div class="empty"><p>要先登入才能看好友動態</p><a class="btn btn-primary" href="#/account">前往帳號</a></div>';
    return;
  }
  // 不是好友、被封鎖、已刪除或改回只有我：一律同樣的訊息
  if (!item) {
    container.innerHTML = '<div class="empty"><p>找不到這筆紀錄（可能已經刪除，或不再分享）</p><a class="btn" href="#/feed">回好友動態</a></div>';
    return;
  }

  const bean = [item.origin, item.process, item.roastLevel, item.restDays != null ? `養豆 ${item.restDays} 天` : '']
    .filter(Boolean);
  const rows = [
    ['濾杯', item.dripper],
    ['磨豆機', [item.grinderName, item.grindSetting].filter(Boolean).join(' ')],
    ['粉量／水量', `${item.coffeeG}g／${item.waterG}g`],
    ['水溫', item.tempC != null ? `${item.tempC}°C` : ''],
    ['總時間', item.totalTimeS != null ? formatSeconds(item.totalTimeS) : ''],
  ].filter(([, v]) => v);
  const scores = Object.entries(FLAVOR).filter(([k]) => item.flavor[k] != null);
  const notes = item.flavorNotes.map(flavorNote).filter(Boolean);

  container.innerHTML = `
    <ul class="list feed">${feedCardHtml(item, { detail: true })}</ul>
    ${bean.length ? `<section class="section"><h2>豆子</h2><p class="detail-text">${esc(bean.join('・'))}</p></section>` : ''}
    <section class="section">
      <h2>參數</h2>
      <dl class="detail-list">
        ${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}
      </dl>
    </section>
    ${scores.length ? `
      <section class="section">
        <h2>風味</h2>
        <dl class="detail-list">
          ${scores.map(([k, label]) => `<div><dt>${esc(label)}</dt><dd>${esc(item.flavor[k])} / 5</dd></div>`).join('')}
        </dl>
      </section>` : ''}
    ${notes.length ? `
      <section class="section">
        <h2>風味輪</h2>
        <ul class="note-chips">
          ${notes.map((n) => `<li class="note-chip"><i style="background:${n.color}"></i>${esc(n.zh)}</li>`).join('')}
        </ul>
      </section>` : ''}
    ${item.notes ? `<section class="section"><h2>筆記</h2><p class="detail-text detail-notes">${esc(item.notes)}</p></section>` : ''}
    <a class="btn btn-block" href="#/feed">回好友動態</a>`;

  bindLikes(container, state.user.id, new Map([[`${item.owner}/${item.id}`, item]]));
}
