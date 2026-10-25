// #/social 社群（底部分頁「社群」）：自己和好友分享的紀錄，依沖煮時間新→舊；每次 20 筆，按「載入更多」再載
// 上方切換「全部｜我的」（#/social?mine=1 只看自己的）；卡片顯示讚數、留言數，有新留言的留言數會標示
// 這頁的內容大多來自他人：文字、網址一律經過 esc() 才放進 innerHTML
import {
  getSocialState, socialErrorMessage, listFeed, setLike, formatRatio, formatSeconds, flavorNote,
} from '../models.js';
import {
  esc, setTitle, toast, avatarHtml, showMessage, notifyBadgesChanged, segmentedHtml, bindSegmented, profileHref,
} from './ui.js';

const dateFmt = new Intl.DateTimeFormat('zh-TW', {
  month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
});
export const formatDate = (iso) => dateFmt.format(new Date(iso));
export const stars = (rating) => (rating ? '★'.repeat(rating) + '☆'.repeat(5 - rating) : '');
export const detailHref = (item, { comments = false } = {}) =>
  `#/social/${encodeURIComponent(item.owner)}/${encodeURIComponent(item.id)}${comments ? '?comments=1' : ''}`;
const keyOf = (item) => `${item.owner}/${item.id}`;

const FILTERS = [{ value: 'all', label: '全部' }, { value: 'mine', label: '我的' }];

export async function render(container, { query = {}, isCurrent }) {
  setTitle('社群');
  const mine = query.mine === '1';
  const rerender = () => render(container, { query, isCurrent });
  if (!navigator.onLine) return showMessage(container, '需要網路才能看社群', rerender);

  container.innerHTML = '<p class="hint">載入中…</p>';
  let state;
  let page;
  try {
    state = await getSocialState();
    if (state.status === 'ready') page = await listFeed(state.user.id, { mine });
  } catch (err) {
    if (isCurrent()) showMessage(container, socialErrorMessage(err), rerender);
    return;
  }
  if (!isCurrent()) return;
  if (page) notifyBadgesChanged(); // 看過了：「社群」分頁的數字歸零

  if (state.status === 'unavailable') return showMessage(container, '這個網址沒有開放社群功能');
  if (state.status !== 'ready') {
    const action = state.status === 'signed-out' ? '登入' : '設定暱稱';
    container.innerHTML = `
      <div class="empty">
        <p>要先${action}才能看社群</p>
        <a class="btn btn-primary" href="#/account">前往${action}</a>
      </div>`;
    return;
  }

  const myId = state.user.id;
  const items = new Map(page.items.map((item) => [keyOf(item), item]));
  const empty = mine ? `
      <div class="empty">
        <p>你還沒有分享給好友的紀錄</p>
        <p class="hint">在沖煮紀錄的「誰看得到」選「👥 好友」，就會出現在這裡。</p>
      </div>` : `
      <div class="empty">
        <p>還沒有人分享紀錄</p>
        <p class="hint">在沖煮紀錄的「誰看得到」選「👥 好友」，就會分享給好友。</p>
        <a class="btn" href="#/friends">加好友</a>
      </div>`;
  container.innerHTML = `<div id="feed-page">
    <div class="toolbar feed-toolbar">
      ${segmentedHtml('filter', FILTERS, mine ? 'mine' : 'all')}
      <a class="link-btn" href="#/friends">好友管理</a>
    </div>
    ${items.size ? `
      <ul class="list feed" id="feed">${page.items.map((item) => feedCardHtml(item)).join('')}</ul>
      <button type="button" class="btn btn-block" data-action="more" ${page.hasMore ? '' : 'hidden'}>載入更多</button>` : empty}
  </div>`;

  // 綁在這頁自己的元素上：#app 換頁不會被替換，綁在 container 上的監聽器會殘留，
  // 帶著舊的 items 和新的一起處理同一次點擊（舊的按讚、新的收回，互相抵消）
  const pageEl = container.querySelector('#feed-page');
  bindLikes(pageEl, myId, items);
  bindSegmented(pageEl.querySelector('.feed-toolbar'), (name, value) => {
    location.hash = value === 'mine' ? '#/social?mine=1' : '#/social';
  });

  const moreBtn = container.querySelector('[data-action="more"]');
  moreBtn?.addEventListener('click', async () => {
    moreBtn.disabled = true;
    try {
      const next = await listFeed(myId, { offset: items.size, mine });
      if (!isCurrent()) return;
      // 載入期間有人新增紀錄時，同一筆可能出現兩次：已經在畫面上的跳過
      const fresh = next.items.filter((item) => !items.has(keyOf(item)));
      for (const item of fresh) items.set(keyOf(item), item);
      container.querySelector('#feed').insertAdjacentHTML('beforeend', fresh.map((item) => feedCardHtml(item)).join(''));
      moreBtn.hidden = !next.hasMore;
    } catch (err) {
      toast(socialErrorMessage(err));
    } finally {
      moreBtn.disabled = false;
    }
  });
}

/**
 * 一筆紀錄的卡片；detail 為 true 時（詳細頁）不再連到自己、不顯示留言數（下面就是留言）
 * linkPerson 為 false 時（個人檔案頁）頭像和暱稱不連結：就是這個人的頁面
 */
