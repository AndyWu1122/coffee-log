// #/feedback 意見回饋（從 ☰ →「設定與關於」進入）：要登入才能送（防灌送），內容只有開發者看得到
// 送出後由 Edge Function 存進 Supabase 並寄 Email 通知開發者；附上暱稱和 App 版本號，不附 email
import {
  getSocialState, socialErrorMessage, sendFeedback, FEEDBACK_CATEGORIES, FEEDBACK_MAX, FEEDBACK_DAILY_MAX,
} from '../models.js';
import {
  setTitle, toast, showMessage, showErrors, segmentedHtml, bindSegmented, segmentedValue, appVersion,
} from './ui.js';

const CATEGORY_OPTIONS = Object.entries(FEEDBACK_CATEGORIES).map(([value, label]) => ({ value, label }));

export async function render(container, { isCurrent }) {
  setTitle('意見回饋');
  const rerender = () => render(container, { isCurrent });
  if (!navigator.onLine) return showMessage(container, '送出意見回饋需要網路連線', rerender);

  container.innerHTML = '<p class="hint">載入中…</p>';
  let state;
  try {
    state = await getSocialState();
  } catch (err) {
    if (isCurrent()) showMessage(container, socialErrorMessage(err), rerender);
    return;
  }
  if (!isCurrent()) return;

  if (state.status === 'unavailable') return showMessage(container, '這個網址沒有開放社群功能');
  if (state.status !== 'ready') {
    const action = state.status === 'signed-out' ? '登入' : '設定暱稱';
    container.innerHTML = `
      <div class="empty">
        <p>要先${action}才能送出意見回饋</p>
        <p class="hint">登入是為了防止有人大量灌送，回饋內容只有開發者看得到。</p>
        <a class="btn btn-primary" href="#/account">前往${action}</a>
      </div>`;
    return;
  }

  container.innerHTML = `
    <form class="form" id="feedback-form" novalidate>
      <p class="hint">遇到問題或想要什麼功能，歡迎告訴開發者。內容只有開發者看得到，會附上你的暱稱和 App 版本號（不會附上 email）。</p>
      <div class="field" data-field="category">
        <span class="label">類型</span>
        ${segmentedHtml('category', CATEGORY_OPTIONS, '')}
        <div class="error"></div>
      </div>
      <div class="field" data-field="message">
        <label for="feedback-message">內容</label>
        <textarea id="feedback-message" name="message" maxlength="${FEEDBACK_MAX}"
          placeholder="例如：在哪一頁、做了什麼、發生了什麼事"></textarea>
        <p class="hint" id="feedback-count"></p>
        <div class="error"></div>
      </div>
      <button class="btn btn-primary btn-block" type="submit">送出</button>
      <p class="hint">每天最多送出 ${FEEDBACK_DAILY_MAX} 則。</p>
    </form>`;

  const form = container.querySelector('#feedback-form');
  const messageEl = form.elements.message;
  const countEl = form.querySelector('#feedback-count');
  const updateCount = () => { countEl.textContent = `${[...messageEl.value].length}／${FEEDBACK_MAX}`; };
  messageEl.addEventListener('input', updateCount);
  updateCount();
  bindSegmented(form); // 綁在這頁自己的表單上（不是 #app）

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const result = await sendFeedback({
        category: segmentedValue(form, 'category'), message: messageEl.value, appVersion: await appVersion(),
      });
      if (!result.ok) return showErrors(form, result.errors);
      container.innerHTML = `
        <div class="empty">
          <p>已送出，謝謝你的回饋！</p>
          <a class="btn" href="#/">回紀錄列表</a>
        </div>`;
    } catch (err) {
      toast(err?.code === 'rate_limited' ? `今天已經送出 ${FEEDBACK_DAILY_MAX} 則回饋，明天再試` : socialErrorMessage(err));
    } finally {
      submit.disabled = false;
    }
  });
}
