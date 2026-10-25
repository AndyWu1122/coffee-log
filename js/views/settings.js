// #/settings 設定與關於（☰ 選單最下面一項）：不常用的設定與說明都在這裡，☰ 只放常用的
// 外觀（存 localStorage，見 ui.setThemePref）、通知設定、隱私說明、更新內容、意見回饋、開發者後台、版本號
// 社群項目只在 js/config.js 有設定時顯示；開發者後台只有開發者看得到（權限在資料庫與 Edge Function）
import { socialAvailable, getChangelogStatus, isAdmin } from '../models.js';
import { esc, setTitle, appVersion, themePref, setThemePref } from './ui.js';

const THEMES = [
  { value: 'auto', label: '自動' },
  { value: 'light', label: '淺色' },
  { value: 'dark', label: '深色' },
];

const row = (href, icon, label, extra = '') =>
  `<a class="settings-row" href="${href}"${extra}><span aria-hidden="true">${icon}</span>${label}</a>`;

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

      ${socialAvailable ? `
      <section class="section">
        <h2>通知</h2>
        <nav class="settings-group">${row('#/notifications', '🔔', '通知設定')}</nav>
      </section>` : ''}

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
    isAdmin().then((admin) => {
      if (!isCurrent()) return;
      root.querySelector('[data-admin]').hidden = !admin;
      root.dataset.adminChecked = 'true'; // 問完了（測試等這個再判斷有沒有入口）
    });
  }
}
