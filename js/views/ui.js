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

/**
 * 社群提示（☰ 的好友邀請、「好友」分頁的新貼文）可能改變了：app.js 收到後重新檢查
 * 用事件通知，views 不直接呼叫 app.js
 */
export const BADGES_EVENT = 'social-badges-changed';
export const notifyBadgesChanged = () => window.dispatchEvent(new Event(BADGES_EVENT));

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
