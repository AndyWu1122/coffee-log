// #/user/<id> 個人檔案：頭像、暱稱、貼文數、加入日期、常用器材、喜歡的豆子、自我介紹
// - 本人、沒有封鎖的好友：全部顯示；自己的檔案有「編輯個人檔案」
// - 還不是好友：只顯示暱稱（留言當下的快照或邀請中的對方）和預設頭像
// - 有封鎖、帳號不存在：一律「找不到這個用戶」
// 暱稱、自我介紹、器材、豆子都來自使用者：一律經過 esc() 才放進 innerHTML；自我介紹的換行交給 CSS（white-space: pre-line）
import {
  getSocialState, socialErrorMessage, getUserProfile, saveProfile, prepareAvatar, saveAvatar, removeAvatar, PHOTO_ACCEPT,
  NICKNAME_MAX, BIO_MAX, BIO_LINES, FAVORITE_GEAR_MAX, FAVORITE_BEANS_MAX,
} from '../models.js';
import { esc, setTitle, toast, showMessage, showErrors, avatarHtml } from './ui.js';

const dateFmt = new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'numeric', day: 'numeric' });
const NOT_FOUND = `<div class="empty"><p>找不到這個用戶</p><a class="btn" href="#/social">回社群</a></div>`;

export async function render(container, { params: [userId], isCurrent }) {
  setTitle('個人檔案');
  const rerender = () => render(container, { params: [userId], isCurrent });
  if (!navigator.onLine) return showMessage(container, '需要網路才能看個人檔案', rerender);

  container.innerHTML = '<p class="hint">載入中…</p>';
  let state;
  let result;
  try {
    state = await getSocialState();
    if (state.status === 'ready') result = await getUserProfile(state.user.id, userId);
  } catch (err) {
    if (isCurrent()) showMessage(container, socialErrorMessage(err), rerender);
    return;
  }
  if (!isCurrent()) return;

  if (state.status === 'unavailable') return showMessage(container, '這個網址沒有開放社群功能');
  if (state.status !== 'ready') {
    container.innerHTML = '<div class="empty"><p>要先登入才能看個人檔案</p><a class="btn btn-primary" href="#/account">前往帳號</a></div>';
    return;
  }
  if (result.status === 'not-found') {
    container.innerHTML = NOT_FOUND;
    return;
  }
  if (result.status === 'not-friend') {
    setTitle(result.nickname);
    container.innerHTML = `<div id="profile-page">
      <section class="section profile-card">
        <div class="profile-head">
          ${avatarHtml({ nickname: result.nickname }, { large: true })}
          <div class="profile-text"><div class="profile-name">${esc(result.nickname)}</div></div>
        </div>
        <p class="hint">你們還不是好友，成為好友後才看得到對方的個人檔案和紀錄。</p>
      </section>
      <a class="btn btn-block" href="#/social">回社群</a>
    </div>`;
    return;
  }
  renderFull(container, result.profile, { user: state.user, rerender });
}

/** 一個欄位：有填才顯示 */
const infoRow = (label, value) => (value ? `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>` : '');

function renderFull(container, p, { user, rerender }) {
  setTitle(p.mine ? '我的個人檔案' : p.nickname);
  const info = infoRow('常用器材', p.favoriteGear) + infoRow('喜歡的豆子', p.favoriteBeans);
  const empty = !info && !p.bio;
  container.innerHTML = `<div id="profile-page">
    <section class="section profile-card">
      <div class="profile-head">
        ${avatarHtml(p, { large: true })}
        <div class="profile-text">
          <div class="profile-name">${esc(p.nickname)}</div>
          <div class="hint">貼文 ${Number(p.posts)}・${esc(dateFmt.format(new Date(p.joinedAt)))} 加入</div>
        </div>
      </div>
      ${info ? `<dl class="detail-list profile-info">${info}</dl>` : ''}
      ${p.bio ? `<p class="profile-bio">${esc(p.bio)}</p>` : ''}
      ${empty ? `<p class="hint">${p.mine ? '還沒有填寫自我介紹、常用器材和喜歡的豆子。' : '還沒有填寫自我介紹。'}</p>` : ''}
      ${p.mine ? '<button type="button" class="btn btn-block" data-action="edit">編輯個人檔案</button>' : ''}
    </section>
    ${p.mine ? editFormHtml(p) : ''}
    <a class="btn btn-block" href="#/social">回社群</a>
  </div>`;
  if (p.mine) bindEdit(container.querySelector('#profile-page'), p, { user, rerender });
}

