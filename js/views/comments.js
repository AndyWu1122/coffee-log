// 紀錄詳細頁（#/social/<owner>/<id>）下方的留言區：主留言舊→新，回覆縮排在主留言下
// - 回覆別人的回覆也放在同一則主留言下，開頭顯示「@暱稱」
// - 回覆超過 3 則時先收起，顯示「查看其他 N 則回覆」
// - 送出：按鈕停用、先顯示（傳送中），失敗就移除並把文字放回輸入框；刪除前確認
// 暱稱、留言都來自他人：一律經過 esc() 才放進 innerHTML
import {
  listComments, addComment, deleteComment, validateComment, commentErrorMessage, socialErrorMessage,
  formatRelative, COMMENT_MAX,
} from '../models.js';
import { esc, toast, avatarHtml, profileHref } from './ui.js';

const REPLIES_SHOWN = 3;   // 每則主留言先顯示幾則回覆
const NEAR_LIMIT = 270;    // 剩不到 30 字時字數變色提示

/**
 * 在 root（這一頁自己的元素）裡畫出留言區並綁定事件
 * me：自己的 profile（送出時先顯示用）；item：這筆紀錄（owner、id）
 * scrollTo：畫好後捲到留言區（從卡片上的留言數點進來）
 */
export async function renderComments(root, { myId, me, item, isCurrent, scrollTo = false }) {
  root.innerHTML = `
    <section class="section comments" id="comments" aria-labelledby="comments-title">
      <h2 id="comments-title">留言 <span class="hint" id="comment-count"></span></h2>
      <p class="hint" id="comments-status">載入留言中…</p>
      <ul class="comment-list" id="comment-list"></ul>
      <form class="comment-form" id="comment-form" novalidate>
        <div class="comment-target" id="comment-target" hidden>
          <span id="comment-target-text"></span>
          <button type="button" class="link-btn" data-action="cancel-reply" aria-label="取消回覆">✕</button>
        </div>
        <div class="field" data-field="body">
          <textarea id="comment-body" name="body" rows="2" maxlength="${COMMENT_MAX}"
            placeholder="留言…（最多 ${COMMENT_MAX} 字）" aria-label="留言"></textarea>
          <div class="comment-form-foot">
            <span class="hint comment-length" id="comment-length" aria-live="polite">0／${COMMENT_MAX}</span>
            <button class="btn btn-primary" type="submit">送出</button>
          </div>
          <div class="error"></div>
        </div>
      </form>
    </section>`;

  const section = root.querySelector('#comments');
  const list = section.querySelector('#comment-list');
  const status = section.querySelector('#comments-status');
  const countEl = section.querySelector('#comment-count');
  const form = section.querySelector('#comment-form');
  const input = form.querySelector('#comment-body');
  const lengthEl = form.querySelector('#comment-length');
  const submitBtn = form.querySelector('[type="submit"]');
  const errorEl = form.querySelector('.error');
  const targetEl = form.querySelector('#comment-target');
  const targetText = form.querySelector('#comment-target-text');

  const comments = new Map(); // id → 留言（含主留言，主留言另有 replies）
  let count = 0;
  let replyTo = null;         // 正在回覆的留言
  let pendingId = 0;

  const setCount = (n) => {
    count = n;
    countEl.textContent = n ? `${n} 則` : '';
    status.hidden = n > 0;
    status.textContent = '還沒有留言';
  };

  try {
    const { threads, count: total } = await listComments(myId, item.owner, item.id);
    if (!isCurrent()) return;
    for (const t of threads) {
      comments.set(t.id, t);
      for (const r of t.replies) comments.set(r.id, r);
    }
    list.innerHTML = threads.map((t) => threadHtml(t)).join('');
    setCount(total);
  } catch (err) {
    if (!isCurrent()) return;
    status.textContent = socialErrorMessage(err);
  }
  if (scrollTo) section.scrollIntoView({ block: 'start' });

  /* ----- 字數 ----- */
  const updateLength = () => {
    const n = [...input.value.trim()].length;
    lengthEl.textContent = `${n}／${COMMENT_MAX}`;
    lengthEl.classList.toggle('near', n >= NEAR_LIMIT && n <= COMMENT_MAX);
    lengthEl.classList.toggle('over', n > COMMENT_MAX);
    form.querySelector('[data-field="body"]').classList.toggle('invalid', n > COMMENT_MAX);
    errorEl.textContent = n > COMMENT_MAX ? `最多 ${COMMENT_MAX} 字` : '';
  };
  input.addEventListener('input', updateLength);

  /* ----- 回覆對象 ----- */
  const setReplyTo = (c) => {
    replyTo = c;
    targetEl.hidden = !c;
    targetText.textContent = c ? `回覆 ${c.nickname}` : '';
    if (c) input.focus();
  };

  section.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn || !section.contains(btn)) return;
    const action = btn.dataset.action;
    if (action === 'cancel-reply') return setReplyTo(null);

    const thread = btn.closest('.comment-thread');
    if (action === 'expand') {
      expand(thread);
      return;
    }
    const comment = comments.get(btn.closest('.comment')?.dataset.id);
    if (!comment) return;
    if (action === 'reply') setReplyTo(comment);
    if (action === 'delete') await remove(comment, btn);
  });

  /* ----- 送出：先顯示，失敗改回 ----- */
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = input.value;
    const error = validateComment(body);
    if (error) {
      errorEl.textContent = error;
      form.querySelector('[data-field="body"]').classList.add('invalid');
      return;
    }
    const target = replyTo;
    const parentId = target ? (target.parentId ?? target.id) : null;
    const pending = {
      id: `pending-${++pendingId}`, parentId, author: myId, nickname: me.nickname, avatarUrl: me.avatarUrl,
      replyToNickname: target?.parentId && target.author !== myId ? target.nickname : null,
      body: body.trim(), createdAt: new Date().toISOString(), mine: true, canDelete: false, pending: true,
    };
    const pendingEl = insert(pending);
    input.value = '';
    updateLength();
    setReplyTo(null);
    submitBtn.disabled = true;
    try {
      const result = await addComment(myId, item.owner, item.id, { body, replyTo: target });
      if (!result.ok) throw Object.assign(new Error(result.error), { local: true });
      const c = result.comment;
      if (!c.parentId) c.replies = [];
      comments.set(c.id, c);
      if (isCurrent()) {
        if (c.parentId) pendingEl.outerHTML = commentHtml(c, { tag: 'li' });
        else pendingEl.outerHTML = threadHtml(c);
        setCount(count + 1);
      }
    } catch (err) {
      pendingEl.remove();
      if (!isCurrent()) return;
      // 文字放回輸入框（使用者沒有重新輸入的話）
      if (!input.value) {
        input.value = body;
        setReplyTo(target);
        updateLength();
      }
      const message = err.local ? err.message : commentErrorMessage(err);
      errorEl.textContent = message;
      toast(message);
      status.hidden = count > 0;
    } finally {
      submitBtn.disabled = false;
    }
  });

  /** 先畫在正確的位置：主留言放最後；回覆放在那則主留言的回覆最後（收起的會先展開） */
  function insert(c) {
    status.hidden = true;
    if (!c.parentId) {
      list.insertAdjacentHTML('beforeend', threadHtml({ ...c, replies: [] }));
      return list.lastElementChild;
    }
    const thread = list.querySelector(`.comment-thread[data-id="${CSS.escape(c.parentId)}"]`);
    if (!thread) { // 主留言剛被刪掉：先畫在最後，送出時資料庫會拒絕
      list.insertAdjacentHTML('beforeend', commentHtml(c, { tag: 'li' }));
      return list.lastElementChild;
    }
    expand(thread);
    const replies = thread.querySelector('.comment-replies');
    replies.insertAdjacentHTML('beforeend', commentHtml(c, { tag: 'li' }));
    return replies.lastElementChild;
  }

  function expand(thread) {
    if (!thread) return;
    for (const el of thread.querySelectorAll('.comment-replies > [hidden]')) el.hidden = false;
    thread.querySelector('[data-action="expand"]')?.remove();
  }

  /* ----- 刪除 ----- */
  async function remove(c, btn) {
    // 刪主留言時回覆一起刪（資料庫的外鍵），確認訊息說明會刪掉幾則
    const thread = c.parentId ? null : list.querySelector(`.comment-thread[data-id="${CSS.escape(c.id)}"]`);
    const replies = thread ? thread.querySelectorAll('.comment-replies > .comment').length : 0;
    const message = replies ? `確定刪除這則留言？\n底下的 ${replies} 則回覆也會一起刪除。` : '確定刪除這則留言？';
    if (!confirm(message)) return;
    btn.disabled = true;
    try {
      await deleteComment(c.id);
      if (!isCurrent()) return;
      if (thread) {
        thread.remove();
        setCount(count - 1 - replies);
      } else {
        list.querySelector(`.comment[data-id="${CSS.escape(c.id)}"]`)?.remove();
        setCount(count - 1);
      }
      comments.delete(c.id);
      toast('已刪除');
    } catch (err) {
      btn.disabled = false;
      toast(err instanceof Error && !err.code ? err.message : commentErrorMessage(err));
    }
  }
}

