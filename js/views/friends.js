// #/friends 好友（從右上角 ☰ 選單進入）：用代碼加好友、收到／送出的邀請、好友名單、封鎖名單
// #/friends/add?code=XXX：QR code 連到這裡，代碼已填好，按「送出邀請」才會送出
// 他人的暱稱一律經過 esc() 才放進畫面
import {
  getSocialState, socialErrorMessage, listFriends, sendFriendRequest, normalizeFriendCode, formatFriendCode,
  acceptFriend, removeFriendship, blockUser, unblockUser, toLocalDateStr,
} from '../models.js';
import { esc, setTitle, toast, showErrors, avatarHtml, showMessage, copyText } from './ui.js';

export async function render(container, { query, isCurrent }) {
  setTitle('好友');
  const code = normalizeFriendCode(query.code ?? '');
  const rerender = () => render(container, { query, isCurrent });
  if (!navigator.onLine) return showMessage(container, '社群功能需要網路連線', rerender);

  container.innerHTML = '<p class="hint">載入中…</p>';
  let state;
  let lists;
  try {
    state = await getSocialState();
    if (state.status === 'ready') lists = await listFriends(state.user.id);
  } catch (err) {
    if (isCurrent()) showMessage(container, socialErrorMessage(err), rerender);
    return;
  }
  if (!isCurrent()) return;

  if (state.status === 'unavailable') return showMessage(container, '這個網址沒有開放社群功能');
  if (state.status !== 'ready') return renderNotReady(container, state, code);
  renderReady(container, state, lists, { code, rerender });
}

/* ===== 還沒登入或還沒設定暱稱 ===== */
// 用手機相機掃 QR code 時，iPhone 會用 Safari 開，而 Safari 和主畫面的 App 登入狀態是分開的：
// 顯示代碼讓使用者複製，回到 App 貼上

function renderNotReady(container, state, code) {
  const action = state.status === 'signed-out' ? '登入' : '設定暱稱';
  container.innerHTML = `
    ${code ? `
      <section class="section">
        <h2>好友邀請</h2>
        <div class="friend-code">${esc(formatFriendCode(code))}</div>
        <button type="button" class="btn btn-block" data-action="copy">複製代碼</button>
        <p class="hint">如果你平常是從 iPhone 主畫面的「手沖紀錄」使用，請複製代碼後回到那個 App，
          在 ☰ →「好友」貼上（主畫面的 App 和 Safari 的登入狀態是分開的）。</p>
      </section>` : ''}
    <div class="empty">
      <p>要先${action}才能加好友</p>
      <a class="btn btn-primary" href="#/account">前往${action}</a>
    </div>`;
  container.querySelector('[data-action="copy"]')?.addEventListener('click', () => copyText(code, '已複製好友代碼'));
}

/* ===== 可以使用 ===== */

const dateOf = (iso) => (iso ? toLocalDateStr(new Date(iso)) : '');

function personHtml(p, meta, buttons) {
  return `
    <li class="person" data-id="${esc(p.id)}" data-name="${esc(p.nickname)}">
      <div class="person-head">
        ${avatarHtml(p)}
        <div class="person-text">
          <div class="person-name">${esc(p.nickname)}</div>
          ${meta ? `<div class="hint">${esc(meta)}</div>` : ''}
        </div>
      </div>
      <div class="person-actions">${buttons}</div>
    </li>`;
}
const btn = (action, label, cls = '') => `<button type="button" class="btn ${cls}" data-action="${action}">${label}</button>`;

function sectionHtml(id, title, people, emptyText, row) {
  if (!people.length && !emptyText) return '';
  return `
    <section class="section" id="${id}">
      <h2>${title}${people.length ? `（${people.length}）` : ''}</h2>
      ${people.length ? `<ul class="list people">${people.map(row).join('')}</ul>` : `<p class="hint">${emptyText}</p>`}
    </section>`;
}

function renderReady(container, { user }, lists, { code, rerender }) {
  const { incoming, outgoing, friends, blocked } = lists;
  container.innerHTML = `<div id="friends-page">
    <form class="section form" id="add-form" novalidate>
      <h2>加好友</h2>
      <div class="field" data-field="code">
        <label for="code">好友代碼</label>
        <input id="code" name="code" value="${esc(code ? formatFriendCode(code) : '')}" placeholder="例如 ABCDE FGHJK"
          autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text">
        <div class="error"></div>
      </div>
      <button class="btn btn-primary btn-block" type="submit">送出邀請</button>
      <p class="hint">我的好友代碼和 QR code 在 <a href="#/account">帳號</a>。</p>
    </form>
    ${sectionHtml('incoming', '收到的邀請', incoming, '', (p) => personHtml(p, `${dateOf(p.since)} 邀請你`,
      btn('accept', '接受', 'btn-primary') + btn('reject', '拒絕') + btn('block', '封鎖', 'btn-danger')))}
    ${sectionHtml('friends', '好友', friends, '還沒有好友。把你的好友代碼給朋友，或輸入朋友的代碼。', (p) =>
      personHtml(p, p.since ? `${dateOf(p.since)} 成為好友` : '', btn('unfriend', '解除好友') + btn('block', '封鎖', 'btn-danger')))}
    ${sectionHtml('outgoing', '送出的邀請', outgoing, '', (p) => personHtml(p, `${dateOf(p.since)} 送出，等對方接受`,
      btn('cancel', '取消邀請')))}
    ${sectionHtml('blocked', '封鎖名單', blocked, '', (p) => personHtml(p, `${dateOf(p.since)} 封鎖`,
      btn('unblock', '解除封鎖')))}
  </div>`;

  const form = container.querySelector('#add-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const result = await sendFriendRequest(form.code.value);
      if (!result.ok) return showErrors(form, { code: result.message });
      toast(result.message);
      if (code) location.replace('#/friends'); // 從 QR code 進來的：送出後回到一般的好友頁
      else rerender();
    } catch (err) {
      showErrors(form, { code: socialErrorMessage(err) });
    } finally {
      submit.disabled = false;
    }
  });

  // 名單上的按鈕：data-name 是對方的暱稱（confirm 只顯示純文字）
  const ACTIONS = {
    accept: { run: (id) => acceptFriend(user.id, id), done: '已成為好友' },
    reject: { run: (id) => removeFriendship(user.id, id), done: '已拒絕邀請' },
    cancel: { run: (id) => removeFriendship(user.id, id), done: '已取消邀請' },
    unfriend: {
      ask: (name) => `確定和「${name}」解除好友？之後要重新邀請才能再成為好友。`,
      run: (id) => removeFriendship(user.id, id), done: '已解除好友',
    },
    block: {
      ask: (name) => `確定封鎖「${name}」？會同時解除好友和邀請，對方不會收到通知，也無法再邀請你。`,
      run: (id) => blockUser(id), done: '已封鎖',
    },
    unblock: { run: (id) => unblockUser(id), done: '已解除封鎖（不會自動恢復好友）' },
  };
  // 監聽頁面自己的元素（#app 換頁時不會被換掉，掛在上面會一直累積）
  container.querySelector('#friends-page').addEventListener('click', async (e) => {
    const button = e.target.closest('.person [data-action]');
    if (!button) return;
    const action = ACTIONS[button.dataset.action];
    const { id, name } = button.closest('.person').dataset;
    if (action.ask && !confirm(action.ask(name))) return;
    button.disabled = true;
    try {
      await action.run(id);
      toast(action.done);
    } catch (err) {
      toast(err.code === undefined ? err.message : socialErrorMessage(err));
    }
    rerender();
  });
}
