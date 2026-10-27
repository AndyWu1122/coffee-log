// #/notifications 通知設定（從 ☰ →「設定與關於」進入）：「新留言」「回覆」「按讚」「好友新貼文」開關（存在帳號），以及在這台裝置啟用推播通知
// 只有按「在這台裝置啟用通知」時才詢問通知權限（不在打開 App 時詢問）
// iPhone 要從主畫面開啟才能用推播：不是的話只顯示加入主畫面的說明
import {
  getPushState, enablePush, disablePushHere, saveNotificationPrefs, socialErrorMessage,
} from '../models.js';
import { setTitle, toast, showMessage } from './ui.js';

export async function render(container, { isCurrent }) {
  setTitle('通知設定');
  const rerender = () => render(container, { isCurrent });
  if (!navigator.onLine) return showMessage(container, '通知設定需要網路連線', rerender);

  container.innerHTML = '<p class="hint">載入中…</p>';
  let state;
  try {
    state = await getPushState();
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
        <p>要先${action}才能設定通知</p>
        <p class="hint">登入後，有人留言你分享的紀錄、回覆你的留言、按讚，或好友分享新的紀錄時，手機會跳出通知。</p>
        <a class="btn btn-primary" href="#/account">前往${action}</a>
      </div>`;
    return;
  }

  const { prefs } = state;
  container.innerHTML = `
    <div class="notifications-page">
      <section class="section panel" id="push-device">
        <h2>這台裝置</h2>
        ${deviceHtml(state)}
      </section>

      <section class="section panel">
        <h2>要通知哪些</h2>
        <label class="switch-row">
          <input type="checkbox" name="comments" ${prefs.comments ? 'checked' : ''}>
          <span><strong>新留言</strong><span class="hint">有人留言我分享的紀錄</span></span>
        </label>
        <label class="switch-row">
          <input type="checkbox" name="replies" ${prefs.replies ? 'checked' : ''}>
          <span><strong>回覆</strong><span class="hint">有人回覆我的留言</span></span>
        </label>
        <label class="switch-row">
          <input type="checkbox" name="likes" ${prefs.likes ? 'checked' : ''}>
          <span><strong>按讚</strong><span class="hint">有人說我分享的紀錄讚</span></span>
        </label>
        <label class="switch-row">
          <input type="checkbox" name="newPosts" ${prefs.newPosts ? 'checked' : ''}>
          <span><strong>好友新貼文</strong><span class="hint">好友分享了新的紀錄（預設關閉）</span></span>
        </label>
        <p class="hint">這些開關存在你的帳號，每一台啟用通知的裝置都一樣。</p>
      </section>

      <section class="section">
        <ul class="plain-list hint">
          <li>留言、回覆的通知只顯示「○○ 留言了你的貼文」或「○○ 回覆了你的留言」（○○ 是對方的暱稱），不會顯示留言內容，鎖定畫面上也一樣</li>
          <li>好友新貼文顯示「○○ 分享了一杯 豆子名稱」，不會顯示筆記</li>
          <li>同一篇紀錄 5 分鐘內的多則留言只通知一次</li>
          <li>同一篇紀錄 30 分鐘內的讚合併成一則「○○ 和其他 N 人說你的貼文讚」；同一位好友 30 分鐘內的新貼文也合併成一則（iPhone 合併時可能仍會響）</li>
          <li>同一個人對同一篇紀錄的讚只通知一次，收回再按不會再通知；分享過的紀錄改回只有我再分享也不會再通知</li>
          <li>點通知會打開那篇紀錄</li>
        </ul>
        <a href="#/privacy">隱私說明：訂閱資訊存在哪、怎麼關閉</a>
      </section>
    </div>`;

  const page = container.querySelector('.notifications-page');
  bindDevice(page, rerender);

  // 開關：改了就存；失敗改回原本的狀態
  for (const input of page.querySelectorAll('.switch-row input')) {
    input.addEventListener('change', async () => {
      const values = Object.fromEntries([...page.querySelectorAll('.switch-row input')].map((el) => [el.name, el.checked]));
      input.disabled = true;
      try {
        await saveNotificationPrefs(values);
        toast('已儲存');
      } catch (err) {
        input.checked = !input.checked;
        toast(socialErrorMessage(err));
      } finally {
        input.disabled = false;
      }
    });
  }
}

function deviceHtml({ support, device }) {
  if (support === 'ios-browser') {
    return `
      <div class="notice" id="push-ios-help">
        <p><strong>iPhone 要先加入主畫面才能收到通知</strong></p>
        <p>請先按 Safari 下方的「分享」→「加入主畫面」，再從主畫面的「咖啡紀錄」開啟，回到這一頁啟用通知。</p>
      </div>`;
  }
  if (support === 'unsupported') {
    return '<p class="notice">這個瀏覽器不支援通知。iPhone 需要 iOS 16.4 以上，並從主畫面開啟。</p>';
  }
  if (support === 'unconfigured') return '<p class="notice">這個網址還沒開放推播通知。</p>';
  if (device === 'denied') {
    return `
      <div class="notice notice-error" id="push-denied-help">
        <p><strong>你已經拒絕了這個 App 的通知</strong></p>
        <p>要收到通知，請到系統設定開啟：</p>
        <ul>
          <li>iPhone：設定 →「通知」→「咖啡紀錄」→ 允許通知</li>
          <li>Android：Chrome → 右上角 ⋮ →「設定」→「網站設定」→「通知」</li>
        </ul>
        <p>開啟後回到這一頁，按「重新檢查」。</p>
      </div>
      <button type="button" class="btn btn-block" data-action="recheck">重新檢查</button>`;
  }
  if (device === 'on') {
    return `
      <p>✅ 這台裝置已啟用通知</p>
      <button type="button" class="btn btn-block" data-action="disable">在這台裝置停用通知</button>
      <p class="hint">登出時也會停用這台裝置的通知。</p>`;
  }
  return `
    <p class="hint">啟用後，手機會詢問是否允許通知，請選「允許」。</p>
    <button type="button" class="btn btn-primary btn-block" data-action="enable">在這台裝置啟用通知</button>`;
}

function bindDevice(page, rerender) {
  page.querySelector('[data-action="recheck"]')?.addEventListener('click', rerender);

  const enable = page.querySelector('[data-action="enable"]');
  enable?.addEventListener('click', async () => {
    enable.disabled = true;
    try {
      const result = await enablePush();
      if (result.ok) toast('已啟用通知');
      else if (result.reason === 'dismissed') toast('沒有允許通知，需要時再按一次');
      else if (result.reason === 'too_many_devices') toast('最多 10 台裝置能收到通知，請先在不用的裝置停用或登出');
      rerender(); // 拒絕時顯示到系統設定開啟的說明
    } catch (err) {
      toast(socialErrorMessage(err));
      enable.disabled = false;
    }
  });

  const disable = page.querySelector('[data-action="disable"]');
  disable?.addEventListener('click', async () => {
    disable.disabled = true;
    try {
      await disablePushHere();
      toast('已停用這台裝置的通知');
    } catch (err) {
      toast(socialErrorMessage(err)); // 雲端沒刪到也已經退訂：推播服務會回 410，下次送的時候自動清掉
    }
    rerender();
  });
}
