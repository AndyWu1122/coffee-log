// views 共用的 DOM 小工具（不碰資料層）

/** HTML 跳脫，所有使用者輸入放進 innerHTML 前都要經過這裡 */
export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function setTitle(title) {
  document.title = title === '手沖紀錄' ? title : `${title}｜手沖紀錄`;
  document.getElementById('page-title').textContent = title;
}

let toastTimer;
export function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

/**
 * 分段按鈕的 HTML。目前值存在容器的 data-value。
 * allowEmpty：再點一次已選的按鈕可取消選擇（選填欄位用）
 */
export function segmentedHtml(name, options, value, { allowEmpty = false, wrap = false } = {}) {
  const buttons = options.map(({ value: v, label }) => `
    <button type="button" data-v="${esc(v)}" aria-pressed="${String(v) === String(value ?? '')}">${esc(label)}</button>
  `).join('');
  return `<div class="segmented${wrap ? ' wrap' : ''}" data-name="${esc(name)}"
    data-value="${esc(value ?? '')}" data-allow-empty="${allowEmpty}" role="group">${buttons}</div>`;
}

/** 在 root 上委派處理所有分段按鈕的點擊；onChange(name, value) 選填 */
export function bindSegmented(root, onChange) {
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('.segmented button');
    if (!btn || !root.contains(btn)) return;
    const group = btn.parentElement;
    const pressed = btn.getAttribute('aria-pressed') === 'true';
    const next = pressed && group.dataset.allowEmpty === 'true' ? '' : btn.dataset.v;
    group.dataset.value = next;
    for (const b of group.querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(b.dataset.v === next));
    }
    onChange?.(group.dataset.name, next);
  });
}

/** 讀取分段按鈕目前的值 */
export function segmentedValue(root, name) {
  return root.querySelector(`.segmented[data-name="${name}"]`)?.dataset.value ?? '';
}

/** 把資料存成 JSON 檔下載 */
export function downloadJson(filename, data) {
  downloadBlob(filename, new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
}

/** 下載 Blob 成檔案 */
export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 依 { 欄位: 訊息 } 顯示驗證錯誤；欄位容器需有 data-field 屬性 */
export function showErrors(form, errors) {
  for (const field of form.querySelectorAll('[data-field]')) {
    const msg = errors[field.dataset.field] ?? '';
    field.classList.toggle('invalid', Boolean(msg));
    const errEl = field.querySelector('.error');
    if (errEl) errEl.textContent = msg;
  }
  const first = form.querySelector('.field.invalid');
  first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/**
 * 頭像：有 signed URL 就顯示圖片，沒有就顯示暱稱的第一個字
 * 暱稱、網址都可能來自他人，一律跳脫
 */
export function avatarHtml({ nickname, avatarUrl }, { large = false } = {}) {
  const cls = `avatar${large ? ' avatar-lg' : ''}`;
  if (avatarUrl) return `<img class="${cls}" src="${esc(avatarUrl)}" alt="" referrerpolicy="no-referrer">`;
  const initial = [...String(nickname ?? '').trim()][0] ?? '?';
  return `<span class="${cls} avatar-initial" aria-hidden="true">${esc(initial)}</span>`;
}

/** 個人檔案頁的網址（頭像、暱稱點過去）；id 由 encodeURIComponent 處理，放進 href 前仍要 esc() */
export const profileHref = (userId) => `#/user/${encodeURIComponent(userId)}`;

/**
 * 提示（☰ 選單的「!」：好友邀請、該備份了、更新內容（在「設定與關於」）；「社群」分頁的數字）可能改變了：app.js 收到後重新檢查
 * 用事件通知，views 不直接呼叫 app.js
 */
export const BADGES_EVENT = 'social-badges-changed';
export const notifyBadgesChanged = () => window.dispatchEvent(new Event(BADGES_EVENT));

/**
 * Service Worker 回覆的版本號 → 字串：'1.2.3'（sw.js 的 APP_VERSION）
 * 舊版 Service Worker（1.0.0 以前）回的是整數 CACHE_VERSION，轉成 '18' 這樣的字串；其他一律 null
 */
export function normalizeAppVersion(data) {
  if (typeof data === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(data)) return data;
  if (Number.isInteger(data) && data >= 1 && data <= 1000000) return String(data);
  return null;
}

/**
 * App 的版本號（字串）：問目前接管這個頁面的 Service Worker（它的 APP_VERSION 就是正在跑的版本）
 * 沒有 Service Worker、或舊版 Service Worker 不認得這個訊息時回傳 null
 */
export function appVersion({ timeout = 1000 } = {}) {
  const worker = navigator.serviceWorker?.controller;
  if (!worker) return Promise.resolve(null);
  return new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    const timer = setTimeout(() => resolve(null), timeout);
    port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve(normalizeAppVersion(e.data));
    };
    worker.postMessage('version', [port2]);
  });
}

