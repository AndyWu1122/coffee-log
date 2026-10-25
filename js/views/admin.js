// #/admin 開發者後台（☰ 選單，只有開發者看得到入口）
//   #/admin?tab=reports|posts|users|feedback|log  列表（預設檢舉）
//   #/admin/user/<id>                              用戶詳細：他所有雲端貼文和留言、刪除帳號
//   #/admin/post/<owner>/<id>                      貼文詳細：內容、檢舉、全部留言、刪除
// 權限一律由資料庫與 Edge Function 檢查，這頁只是畫面：不是開發者時伺服器什麼都不給，這裡顯示「沒有權限」
// 這頁的內容全部來自使用者：文字、網址一律經過 esc() 才放進 innerHTML
// 刪除：填原因（必填）→ confirm → 送出；每次操作都會寫進操作紀錄
import {
  isAdmin, adminErrorMessage, validateAdminReason, ADMIN_REASON_MAX,
  adminListUsers, adminUserDetail, adminListPosts, adminPostDetail, adminListReports, adminListFeedback, adminListAudit,
  adminDeleteComment, adminDeletePost, adminDeleteUser, formatRatio, formatSeconds, flavorNote,
} from '../models.js';
import { esc, setTitle, toast, avatarHtml, showMessage } from './ui.js';
import { formatDate, stars } from './feed.js';

const TABS = [
  { value: 'reports', label: '檢舉' },
  { value: 'posts', label: '貼文' },
  { value: 'users', label: '用戶' },
  { value: 'feedback', label: '回饋' },
  { value: 'log', label: '紀錄' },
];
const dateOnly = new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'numeric', day: 'numeric' });
const formatDay = (iso) => dateOnly.format(new Date(iso));
const userHref = (id) => `#/admin/user/${encodeURIComponent(id)}`;
const postHref = (owner, id) => `#/admin/post/${encodeURIComponent(owner)}/${encodeURIComponent(id)}`;

export async function render(container, { params = [], query = {}, isCurrent }) {
  setTitle('開發者後台');
  const rerender = () => render(container, { params, query, isCurrent });
  if (!navigator.onLine) return showMessage(container, '需要網路才能使用開發者後台', rerender);

  container.innerHTML = '<p class="hint">載入中…</p>';
  if (!(await isAdmin())) {
    if (isCurrent()) showMessage(container, '沒有權限：只有開發者可以使用這一頁');
    return;
  }
  if (!isCurrent()) return;

  try {
    if (params.length === 2) await renderPost(container, params[0], params[1], { rerender, isCurrent });
    else if (params.length === 1) await renderUser(container, params[0], { rerender, isCurrent });
    else await renderTab(container, TABS.some((t) => t.value === query.tab) ? query.tab : 'reports', { isCurrent });
  } catch (err) {
    if (isCurrent()) showMessage(container, adminErrorMessage(err), rerender);
  }
}

/* ===== 列表 ===== */

const LISTS = {
  reports: { load: adminListReports, row: reportHtml, empty: '沒有檢舉' },
  posts: { load: adminListPosts, row: postHtml, empty: '還沒有任何貼文' },
  users: { load: adminListUsers, row: userHtml, empty: '找不到用戶' },
  feedback: { load: adminListFeedback, row: feedbackHtml, empty: '沒有意見回饋' },
  log: { load: adminListAudit, row: auditHtml, empty: '還沒有任何操作' },
};

async function renderTab(container, tab, { isCurrent }) {
  const list = LISTS[tab];
  let search = '';
  let offset = 0;
  const first = await list.load({ offset: 0, search });
  if (!isCurrent()) return;

  container.innerHTML = `<div id="admin-page" class="admin">
    <nav class="admin-tabs" aria-label="後台分類">
      ${TABS.map((t) => `<a href="#/admin?tab=${t.value}"${t.value === tab ? ' aria-current="page"' : ''}>${t.label}</a>`).join('')}
    </nav>
    ${tab === 'users' ? `<form class="admin-search" id="user-search" role="search">
      <input type="search" name="q" placeholder="搜尋暱稱" aria-label="搜尋暱稱" maxlength="20" autocomplete="off">
      <button type="submit" class="btn">搜尋</button>
    </form>` : ''}
    <ul class="list admin-list" id="admin-list"></ul>
    <p class="hint" id="admin-empty" hidden>${list.empty}</p>
    <button type="button" class="btn btn-block" data-action="more" hidden>載入更多</button>
  </div>`;
  const page = container.querySelector('#admin-page');
  const ul = page.querySelector('#admin-list');
  const more = page.querySelector('[data-action="more"]');
  const show = ({ items, hasMore }) => {
    ul.insertAdjacentHTML('beforeend', items.map(list.row).join(''));
    offset += items.length;
    more.hidden = !hasMore;
    page.querySelector('#admin-empty').hidden = ul.children.length > 0;
  };
  show(first);

  more.addEventListener('click', async () => {
    more.disabled = true;
    try {
      show(await list.load({ offset, search }));
    } catch (err) {
      toast(adminErrorMessage(err));
    } finally {
      more.disabled = false;
    }
  });
  page.querySelector('#user-search')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    search = e.target.q.value;
    offset = 0;
    try {
      const result = await list.load({ offset: 0, search });
      ul.innerHTML = '';
      show(result);
    } catch (err) {
      toast(adminErrorMessage(err));
    }
  });
}