/** 一則主留言和它的回覆；回覆超過 REPLIES_SHOWN 則時，後面的先收起 */
function threadHtml(t) {
  const hiddenCount = Math.max(0, t.replies.length - REPLIES_SHOWN);
  return `
    <li class="comment-thread" data-id="${esc(t.id)}">
      ${commentHtml(t, { tag: 'div' })}
      <ul class="comment-replies">
        ${t.replies.map((r, i) => commentHtml(r, { tag: 'li', hidden: i >= REPLIES_SHOWN })).join('')}
      </ul>
      ${hiddenCount ? `<button type="button" class="link-btn more-replies" data-action="expand">查看其他 ${hiddenCount} 則回覆</button>` : ''}
    </li>`;
}

/** 「@暱稱 」：知道對象是誰就連到他的個人檔案（送出中的回覆還沒有對象 id，只顯示文字） */
function mentionHtml(c) {
  if (!c.replyToNickname) return '';
  const text = `@${esc(c.replyToNickname)}`;
  return c.replyToUser
    ? `<a class="mention hit-area" href="${esc(profileHref(c.replyToUser))}">${text}</a> `
    : `<span class="mention">${text}</span> `;
}

/** 一則留言：頭像、暱稱、相對時間、（@暱稱）內容、回覆／刪除 */
function commentHtml(c, { tag, hidden = false }) {
  return `
    <${tag} class="comment${c.pending ? ' pending' : ''}" data-id="${esc(c.id)}"${hidden ? ' hidden' : ''}>
      <a class="comment-avatar" href="${esc(profileHref(c.author))}" aria-label="${esc(c.nickname)} 的個人檔案">${avatarHtml(c)}</a>
      <div class="comment-main">
        <div class="comment-meta">
          <a class="person-name hit-area" href="${esc(profileHref(c.author))}">${esc(c.nickname)}</a>
          <span class="hint">${c.pending ? '傳送中…' : esc(formatRelative(c.createdAt))}</span>
        </div>
        <p class="comment-body">${mentionHtml(c)}${esc(c.body)}</p>
        ${c.pending ? '' : `
        <div class="comment-actions">
          <button type="button" class="link-btn" data-action="reply">回覆</button>
          ${c.canDelete ? '<button type="button" class="link-btn danger" data-action="delete">刪除</button>' : ''}
        </div>`}
      </div>
    </${tag}>`;
}
