// #/account 帳號（從右上角 ☰ 選單進入）：自己的沖煮熱度圖、Google 登入、暱稱、頭像、好友代碼與 QR code、登出、刪除帳號
// 熱度圖只用本機資料，離線、沒登入、沒有社群功能都照樣顯示；下面的社群內容另外畫在 #account-main
// 其他設定（我的個人檔案、通知設定、「讓好友看到我的熱度圖」）都在「設定與關於」（views/settings.js）
import {
  getSocialState, socialErrorMessage, signInWithGoogle, signOut, isInAppBrowser,
  createProfile, updateNickname, prepareAvatar, saveAvatar, removeAvatar, PHOTO_ACCEPT,
  formatFriendCode, friendInviteUrl, qrSvg, regenerateFriendCode, deleteAccount, socialAvailable,
} from '../models.js';
import { esc, setTitle, toast, showErrors, avatarHtml, showMessage, copyText, notifyBadgesChanged } from './ui.js';
import { renderMyHeatmap } from './heatmap.js';

export async function render(container, { isCurrent }) {
  setTitle('帳號');
  const rerender = () => render(container, { isCurrent });
  container.innerHTML = `<div id="account-heatmap"></div>
    ${socialAvailable ? '<p class="hint account-heatmap-hint">要讓好友看到熱度圖，到 ☰ →「<a href="#/settings">設定與關於</a>」開啟。</p>' : ''}
    <div id="account-main"><p class="hint">載入中…</p></div>`;
  const main = container.querySelector('#account-main');
  renderMyHeatmap(container.querySelector('#account-heatmap'), { isCurrent });
  if (!navigator.onLine) return showMessage(main, '社群功能需要網路連線', rerender);

  let state;
  try {
    state = await getSocialState();
  } catch (err) {
    if (isCurrent()) showMessage(main, socialErrorMessage(err), rerender);
    return;
  }
  if (!isCurrent()) return;

  if (state.status === 'unavailable') return showMessage(main, '這個網址沒有開放社群功能');
  if (state.status === 'signed-out') return renderSignedOut(main);
  if (state.status === 'no-profile') return renderNoProfile(main, state, rerender);
  return renderReady(main, state, { isCurrent, rerender });
}

/* ===== 沒登入 ===== */

function renderSignedOut(container) {
  const inApp = isInAppBrowser();
  container.innerHTML = `
    <section class="section">
      <h2>咖啡社群</h2>
      <p>登入後可以用好友代碼加朋友，雙方同意才會成為好友。</p>
      <ul class="plain-list hint">
        <li>只收暱稱和頭像，不收真名</li>
        <li>Google 帳號的 email 只用來登入，其他使用者看不到</li>
        <li>不登入也能照常使用，紀錄都存在這支手機</li>
      </ul>
      <a href="#/privacy">隱私說明：收集什麼、誰看得到、怎麼刪除</a>
      ${inApp ? `<div class="notice notice-error">LINE、Facebook 等 App 內建的瀏覽器無法用 Google 登入，
        請用 Safari 或 Chrome 開啟這個網址。</div>` : ''}
      <button type="button" class="btn btn-primary btn-block" data-action="google">用 Google 登入</button>
    </section>`;
  const btn = container.querySelector('[data-action="google"]');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      await signInWithGoogle(); // 成功會換頁到 Google
    } catch (err) {
      btn.disabled = false;
      toast(socialErrorMessage(err));
    }
  });
}

/* ===== 登入了，還沒設定暱稱 ===== */

function renderNoProfile(container, { user }, rerender) {
  container.innerHTML = `
    <form class="form" id="profile-form" novalidate>
      <p>歡迎！先設定一個暱稱，好友會看到這個名字。</p>
      <div class="field" data-field="nickname">
        <label for="nickname">暱稱</label>
        <input id="nickname" name="nickname" autocomplete="nickname" placeholder="最多 20 個字" required>
        <div class="error"></div>
      </div>
      <button class="btn btn-primary btn-block" type="submit">開始使用</button>
      <p class="hint">登入的帳號：${esc(user.email)}</p>
      <button type="button" class="link-btn" data-action="signout">改用其他帳號（登出）</button>
    </form>`;
  const form = container.querySelector('#profile-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const result = await createProfile(form.nickname.value);
      if (!result.ok) return showErrors(form, { nickname: result.error });
      toast('已設定暱稱');
      rerender();
    } catch (err) {
      toast(socialErrorMessage(err));
    } finally {
      submit.disabled = false;
    }
  });
  bindSignOut(container, rerender);
}