function userHtml(u) {
  return `<li class="person admin-row">
    <a class="person-head" href="${esc(userHref(u.id))}">
      ${avatarHtml(u)}
      <div class="person-text">
        <div class="person-name">${esc(u.nickname)}${u.isAdmin ? ' <span class="me-tag">開發者</span>' : ''}</div>
        <div class="hint">${esc(formatDay(u.createdAt))} 加入・貼文 ${u.posts}・留言 ${u.comments}・被檢舉 ${u.reports}</div>
      </div>
    </a>
  </li>`;
}

/** 一篇貼文；detail 為 true 時（貼文詳細頁）不再連到自己 */
function postHtml(item, { detail = false } = {}) {
  const params = [
    item.dripper,
    [item.grinderName, item.grindSetting].filter(Boolean).join(' '),
    `${item.coffeeG}g → ${item.waterG}g`,
    formatRatio(item.ratio),
    item.tempC != null ? `${item.tempC}°C` : '',
    item.totalTimeS != null ? formatSeconds(item.totalTimeS) : '',
  ].filter(Boolean);
  const notes = item.flavorNotes.map(flavorNote).filter(Boolean).map((n) => n.zh);
  return `<li class="feed-card admin-post" data-owner="${esc(item.owner)}" data-id="${esc(item.id)}">
    <div class="feed-head">
      ${avatarHtml(item)}
      <div class="person-text">
        <a class="person-name" href="${esc(userHref(item.owner))}">${esc(item.nickname)}</a>
        <div class="hint">${esc(formatDate(item.brewedAt))}</div>
      </div>
    </div>
    <div class="feed-body">
      <div class="card-head">
        <span class="card-title">${esc(item.beanName)}</span>
        <span class="stars" aria-label="評分 ${esc(item.rating ?? '未評')}">${stars(item.rating)}</span>
      </div>
      <div class="card-row">${params.map((p) => `<span>${esc(p)}</span>`).join('')}</div>
      ${notes.length ? `<div class="hint">${esc(notes.join('、'))}</div>` : ''}
      ${item.notes ? `<p class="admin-text">${esc(item.notes)}</p>` : ''}
      ${item.photoUrl ? `<img class="feed-photo" src="${esc(item.photoUrl)}" alt="這杯咖啡的照片" loading="lazy" decoding="async">` : ''}
    </div>
    <div class="feed-foot admin-counts">
      <span>讚 ${item.likeCount}</span><span>留言 ${item.commentCount}</span>
      <span${item.reportCount ? ' class="is-reported"' : ''}>檢舉 ${item.reportCount}</span>
      ${detail ? '' : `<a href="${esc(postHref(item.owner, item.id))}">查看留言</a>`}
    </div>
  </li>`;
}

function reportHtml(r) {
  return `<li class="admin-row">
    <a class="admin-link" href="${esc(postHref(r.brew_owner, r.brew_id))}">
      <div><strong>${esc(r.reasonLabel)}</strong>・${esc(r.owner_nickname ?? '（不明）')} 的「${esc(r.bean_name ?? '')}」</div>
      ${r.detail ? `<p class="admin-text">${esc(r.detail)}</p>` : ''}
      <div class="hint">${esc(formatDate(r.created_at))}・檢舉人 ${esc(r.reporter_nickname ?? '（不明）')}</div>
    </a>
  </li>`;
}