/** 頁面層級的訊息（連不上伺服器、需要網路等），可附「重試」按鈕 */
export function showMessage(container, message, onRetry) {
  container.innerHTML = `
    <div class="empty">
      <p>${esc(message)}</p>
      ${onRetry ? '<button type="button" class="btn" data-action="retry">重試</button>' : ''}
    </div>`;
  container.querySelector('[data-action="retry"]')?.addEventListener('click', onRetry);
}

/** 複製文字；瀏覽器不允許時改用 prompt 讓使用者自己複製 */
export async function copyText(text, message = '已複製') {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    prompt('請長按複製：', text);
  }
}

/* ===== 外觀：自動（跟系統）／淺色／深色 ===== */
// 第一次套用在 <head> 的 js/theme.js（避免閃爍）；這裡負責切換（設定頁、app.js 共用），判斷方式要和 theme.js 一致
// 偏好存 localStorage（CLAUDE.md 的唯一例外）；無痕模式等讀寫失敗：只在這次有效

const systemLight = () => matchMedia('(prefers-color-scheme: light)').matches;
let currentPref = null; // 這次選的（localStorage 寫不進去時也記得住）

export function themePref() {
  if (currentPref) return currentPref;
  try { return localStorage.getItem('theme') || 'auto'; } catch { return 'auto'; }
}

export function applyTheme(pref = themePref()) {
  const light = pref === 'light' || (pref !== 'dark' && systemLight());
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  document.querySelector('meta[name="theme-color"]').content = light ? '#ffffff' : '#2b1d14';
  document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]').content = light ? 'default' : 'black-translucent';
}

export function setThemePref(pref) {
  currentPref = pref;
  try { localStorage.setItem('theme', pref); } catch { /* 只在這次有效 */ }
  applyTheme(pref);
}

/* ===== 表單的照片欄位（紀錄、豆子共用） ===== */

/** 照片欄位的 HTML；accept 用 models.PHOTO_ACCEPT（一頁只會有一個照片欄位） */
export const photoFieldHtml = (accept) => `
  <div class="field" data-field="photo">
    <span class="label">照片</span>
    <div class="photo-field" id="photo-field"></div>
    <input type="file" id="photo-input" accept="${esc(accept)}" hidden>
    <div class="error"></div>
  </div>`;

/**
 * 照片欄位的行為：選完就交給 prepare（models.preparePhoto：重新編碼成 JPEG、移除 EXIF）並預覽，存檔時才寫入
 * form：含 photoFieldHtml 的表單；photo：目前存著的照片（{ blob }）或 null；alt：預覽圖的替代文字
 * 回傳 { change()：undefined 不動／null 移除／新照片（交給 saveBrew、saveBean）, busy()：處理中, cleanup()：離開頁面時呼叫 }
 */
export function bindPhotoField(form, { photo, prepare, alt }) {
  const urls = new Set(); // 這個欄位建立的 objectURL，換照片或離開頁面時 revoke
  const objectUrl = (blob) => { const u = URL.createObjectURL(blob); urls.add(u); return u; };
  const revoke = (u) => { if (u) { URL.revokeObjectURL(u); urls.delete(u); } };
  let change;
  let previewUrl = photo ? objectUrl(photo.blob) : null;
  let busy = false;
  let token = 0;
  const field = form.querySelector('[data-field="photo"]');
  const box = field.querySelector('#photo-field');
  const input = field.querySelector('#photo-input');
  const setError = (msg) => {
    field.classList.toggle('invalid', Boolean(msg));
    field.querySelector('.error').textContent = msg;
  };
  const render = () => {
    if (busy) {
      box.innerHTML = '<p class="hint">處理照片中…</p>';
    } else if (previewUrl) {
      box.innerHTML = `
        <img class="photo-preview" src="${previewUrl}" alt="${esc(alt)}">
        <div class="photo-actions">
          <label class="btn" for="photo-input">換一張</label>
          <button type="button" class="btn" data-action="remove-photo">移除</button>
        </div>`;
    } else {
      box.innerHTML = '<label class="btn btn-block" for="photo-input">📷 拍照／選照片</label>';
    }
  };
  render();

  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = ''; // 讓同一張照片可以再選一次
    if (!file) return;
    const t = ++token;
    busy = true;
    setError('');
    render();
    try {
      const prepared = await prepare(file);
      if (t !== token) return; // 處理期間又選了另一張
      revoke(previewUrl);
      change = prepared;
      previewUrl = objectUrl(prepared.blob);
    } catch (err) {
      if (t !== token) return;
      setError(err.message);
    } finally {
      if (t === token) {
        busy = false;
        render();
      }
    }
  });
  box.addEventListener('click', (e) => {
    if (!e.target.closest('[data-action="remove-photo"]')) return;
    revoke(previewUrl);
    previewUrl = null;
    change = null;
    setError('');
    render();
  });

  return {
    change: () => change,
    busy: () => busy,
    cleanup() {
      token++;
      for (const u of urls) URL.revokeObjectURL(u);
      urls.clear();
    },
  };
}