/* ===== 可以使用 ===== */

function renderReady(container, { user, profile }, { isCurrent, rerender }) {
  container.innerHTML = `
    <section class="section">
      <div class="profile-head">
        ${avatarHtml(profile, { large: true })}
        <div class="profile-text">
          <div class="profile-name">${esc(profile.nickname)}</div>
          <div class="hint">${esc(user.email)}</div>
        </div>
      </div>
      <div class="photo-actions">
        <label class="btn" for="avatar-input">${profile.hasAvatar ? '更換頭像' : '設定頭像'}</label>
        ${profile.hasAvatar ? '<button type="button" class="btn" data-action="remove-avatar">移除頭像</button>' : ''}
      </div>
      <input type="file" id="avatar-input" accept="${PHOTO_ACCEPT}" hidden>
      <p class="hint">頭像會重新壓縮並移除照片裡的位置等資訊，只有好友和邀請中的對方看得到。</p>
    </section>

    <form class="section form" id="nickname-form" novalidate>
      <div class="field" data-field="nickname">
        <label for="nickname">暱稱</label>
        <input id="nickname" name="nickname" value="${esc(profile.nickname)}" autocomplete="nickname" required>
        <div class="error"></div>
      </div>
      <button class="btn btn-block" type="submit">儲存暱稱</button>
    </form>

    <section class="section">
      <h2>我的好友代碼</h2>
      <p class="hint">把代碼或 QR code 給朋友，對方輸入後會送出邀請，你接受了才會成為好友。</p>
      <div class="friend-code" aria-label="好友代碼">${esc(formatFriendCode(profile.friendCode))}</div>
      <div class="qr-box" id="qr"></div>
      <div class="photo-actions">
        <button type="button" class="btn" data-action="copy">複製代碼</button>
        <button type="button" class="btn" data-action="share">分享連結</button>
      </div>
      <button type="button" class="link-btn" data-action="regenerate">重新產生代碼（舊代碼會失效）</button>
    </section>

    <a class="btn btn-block" href="#/friends">好友與邀請</a>
    <p class="hint">我的個人檔案、通知設定、熱度圖的公開設定在 ☰ →「<a href="#/settings">設定與關於</a>」。</p>

    <section class="section account-signout">
      <p class="hint">登出只影響社群功能，這支手機上的沖煮紀錄不會刪除；這台裝置的推播通知會停用。</p>
      <button type="button" class="btn btn-block" data-action="signout">登出</button>
      <a href="#/privacy">隱私說明</a>
    </section>

    <section class="section">
      <button type="button" class="btn btn-danger btn-block" data-action="show-delete">刪除我的帳號</button>
      <form class="form danger-zone" id="delete-form" novalidate hidden>
        <h2>刪除我的帳號</h2>
        <ul class="plain-list">
          <li>雲端的暱稱、頭像、分享給好友的紀錄和照片、讚、好友關係、意見回饋、通知設定會<strong>立即全部刪除，無法復原</strong></li>
          <li>這支手機上的沖煮紀錄會保留；分享給好友的紀錄會改回「只有我」</li>
          <li>之後可以用同一個 Google 帳號重新註冊，但好友要重新加</li>
        </ul>
        <p class="hint">刪除前建議先 <a href="#/backup">匯出備份</a>。</p>
        <div class="field" data-field="confirm">
          <label for="delete-confirm">請輸入你的暱稱「${esc(profile.nickname)}」確認</label>
          <input id="delete-confirm" name="confirm" autocomplete="off">
          <div class="error"></div>
        </div>
        <button class="btn btn-danger btn-block" type="submit">永久刪除帳號</button>
      </form>
    </section>`;

  const code = profile.friendCode;
  const inviteUrl = friendInviteUrl(code);
  qrSvg(inviteUrl).then((svg) => {
    if (isCurrent()) container.querySelector('#qr').innerHTML = svg; // SVG 由我們自己產生，只含數字座標
  });

  // 頭像
  const avatarInput = container.querySelector('#avatar-input');
  avatarInput.addEventListener('change', async () => {
    const file = avatarInput.files[0];
    avatarInput.value = '';
    if (!file) return;
    let blob;
    try {
      toast('處理中…');
      blob = await prepareAvatar(file);
    } catch (err) {
      return toast(err.message); // 格式不對、無法解碼：訊息可直接顯示
    }
    try {
      await saveAvatar(user.id, blob);
      toast('已更新頭像');
      rerender();
    } catch (err) {
      toast(socialErrorMessage(err));
    }
  });
  container.querySelector('[data-action="remove-avatar"]')?.addEventListener('click', async () => {
    if (!confirm('確定移除頭像？')) return;
    try {
      await removeAvatar(user.id);
      toast('已移除頭像');
      rerender();
    } catch (err) {
      toast(socialErrorMessage(err));
    }
  });

  // 暱稱
  const form = container.querySelector('#nickname-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const result = await updateNickname(user.id, form.nickname.value);
      if (!result.ok) return showErrors(form, { nickname: result.error });
      showErrors(form, {});
      toast('已儲存暱稱');
      rerender();
    } catch (err) {
      toast(socialErrorMessage(err));
    }
  });

  // 好友代碼
  container.querySelector('[data-action="copy"]').addEventListener('click', () => copyText(code, '已複製好友代碼'));
  container.querySelector('[data-action="share"]').addEventListener('click', async () => {
    const data = { title: '咖啡紀錄：加我為好友', text: `我的好友代碼：${formatFriendCode(code)}`, url: inviteUrl };
    if (navigator.share) {
      try { await navigator.share(data); } catch { /* 使用者取消 */ }
    } else {
      copyText(inviteUrl, '已複製邀請連結');
    }
  });
  container.querySelector('[data-action="regenerate"]').addEventListener('click', async () => {
    if (!confirm('重新產生後，舊的代碼和 QR code 會立刻失效（已經是好友的不受影響）。確定？')) return;
    try {
      await regenerateFriendCode();
      toast('已產生新的好友代碼');
      rerender();
    } catch (err) {
      toast(socialErrorMessage(err));
    }
  });

  bindSignOut(container, rerender);

  // 刪除帳號：展開說明，輸入暱稱確認後立即刪除
  const deleteForm = container.querySelector('#delete-form');
  container.querySelector('[data-action="show-delete"]').addEventListener('click', (e) => {
    e.currentTarget.hidden = true;
    deleteForm.hidden = false;
    deleteForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  deleteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (deleteForm.confirm.value.trim() !== profile.nickname) {
      return showErrors(deleteForm, { confirm: '輸入的暱稱不一致' });
    }
    showErrors(deleteForm, {});
    const submit = deleteForm.querySelector('[type="submit"]');
    submit.disabled = true;
    submit.textContent = '刪除中…';
    try {
      await deleteAccount();
      notifyBadgesChanged(); // 沒登入了：「!」全部消失
      toast('帳號已刪除');
      rerender();
    } catch (err) {
      toast(socialErrorMessage(err));
      submit.disabled = false;
      submit.textContent = '永久刪除帳號';
    }
  });
}

function bindSignOut(container, rerender) {
  container.querySelector('[data-action="signout"]')?.addEventListener('click', async () => {
    if (!confirm('確定登出？這支手機上的沖煮紀錄不會刪除。')) return;
    try {
      await signOut();
    } catch { /* 網路失敗也已經清掉本機的登入狀態 */ }
    notifyBadgesChanged(); // 沒登入了：「!」全部消失
    toast('已登出');
    rerender();
  });
}