function feedbackHtml(f) {
  return `<li class="admin-row">
    <div><strong>${esc(f.categoryLabel)}</strong>・版本 ${esc(f.app_version ?? '不明')}</div>
    <p class="admin-text">${esc(f.message)}</p>
    <div class="hint">${esc(formatDate(f.created_at))}・<a href="${esc(userHref(f.author))}">${esc(f.nickname ?? '（不明）')}</a></div>
  </li>`;
}

function auditHtml(l) {
  const detail = Object.entries(l.detail ?? {}).map(([k, v]) => `${k}: ${v}`).join('、');
  return `<li class="admin-row">
    <div><strong>${esc(l.actionLabel)}</strong>・對象 ${esc(l.target_nickname || '（不明）')}</div>
    <p class="admin-text">原因：${esc(l.reason)}</p>
    <div class="hint">${esc(formatDate(l.created_at))}・${esc(l.actor_nickname ?? '（已刪除的開發者）')}${detail ? `・${esc(detail)}` : ''}</div>
  </li>`;
}

/* ===== 留言 ===== */

function commentHtml(c, { showPost = false } = {}) {
  return `<li class="admin-comment${c.parentId ? ' is-reply' : ''}" data-comment="${esc(c.id)}">
    <div class="feed-head">
      ${avatarHtml(c)}
      <div class="person-text">
        <a class="person-name" href="${esc(userHref(c.author))}">${esc(c.nickname)}</a>
        <div class="hint">${esc(formatDate(c.createdAt))}${!c.parentId && c.replies ? `・回覆 ${c.replies} 則` : ''}</div>
      </div>
    </div>
    <p class="admin-text">${c.replyToNickname ? `<span class="mention">@${esc(c.replyToNickname)}</span> ` : ''}${esc(c.body)}</p>
    <div class="admin-actions">
      ${showPost ? `<a href="${esc(postHref(c.owner, c.brewId))}">看貼文</a>` : ''}
      <button type="button" class="btn btn-danger" data-action="delete-comment">刪除留言</button>
    </div>
  </li>`;
}

/** 主留言舊→新，回覆接在各自的主留言後面 */
function threadOrder(comments) {
  const replies = (id) => comments.filter((c) => c.parentId === id);
  return comments.filter((c) => !c.parentId).flatMap((c) => [c, ...replies(c.id)]);
}

/* ===== 刪除：填原因 → confirm → 送出 ===== */

/** 在 anchor 後面顯示填原因的表單；送出且確認後回傳原因，取消回傳 null */
function askReason(anchor, confirmText) {
  anchor.closest('.admin')?.querySelector('.admin-reason')?.remove(); // 一次只開一個
  anchor.insertAdjacentHTML('afterend', `<form class="admin-reason form" novalidate>
    <div class="field" data-field="reason">
      <label>刪除原因（必填，會寫進操作紀錄）</label>
      <textarea name="reason" rows="2" maxlength="${ADMIN_REASON_MAX + 50}"></textarea>
      <div class="error"></div>
    </div>
    <div class="admin-actions">
      <button type="submit" class="btn btn-danger">確定刪除</button>
      <button type="button" class="btn" data-action="cancel">取消</button>
    </div>
  </form>`);
  const form = anchor.nextElementSibling;
  form.reason.focus();
  return new Promise((resolve) => {
    form.querySelector('[data-action="cancel"]').addEventListener('click', () => {
      form.remove();
      resolve(null);
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const error = validateAdminReason(form.reason.value);
      form.querySelector('.error').textContent = error;
      if (error || !confirm(confirmText)) return;
      const reason = form.reason.value;
      form.querySelector('[type="submit"]').disabled = true;
      resolve({ reason, done: () => form.remove(), fail: () => { form.querySelector('[type="submit"]').disabled = false; } });
    });
  });
}

async function runDelete(anchor, confirmText, action, onDone) {
  const answer = await askReason(anchor, confirmText);
  if (!answer) return;
  try {
    await action(answer.reason);
    answer.done();
    toast('已刪除');
    onDone();
  } catch (err) {
    answer.fail();
    toast(adminErrorMessage(err));
  }
}

/** 刪除留言的按鈕（用戶詳細頁、貼文詳細頁共用） */
function bindCommentDeletes(page, comments, onDone) {
  page.addEventListener('click', (e) => {
    const button = e.target.closest('[data-action="delete-comment"]');
    if (!button) return;
    const c = comments.find((x) => x.id === button.closest('[data-comment]').dataset.comment);
    const replies = !c.parentId && c.replies ? `\n底下的 ${c.replies} 則回覆也會一起刪除。` : '';
    runDelete(button.parentElement, `確定刪除「${c.nickname}」的這則留言？${replies}`, (reason) => adminDeleteComment(c.id, reason), onDone);
  });
}

