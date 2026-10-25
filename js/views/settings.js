// #/settings 設定與關於（☰ 選單最下面一項）：所有設定都從這裡找得到，☰ 只放常用的
// 外觀（存 localStorage，見 ui.setThemePref）；帳號與社群：帳號、我的個人檔案、通知設定、「讓好友看到我的熱度圖」開關；
// 關於：隱私說明、更新內容、意見回饋、開發者後台、版本號
// 社群項目只在 js/config.js 有設定時顯示；開發者後台只有開發者看得到（權限在資料庫與 Edge Function）
// 整頁先畫好（不等網路），登入狀態只讀本機；熱度圖開關的狀態讀到雲端才補上
import {
  socialAvailable, getChangelogStatus, isAdmin, signedInUserId, getActivityShare, setActivityShare, socialErrorMessage,
} from '../models.js';
import { esc, setTitle, toast, appVersion, themePref, setThemePref, profileHref } from './ui.js';

const THEMES = [
  { value: 'auto', label: '自動' },
  { value: 'light', label: '淺色' },
  { value: 'dark', label: '深色' },
];

const row = (href, icon, label, extra = '') =>
  `<a class="settings-row" href="${href}"${extra}><span aria-hidden="true">${icon}</span>${label}</a>`;

/** 帳號與社群：沒登入時「我的個人檔案」不能點（先畫成停用，讀到登入狀態再換成連結） */
const socialHtml = () => `
  <section class="section" id="settings-social">
    <h2>帳號與社群</h2>
    <nav class="settings-group">
      ${row('#/account', '👤', '<span class="settings-text">帳號<span class="settings-sub">暱稱、頭像、好友代碼、登出、刪除帳號</span></span>', ' id="settings-account"')}
      <span class="settings-row is-disabled" id="settings-profile" aria-disabled="true"><span aria-hidden="true">🪪</span><span
        class="settings-text">我的個人檔案<span class="settings-sub">登入後才能使用</span></span></span>
      ${row('#/notifications', '🔔', '通知設定')}
    </nav>
    <div class="settings-group settings-toggle" id="activity-share-section">
      <label class="switch-row">
        <input type="checkbox" id="activity-share" disabled>
        <span><strong>讓好友看到我的熱度圖</strong><span class="hint">只上傳近一年每天沖了幾杯，不含評分、豆子等其他資料；關閉時雲端的資料會刪除</span></span>
      </label>
      <p class="hint" id="activity-share-status" aria-live="polite"></p>
      <button type="button" class="btn btn-block" data-action="activity-here" hidden>改用這台裝置的紀錄</button>
    </div>
  </section>`;

export function render(container, { isCurrent }) {
  setTitle('設定與關於');
  const pref = themePref();
  container.innerHTML = `
    <div class="settings">
      <section class="section">
        <h2 id="theme-label">🌓 外觀</h2>
        <div class="theme-options" role="radiogroup" aria-labelledby="theme-label">
          ${THEMES.map(({ value, label }) => `<button type="button" role="radio" data-theme-pref="${value}"
            aria-checked="${value === pref}">${label}</button>`).join('')}
        </div>
      </section>

      ${socialAvailable ? socialHtml() : ''}

      <section class="section">
        <h2>關於</h2>
        <nav class="settings-group">
          ${row('#/privacy', '🔒', '隱私說明')}
          <a class="settings-row" href="#/changelog" id="settings-changelog"><span aria-hidden="true">✨</span>更新內容<span
            class="menu-alert" data-alert="changelog" aria-hidden="true" hidden>!</span></a>
          ${socialAvailable ? row('#/feedback', '💬', '意見回饋') : ''}
        </nav>
      </section>

      <section class="section" data-admin hidden>
        <h2>開發者</h2>
        <nav class="settings-group">${row('#/admin', '🛠️', '開發者後台')}</nav>
      </section>

      <p class="settings-version" id="app-version" hidden><a href="#/changelog"></a></p>
    </div>`;

  const root = container.querySelector('.settings');
  root.querySelector('.theme-options').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-theme-pref]');
    if (!btn) return;
    setThemePref(btn.dataset.themePref);
    for (const b of root.querySelectorAll('[data-theme-pref]')) {
      b.setAttribute('aria-checked', String(b === btn));
    }
  });

  // 版本號與「更新內容」的「!」（沒有 Service Worker 時都不顯示）、開發者後台：問完才補上
  (async () => {
    const version = await appVersion();
    if (!isCurrent()) return;
    if (version) {
      const el = root.querySelector('#app-version');
      el.firstElementChild.textContent = `版本 ${version}`;
      el.hidden = false;
      const { unseen } = await getChangelogStatus(version);
      if (!isCurrent()) return;
      root.querySelector('[data-alert="changelog"]').hidden = !unseen;
      if (unseen) root.querySelector('#settings-changelog').setAttribute('aria-label', '更新內容（有新版的更新內容）');
    }
  })().catch((err) => console.warn('版本檢查失敗', err));
  if (socialAvailable) {
    bindSocial(root, isCurrent);
    isAdmin().then((admin) => {
      if (!isCurrent()) return;
      root.querySelector('[data-admin]').hidden = !admin;
      root.dataset.adminChecked = 'true'; // 問完了（測試等這個再判斷有沒有入口）
    });
  }
}