/** 輸入框（含字數提示「n／上限」） */
function fieldHtml({ name, label, value, max, multiline = false, hint = '' }) {
  const input = multiline
    ? `<textarea id="profile-${name}" name="${name}" rows="${BIO_LINES}" maxlength="${max}">${esc(value)}</textarea>`
    : `<input id="profile-${name}" name="${name}" value="${esc(value)}" maxlength="${max}" autocomplete="off">`;
  return `<div class="field" data-field="${name}">
    <label for="profile-${name}">${esc(label)}</label>
    ${input}
    <div class="field-foot"><span class="hint">${esc(hint)}</span><span class="hint field-count" data-count="${name}" data-max="${max}"></span></div>
    <div class="error"></div>
  </div>`;
}

function editFormHtml(p) {
  return `<form class="section form" id="profile-form" novalidate hidden>
    <h2>編輯個人檔案</h2>
    <div class="photo-actions">
      <label class="btn" for="profile-avatar">${p.hasAvatar ? '更換頭像' : '設定頭像'}</label>
      ${p.hasAvatar ? '<button type="button" class="btn" data-action="remove-avatar">移除頭像</button>' : ''}
    </div>
    <input type="file" id="profile-avatar" accept="${PHOTO_ACCEPT}" hidden>
    ${fieldHtml({ name: 'nickname', label: '暱稱', value: p.nickname, max: NICKNAME_MAX })}
    ${fieldHtml({ name: 'bio', label: '自我介紹', value: p.bio, max: BIO_MAX, multiline: true, hint: `最多 ${BIO_LINES} 行` })}
    ${fieldHtml({ name: 'favoriteGear', label: '常用器材', value: p.favoriteGear, max: FAVORITE_GEAR_MAX, hint: '例如 V60 / C40' })}
    ${fieldHtml({ name: 'favoriteBeans', label: '喜歡的豆子', value: p.favoriteBeans, max: FAVORITE_BEANS_MAX, hint: '例如 衣索比亞水洗、肯亞' })}
    <p class="hint">這些內容只有你的好友看得到。</p>
    <div class="photo-actions">
      <button class="btn btn-primary" type="submit">儲存</button>
      <button class="btn" type="button" data-action="cancel">取消</button>
    </div>
  </form>`;
}

function bindEdit(page, p, { user, rerender }) {
  const form = page.querySelector('#profile-form');
  const editBtn = page.querySelector('[data-action="edit"]');
  const setOpen = (open) => {
    form.hidden = !open;
    editBtn.hidden = open;
    if (open) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  editBtn.addEventListener('click', () => setOpen(true));
  form.querySelector('[data-action="cancel"]').addEventListener('click', () => {
    form.reset();
    updateCounts();
    showErrors(form, {});
    setOpen(false);
  });

  // 字數：以字元計（和資料庫的 char_length 一樣），接近上限變色
  const updateCounts = () => {
    for (const el of form.querySelectorAll('[data-count]')) {
      const n = [...form[el.dataset.count].value].length;
      const max = Number(el.dataset.max);
      el.textContent = `${n}／${max}`;
      el.classList.toggle('near', n >= max * 0.9);
    }
  };
  form.addEventListener('input', updateCounts);
  updateCounts();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const result = await saveProfile(user.id, {
        nickname: form.nickname.value, bio: form.bio.value,
        favoriteGear: form.favoriteGear.value, favoriteBeans: form.favoriteBeans.value,
      });
      if (!result.ok) return showErrors(form, result.errors);
      toast('已儲存個人檔案');
      rerender();
    } catch (err) {
      toast(socialErrorMessage(err));
    } finally {
      submit.disabled = false;
    }
  });

  // 頭像：和帳號頁一樣，重新壓縮、移除 EXIF 後才上傳
  const avatarInput = form.querySelector('#profile-avatar');
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
  form.querySelector('[data-action="remove-avatar"]')?.addEventListener('click', async () => {
    if (!confirm('確定移除頭像？')) return;
    try {
      await removeAvatar(p.id);
      toast('已移除頭像');
      rerender();
    } catch (err) {
      toast(socialErrorMessage(err));
    }
  });
}