/* ===== 用戶詳細 ===== */

async function renderUser(container, uid, { rerender, isCurrent }) {
  const data = await adminUserDetail(uid);
  if (!isCurrent()) return;
  if (!data) return showMessage(container, '找不到這個用戶，可能已經被刪除了');
  const { profile: p, posts, comments } = data;
  setTitle(`用戶：${p.nickname}`);
  container.innerHTML = `<div id="admin-page" class="admin">
    <a href="#/admin?tab=users">← 用戶列表</a>
    <section class="section admin-profile">
      <div class="feed-head">
        ${avatarHtml(p, { large: true })}
        <div class="person-text">
          <div class="person-name">${esc(p.nickname)}${p.isAdmin ? ' <span class="me-tag">開發者</span>' : ''}</div>
          <div class="hint">${esc(formatDay(p.createdAt))} 加入・貼文 ${posts.length}・留言 ${comments.length}・被檢舉 ${p.reports}</div>
        </div>
      </div>
      ${p.isAdmin ? '<p class="hint">開發者的帳號不能從後台刪除。</p>'
        : '<div class="admin-actions"><button type="button" class="btn btn-danger" data-action="delete-user">刪除這個帳號</button></div>'}
    </section>
    <section class="section">
      <h2>貼文（${posts.length}）</h2>
      ${posts.length ? `<ul class="list feed-list">${posts.map((item) => postHtml(item)).join('')}</ul>` : '<p class="hint">沒有雲端貼文</p>'}
    </section>
    <section class="section">
      <h2>留言（${comments.length}）</h2>
      ${comments.length ? `<ul class="list admin-comments">${comments.map((c) => commentHtml(c, { showPost: true })).join('')}</ul>`
        : '<p class="hint">沒有留言</p>'}
    </section>
  </div>`;
  const page = container.querySelector('#admin-page');
  bindCommentDeletes(page, comments, rerender);
  page.querySelector('[data-action="delete-user"]')?.addEventListener('click', (e) => {
    runDelete(e.target.parentElement,
      `確定刪除「${p.nickname}」的帳號？\n他所有的雲端貼文、照片、留言、讚、好友關係都會刪除，無法復原。`,
      (reason) => adminDeleteUser(p.id, reason),
      () => { location.hash = '#/admin?tab=users'; });
  });
}

/* ===== 貼文詳細 ===== */

async function renderPost(container, owner, id, { rerender, isCurrent }) {
  const data = await adminPostDetail(owner, id);
  if (!isCurrent()) return;
  if (!data) return showMessage(container, '找不到這篇貼文，可能已經被刪除或改回只有我');
  const { post, comments, reports } = data;
  container.innerHTML = `<div id="admin-page" class="admin">
    <a href="#/admin?tab=posts">← 全部貼文</a>
    <ul class="list feed-list">${postHtml(post, { detail: true })}</ul>
    <div class="admin-actions"><button type="button" class="btn btn-danger" data-action="delete-post">刪除這篇貼文</button></div>
    ${reports.length ? `<section class="section">
      <h2>檢舉（${reports.length}）</h2>
      <ul class="list">${reports.map((r) => `<li class="admin-row">
        <div><strong>${esc(r.reasonLabel)}</strong></div>
        ${r.detail ? `<p class="admin-text">${esc(r.detail)}</p>` : ''}
        <div class="hint">${esc(formatDate(r.created_at))}・檢舉人 ${esc(r.reporter_nickname ?? '（不明）')}</div>
      </li>`).join('')}</ul>
    </section>` : ''}
    <section class="section">
      <h2>留言（${comments.length}）</h2>
      ${comments.length ? `<ul class="list admin-comments">${threadOrder(comments).map((c) => commentHtml(c)).join('')}</ul>`
        : '<p class="hint">沒有留言</p>'}
    </section>
  </div>`;
  const page = container.querySelector('#admin-page');
  bindCommentDeletes(page, comments, rerender);
  page.querySelector('[data-action="delete-post"]').addEventListener('click', (e) => {
    runDelete(e.target.parentElement,
      `確定刪除「${post.nickname}」的這篇貼文？\n照片、${comments.length} 則留言和讚都會刪除，作者也不能再分享這一筆。`,
      (reason) => adminDeletePost(post.owner, post.id, reason),
      () => { location.hash = '#/admin?tab=posts'; });
  });
}