export function feedCardHtml(item, { detail = false, linkPerson = true } = {}) {
  const params = [
    item.dripper,
    [item.grinderName, item.grindSetting].filter(Boolean).join(' '),
    `${item.coffeeG}g → ${item.waterG}g`,
    formatRatio(item.ratio),
    item.tempC != null ? `${item.tempC}°C` : '',
    item.totalTimeS != null ? formatSeconds(item.totalTimeS) : '',
  ].filter(Boolean);
  const body = `
    <div class="card-head">
      <span class="card-title">${esc(item.beanName)}</span>
      <span class="stars" aria-label="評分 ${esc(item.rating ?? '未評')}">${stars(item.rating)}</span>
    </div>
    <div class="card-row">${params.map((p) => `<span>${esc(p)}</span>`).join('')}</div>
    ${noteTags(item.flavorNotes)}
    ${item.photoUrl ? `<img class="feed-photo" src="${esc(item.photoUrl)}" alt="這杯咖啡的照片" loading="lazy" decoding="async">` : ''}`;
  return `
    <li class="feed-card" data-key="${esc(keyOf(item))}">
      ${linkPerson ? `<a class="feed-head person-link" href="${esc(profileHref(item.owner))}">${headHtml(item)}</a>`
    : `<div class="feed-head">${headHtml(item)}</div>`}
      ${detail ? `<div class="feed-body">${body}</div>` : `<a class="feed-body" href="${esc(detailHref(item))}">${body}</a>`}
      <div class="feed-foot">${likeHtml(item)}${detail ? '' : commentLinkHtml(item)}</div>
    </li>`;
}

/** 卡片上方：頭像、暱稱（自己的標「我」）、沖煮時間 */
const headHtml = (item) => `
        ${avatarHtml(item)}
        <div class="person-text">
          <div class="person-name">${esc(item.nickname)}${item.mine ? ' <span class="me-tag">我</span>' : ''}</div>
          <div class="hint">${esc(formatDate(item.brewedAt))}</div>
        </div>`;

/** 卡片上的留言數：連到詳細頁的留言區；有新留言時標示 */
function commentLinkHtml(item) {
  const label = `留言 ${item.commentCount} 則${item.hasNewComments ? '（有新留言）' : ''}`;
  return `<a class="comment-link${item.hasNewComments ? ' has-new' : ''}" href="${esc(detailHref(item, { comments: true }))}"
    aria-label="${esc(label)}"><span aria-hidden="true">💬</span> ${item.commentCount}</a>`;
}

/** 卡片上的風味標籤：最多 3 個，其餘顯示 +N（顏色來自 App 自己的風味輪資料） */
function noteTags(keys = []) {
  const MAX = 3;
  const notes = keys.map(flavorNote).filter(Boolean);
  if (!notes.length) return '';
  return `<div class="note-tags">
    ${notes.slice(0, MAX).map((n) => `<span class="note-tag"><i style="background:${n.color}"></i>${esc(n.zh)}</span>`).join('')}
    ${notes.length > MAX ? `<span class="note-tag more">+${notes.length - MAX}</span>` : ''}
  </div>`;
}

/** 「你、小明和另外 2 人說讚」 */
function likersText(item) {
  if (!item.likeCount) return '';
  const names = item.likers.join('、');
  if (!item.otherLikers) return `${names} 說讚`;
  return names ? `${names}和另外 ${item.otherLikers} 人說讚` : `${item.otherLikers} 人說讚`;
}

function likeHtml(item) {
  return `
    <button type="button" class="like-btn" data-action="like" aria-pressed="${item.likedByMe}">
      <span aria-hidden="true">${item.likedByMe ? '♥' : '♡'}</span> 讚${item.likeCount ? ` ${item.likeCount}` : ''}
    </button>
    <span class="hint like-names">${esc(likersText(item))}</span>`;
}

/**
 * 按讚：先更新畫面，失敗再改回來
 * items：Map<"owner/id", item>，卡片用 data-key 對應
 * root 必須是這一頁自己的元素（不能是 #app，換頁後監聽器會殘留）
 */
export function bindLikes(root, myId, items) {
  const busy = new Set();
  const redraw = (card, item) => {
    const foot = card.querySelector('.feed-foot');
    const comments = foot.querySelector('.comment-link');
    foot.innerHTML = likeHtml(item);
    if (comments) foot.append(comments);
  };
  const apply = (item, liked) => {
    item.likedByMe = liked;
    item.likeCount += liked ? 1 : -1;
    item.likers = liked ? ['你', ...item.likers] : item.likers.filter((n, i) => !(n === '你' && i === 0));
  };
  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="like"]');
    const card = btn?.closest('.feed-card');
    const item = card && items.get(card.dataset.key);
    if (!item || busy.has(card.dataset.key)) return;
    busy.add(card.dataset.key);
    const liked = !item.likedByMe;
    apply(item, liked);
    redraw(card, item);
    try {
      await setLike(myId, item.owner, item.id, liked);
    } catch (err) {
      apply(item, !liked);
      redraw(card, item);
      toast(socialErrorMessage(err));
    } finally {
      busy.delete(card.dataset.key);
    }
  });
}
