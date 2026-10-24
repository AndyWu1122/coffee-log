// #/feed/<owner>/<id> 好友紀錄的詳細內容：完整參數、風味、筆記、照片、按讚的人；檢舉這筆紀錄、封鎖對方
// 這頁的內容全部來自他人：文字、網址一律經過 esc() 才放進 innerHTML
import {
  getSocialState, socialErrorMessage, getFeedBrew, FLAVOR, flavorNote, formatSeconds,
  REPORT_REASONS, REPORT_DETAIL_MAX, reportBrew, blockUser,
} from '../models.js';
import { esc, setTitle, toast, showMessage, showErrors, segmentedHtml, bindSegmented, segmentedValue } from './ui.js';
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

  container.innerHTML = `<div id="feed-detail-page">
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
    <a class="btn btn-block" href="#/feed">回好友動態</a>

    <section class="section safety">
      <div class="photo-actions">
        <button type="button" class="btn" data-action="report">檢舉</button>
        <button type="button" class="btn btn-danger" data-action="block">封鎖</button>
      </div>
      <form class="form" id="report-form" novalidate hidden>
        <p class="hint">檢舉只有站長看得到，對方不會知道是誰檢舉的。</p>
        <div class="field" data-field="reason">
          <span class="label">原因</span>
          ${segmentedHtml('reason', REASON_OPTIONS, '', { wrap: true })}
          <div class="error"></div>
        </div>
        <div class="field" data-field="detail">
          <label for="report-detail">說明（選填）</label>
          <textarea id="report-detail" name="detail" maxlength="${REPORT_DETAIL_MAX}" placeholder="最多 ${REPORT_DETAIL_MAX} 字"></textarea>
          <div class="error"></div>
        </div>
        <button class="btn btn-primary btn-block" type="submit">送出檢舉</button>
      </form>
    </section>
  </div>`;

  // 綁在這頁自己的元素上（#app 換頁不會被替換，綁在上面的監聽器會殘留）
  bindLikes(container.querySelector('#feed-detail-page'), state.user.id, new Map([[`${item.owner}/${item.id}`, item]]));

  // 檢舉：按「檢舉」才展開表單
  const form = container.querySelector('#report-form');
  bindSegmented(form);
  container.querySelector('[data-action="report"]').addEventListener('click', () => {
    form.hidden = !form.hidden;
    if (!form.hidden) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const result = await reportBrew(item.owner, item.id, { reason: segmentedValue(form, 'reason'), detail: form.detail.value });
      if (!result.ok) return showErrors(form, result.errors);
      form.hidden = true;
      form.reset();
      const reasons = form.querySelector('.segmented[data-name="reason"]');
      reasons.dataset.value = '';
      for (const b of reasons.querySelectorAll('button')) b.setAttribute('aria-pressed', 'false');
      toast('已送出檢舉，謝謝你');
    } catch (err) {
      toast(err?.code === 'P0001' ? '今天的檢舉次數已達上限，明天再試' : socialErrorMessage(err));
    } finally {
      submit.disabled = false;
    }
  });

  // 封鎖：同時解除好友，對方看不到你的任何東西，也不會知道被封鎖
  container.querySelector('[data-action="block"]').addEventListener('click', async () => {
    if (!confirm(`確定封鎖「${item.nickname}」？\n會同時解除好友，雙方都看不到對方分享的紀錄。對方不會收到通知。`)) return;
    try {
      await blockUser(item.owner);
      toast('已封鎖');
      location.hash = '#/feed';
    } catch (err) {
      toast(socialErrorMessage(err));
    }
  });
}

const REASON_OPTIONS = Object.entries(REPORT_REASONS).map(([value, label]) => ({ value, label }));