/* ===== 帳號與社群 ===== */

const ACTIVITY_STATUS = {
  'signed-out': '登入後才能開啟（☰ →「帳號」）',
  off: '關閉中：好友看不到你的熱度圖',
  here: '已開啟：由這台裝置的紀錄更新（好友看到的是杯數和連續天數）',
  elsewhere: '已開啟：由另一台裝置的紀錄更新；在這台按下面的按鈕，會改用這台的紀錄',
};

async function bindSocial(root, isCurrent) {
  const status = root.querySelector('#activity-share-status');
  const userId = await signedInUserId();
  if (!isCurrent()) return;
  root.querySelector('#settings-social').dataset.signedIn = String(Boolean(userId)); // 讀完登入狀態了（測試用）
  if (!userId) {
    status.textContent = ACTIVITY_STATUS['signed-out'];
    return;
  }
  // 我的個人檔案：換成連結
  const profile = root.querySelector('#settings-profile');
  profile.outerHTML = row(esc(profileHref(userId)), '🪪', '我的個人檔案', ' id="settings-profile"');
  bindActivityShare(root.querySelector('#activity-share-section'), isCurrent);
}

/** 「讓好友看到我的熱度圖」（預設關閉；只有打開的那台裝置上傳，見 sync.js） */
function bindActivityShare(section, isCurrent) {
  const input = section.querySelector('#activity-share');
  const status = section.querySelector('#activity-share-status');
  const here = section.querySelector('[data-action="activity-here"]');
  const show = ({ on, here: mine }) => {
    input.checked = on;
    input.disabled = false;
    here.hidden = !on || mine;
    status.textContent = ACTIVITY_STATUS[!on ? 'off' : mine ? 'here' : 'elsewhere'];
  };
  status.textContent = navigator.onLine ? '讀取中…' : '需要網路連線才能切換';
  if (!navigator.onLine) return;
  const load = () => getActivityShare().then((s) => { if (isCurrent()) show(s); }, (err) => {
    if (isCurrent()) status.textContent = socialErrorMessage(err);
  });
  const apply = async (on, message) => {
    input.disabled = true;
    here.disabled = true;
    try {
      await setActivityShare(on);
      toast(message);
    } catch (err) {
      toast(socialErrorMessage(err));
    } finally {
      here.disabled = false;
      await load(); // 以雲端實際的狀態為準（失敗時改回原本的）
    }
  };
  input.addEventListener('change', () => apply(input.checked,
    input.checked ? '好友現在看得到你的熱度圖' : '已關閉，雲端的熱度圖資料已刪除'));
  here.addEventListener('click', () => apply(true, '已改用這台裝置的紀錄'));
  load();
}
