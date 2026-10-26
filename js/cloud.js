// 唯一存取 Supabase 的地方（咖啡社群），角色和 db.js 一樣：只負責存取，驗證與訊息在 models.js
// supabase-js 只在第一次用到時才載入（約 220KB），平常開 App 不受影響；檔案在 repo 裡，離線也載得到
import { SUPABASE } from './config.js';

const SUPABASE_JS = {
  src: 'js/vendor/supabase-js-2.117.3.js',
  integrity: 'sha384-BWcjm9OdFth9TbhCxZPdm+gAOUMAzQy9nmTs12ioXdCcbVnJaPMn+fMUoQCLt60R',
};
const SIGNED_URL_SECONDS = 3600; // signed URL 有效 1 小時（規格）
const AVATARS = 'avatars';
const BREW_PHOTOS = 'brew-photos';
const PAGE = 1000; // PostgREST 一次最多回傳的筆數（max_rows）

/** 這個環境有沒有社群功能（config.js 沒設定就沒有） */
export const available = SUPABASE !== null;

/** 失敗時丟出的錯誤：code 是 'network'、PostgreSQL 錯誤碼（如 23514）或 HTTP 狀態；hint 是資料庫給的提示（如 'removed'） */
export class CloudError extends Error {
  constructor(message, code, hint = '') {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}

let authStorage = null;
let clientPromise = null;

/** 登入狀態的存放處（models.js 提供，存在 IndexedDB 的 meta，不會被匯出到備份檔） */
export function configure({ storage }) {
  authStorage = storage;
}

function loadLibrary() {
  if (window.supabase?.createClient) return Promise.resolve(window.supabase);
  return new Promise((resolve, reject) => {
    const script = Object.assign(document.createElement('script'), { src: SUPABASE_JS.src, integrity: SUPABASE_JS.integrity });
    script.onload = () => (window.supabase?.createClient ? resolve(window.supabase) : reject(new CloudError('社群功能載入失敗', 'load')));
    script.onerror = () => reject(new CloudError('社群功能載入失敗', 'load'));
    document.head.append(script);
  });
}

/**
 * 取得 Supabase client（第一次呼叫時載入）
 * flowType 'pkce'：登入後回到 ?code=...（預設的 implicit 會把 token 放在 #，和 hash 路由衝突）
 * 建立時會自動處理網址上的 ?code=，換成 session 後把它從網址移除
 */
function client() {
  if (!available) return Promise.reject(new CloudError('這個環境沒有社群功能', 'unavailable'));
  clientPromise ??= loadLibrary()
    .then((lib) => lib.createClient(SUPABASE.url, SUPABASE.anonKey, {
      auth: {
        flowType: 'pkce',
        storage: authStorage,
        storageKey: 'supabase-auth',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    }))
    .catch((err) => {
      clientPromise = null; // 下次再試
      throw err;
    });
  return clientPromise;
}

const isNetworkError = (error) => !navigator.onLine || /fetch|network|load failed/i.test(`${error?.name} ${error?.message}`);

/** supabase-js 的 { data, error } → data，失敗就丟出 CloudError */
function unwrap({ data, error }) {
  if (!error) return data;
  if (isNetworkError(error)) throw new CloudError('連不上伺服器，請確認網路連線', 'network');
  throw new CloudError(error.message || '發生錯誤', error.code || String(error.status ?? error.statusCode ?? ''), error.hint ?? '');
}

async function run(fn) {
  try {
    return await fn(await client());
  } catch (err) {
    if (err instanceof CloudError) throw err;
    if (isNetworkError(err)) throw new CloudError('連不上伺服器，請確認網路連線', 'network');
    throw new CloudError(err.message || '發生錯誤', 'unknown');
  }
}

// 只接受 uuid（組 .or() 篩選字串時用，避免被插入其他條件）
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function uuid(id) {
  if (!UUID.test(id)) throw new CloudError('id 格式不正確', 'invalid');
  return id;
}

/* ===== 登入 ===== */

/** 目前登入的使用者 { id, email }，沒登入回傳 null（只讀本機的 session，不連網路） */
export const currentUser = () => run(async (sb) => {
  const { session } = unwrap(await sb.auth.getSession());
  return session ? { id: session.user.id, email: session.user.email ?? '' } : null;
});

/** 換頁到 Google 登入，完成後回到 redirectTo（必須在 Supabase 的 Redirect URLs 允許清單裡） */
export const signInWithGoogle = (redirectTo) => run(async (sb) => {
  unwrap(await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } }));
});

/** 登出這台裝置（scope local：其他裝置不受影響）；網路失敗也會清掉本機的 session */
export const signOut = () => run(async (sb) => {
  await sb.auth.signOut({ scope: 'local' });
});

/* ===== profiles ===== */

const PROFILE_COLUMNS = 'id, nickname, friend_code, avatar_path';

/** 自己的 profile；還沒建立回傳 null */
export const getMyProfile = (userId) => run(async (sb) =>
  unwrap(await sb.from('profiles').select(PROFILE_COLUMNS).eq('id', uuid(userId)).maybeSingle()));

/** 建立 profile（id 由資料庫用 auth.uid() 決定，好友代碼由資料庫產生） */
export const createProfile = (nickname) => run(async (sb) =>
  unwrap(await sb.from('profiles').insert({ nickname }).select(PROFILE_COLUMNS).single()));

export const updateNickname = (userId, nickname) => run(async (sb) =>
  unwrap(await sb.from('profiles').update({ nickname }).eq('id', uuid(userId)).select(PROFILE_COLUMNS).single()));

export const regenerateFriendCode = () => run(async (sb) => unwrap(await sb.rpc('regenerate_friend_code')));

/** 先上傳（覆蓋）<user_id>/avatar.jpg，成功後才把 avatar_path 指過去 */
export const saveAvatar = (userId, blob) => run(async (sb) => {
  const path = `${uuid(userId)}/avatar.jpg`;
  unwrap(await sb.storage.from(AVATARS).upload(path, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '0' }));
  return unwrap(await sb.from('profiles').update({ avatar_path: path }).eq('id', userId).select(PROFILE_COLUMNS).single());
});

/** 先把 avatar_path 清掉（別人立刻讀不到），再刪檔案 */
export const removeAvatar = (userId) => run(async (sb) => {
  const profile = unwrap(await sb.from('profiles').update({ avatar_path: null }).eq('id', uuid(userId)).select(PROFILE_COLUMNS).single());
  await sb.storage.from(AVATARS).remove([`${userId}/avatar.jpg`]); // 失敗也沒關係：已經沒有人讀得到
  return profile;
});

/** 頭像路徑 → signed URL（讀不到的不會出現在結果裡） */
export const avatarUrls = (paths) => run(async (sb) => {
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return {};
  const rows = unwrap(await sb.storage.from(AVATARS).createSignedUrls(unique, SIGNED_URL_SECONDS));
  return Object.fromEntries(rows.filter((r) => r.signedUrl && !r.error).map((r) => [r.path, r.signedUrl]));
});

/* ===== 個人檔案 ===== */

/**
 * 完整的個人檔案（自我介紹、器材、豆子、加入日期、貼文數）：本人或沒有封鎖的好友才拿得到，其他一律 null
 * （新欄位不能直接讀 profiles，只能透過資料庫函式 profile_detail）
 */
export const getProfileDetail = (target) => run(async (sb) =>
  unwrap(await sb.rpc('profile_detail', { target: uuid(target) })));

/** 修改自己的暱稱、自我介紹、器材、豆子（RLS：只能改自己的） */
export const updateProfile = (userId, fields) => run(async (sb) => {
  const rows = unwrap(await sb.from('profiles').update(fields).eq('id', uuid(userId)).select('id'));
  if (rows.length !== 1) throw new CloudError('找不到你的個人檔案', 'gone');
});

/** 我和對方之間的好友關係（'pending'、'accepted'，沒有關係是 null）；只讀得到自己相關的 */
export const friendshipStatus = (myId, otherId) => run(async (sb) => {
  const me = uuid(myId);
  const other = uuid(otherId);
  const rows = unwrap(await sb.from('friendships').select('status')
    .or(`and(requester.eq.${me},addressee.eq.${other}),and(requester.eq.${other},addressee.eq.${me})`).limit(1));
  return rows[0]?.status ?? null;
});

/** 我有沒有封鎖對方（被封鎖的人讀不到 blocks，所以只能知道自己封鎖了誰） */
export const iBlocked = (otherId) => run(async (sb) =>
  unwrap(await sb.from('blocks').select('blocked').eq('blocked', uuid(otherId)).limit(1)).length > 0);

/**
 * 我讀得到的留言裡，這個人留言（或被 @）當下記下的暱稱；都沒有回傳 null
 * （留言的讀取政策照常生效：讀得到那篇貼文、和留言者沒有封鎖）
 */
export const nicknameSnapshot = (userId) => run(async (sb) => {
  const id = uuid(userId);
  const authored = unwrap(await sb.from('comments').select('author_nickname')
    .eq('author', id).order('created_at', { ascending: false }).limit(1));
  if (authored[0]?.author_nickname) return authored[0].author_nickname;
  const mentioned = unwrap(await sb.from('comments').select('reply_to_nickname')
    .eq('reply_to_user', id).not('reply_to_nickname', 'is', null).order('created_at', { ascending: false }).limit(1));
  return mentioned[0]?.reply_to_nickname ?? null;
});

/* ===== 好友 ===== */

/** 用好友代碼送邀請，回傳資料庫的結果代碼（sent、accepted、not_found…） */
export const sendFriendRequest = (code) => run(async (sb) => unwrap(await sb.rpc('send_friend_request', { code })));

/** 自己相關的所有好友關係，加上對方的 profile（RLS 只回傳看得到的） */
export const listFriendships = () => run(async (sb) => {
  const rows = unwrap(await sb.from('friendships').select('requester, addressee, status, created_at, accepted_at'));
  const ids = [...new Set(rows.flatMap((r) => [r.requester, r.addressee]))];
  const profiles = ids.length
    ? unwrap(await sb.from('profiles').select('id, nickname, avatar_path').in('id', ids))
    : [];
  return { rows, profiles };
});

/** 接受邀請：只有接收者改得了（RLS），改不到時回傳 false */
export const acceptFriendRequest = (myId, requesterId) => run(async (sb) => {
  const rows = unwrap(await sb.from('friendships').update({ status: 'accepted' })
    .eq('requester', uuid(requesterId)).eq('addressee', uuid(myId)).select('status'));
  return rows.length === 1;
});

/** 刪除兩人之間的關係（拒絕、取消邀請、解除好友都是這個） */
export const deleteFriendship = (myId, otherId) => run(async (sb) => {
  const me = uuid(myId);
  const other = uuid(otherId);
  unwrap(await sb.from('friendships').delete()
    .or(`and(requester.eq.${me},addressee.eq.${other}),and(requester.eq.${other},addressee.eq.${me})`));
});

/** 封鎖（資料庫會刪掉待處理的邀請、記下對方當下的暱稱；好友關係、讚、留言都保留，只是互相看不到） */
export const block = (otherId) => run(async (sb) => {
  unwrap(await sb.from('blocks').insert({ blocked: uuid(otherId) }));
});

export const unblock = (otherId) => run(async (sb) => {
  unwrap(await sb.from('blocks').delete().eq('blocked', uuid(otherId)));
});

export const listBlocks = () => run(async (sb) =>
  unwrap(await sb.from('blocks').select('blocked, blocked_nickname, created_at').order('created_at', { ascending: false })));

/** 有沒有收到還沒處理的好友邀請（☰ 按鈕的提示；只查一筆） */
export const hasIncomingRequests = (myId) => run(async (sb) =>
  unwrap(await sb.from('friendships').select('requester').eq('addressee', uuid(myId)).eq('status', 'pending').limit(1)).length > 0);

/* ===== 自己的 shared_brews（同步用） ===== */

/** 自己在雲端的所有紀錄 [{ id, photo_path }]（分批讀，避開一次 1000 筆的上限） */
export const listMySharedBrews = (userId) => run(async (sb) => {
  const all = [];
  for (let from = 0; ; from += PAGE) {
    const rows = unwrap(await sb.from('shared_brews').select('id, photo_path')
      .eq('owner', uuid(userId)).order('id').range(from, from + PAGE - 1));
    all.push(...rows);
    if (rows.length < PAGE) return all;
  }
});

/** 新增（owner 由資料庫用 auth.uid() 決定；每天 30 筆的上限由 trigger 檢查） */
export const insertSharedBrew = (row) => run(async (sb) => {
  unwrap(await sb.from('shared_brews').insert({ ...row, id: uuid(row.id) }));
});

/** 修改自己的紀錄（id、owner 不能改，不放進 update）；回傳有沒有改到 */
export const updateSharedBrew = (userId, row) => run(async (sb) => {
  const { id, ...fields } = row;
  const rows = unwrap(await sb.from('shared_brews').update(fields)
    .eq('owner', uuid(userId)).eq('id', uuid(id)).select('id'));
  return rows.length === 1;
});

/** 刪除自己的紀錄（讚、檢舉由外鍵 on delete cascade 一起刪掉） */
export const deleteSharedBrew = (userId, id) => run(async (sb) => {
  unwrap(await sb.from('shared_brews').delete().eq('owner', uuid(userId)).eq('id', uuid(id)));
});

/** 上傳（覆蓋）紀錄的照片：紀錄的 photo_path 必須已經指向這個路徑（Storage 政策） */
export const uploadBrewPhoto = (path, blob) => run(async (sb) => {
  unwrap(await sb.storage.from(BREW_PHOTOS).upload(path, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '0' }));
});

/** 刪除照片（只能刪自己資料夾裡的）；SQL 刪不了 storage.objects，一律走 Storage API */
export const removeBrewPhotos = (paths) => run(async (sb) => {
  if (paths.length) unwrap(await sb.storage.from(BREW_PHOTOS).remove(paths));
});

/** 照片路徑 → signed URL（讀不到的不會出現在結果裡） */
export const brewPhotoUrls = (paths) => run(async (sb) => {
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return {};
  const rows = unwrap(await sb.storage.from(BREW_PHOTOS).createSignedUrls(unique, SIGNED_URL_SECONDS));
  return Object.fromEntries(rows.filter((r) => r.signedUrl && !r.error).map((r) => [r.path, r.signedUrl]));
});

/* ===== 社群（動態牆） ===== */

const BREW_COLUMNS = [
  'owner', 'id', 'bean_name', 'bean_origin', 'bean_process', 'roast_level', 'roast_date', 'brewed_at',
  'method', 'dripper', 'grinder_name', 'grind_setting', 'coffee_g', 'water_g', 'temp_c', 'total_time_s',
  'rating', 'acidity', 'sweetness', 'bitterness', 'body', 'flavor_notes', 'notes', 'photo_path',
].join(', ');

/**
 * 動態牆的紀錄，依沖煮時間新→舊；指定 owner 時只有那個人的（「我的」、個人檔案），否則是自己＋好友的
 * （RLS 只回傳自己、已接受且沒有封鎖的好友：不是好友的人的 owner 一律是空的）
 */
export const listFeed = ({ offset, limit, owner = null }) => run(async (sb) => {
  let query = sb.from('shared_brews').select(BREW_COLUMNS);
  if (owner) query = query.eq('owner', uuid(owner));
  return unwrap(await query
    .order('brewed_at', { ascending: false }).order('id', { ascending: false })
    .range(offset, offset + limit - 1));
});

/** 好友最新一篇紀錄的建立時間（「好友」分頁的新貼文提示；RLS 只回傳看得到的）；沒有回傳 null */
export const latestFriendBrewAt = (myId) => run(async (sb) =>
  unwrap(await sb.from('shared_brews').select('created_at').neq('owner', uuid(myId))
    .order('created_at', { ascending: false }).limit(1))[0]?.created_at ?? null);

/** 好友在 since 之後新增的紀錄數（社群分頁的數字；since 為 null 時算全部），最多算到 limit 筆 */
export const countFriendBrewsSince = (myId, since, limit = 100) => run(async (sb) => {
  let query = sb.from('shared_brews').select('id').neq('owner', uuid(myId));
  if (since) query = query.gt('created_at', since);
  return unwrap(await query.order('created_at', { ascending: false }).limit(limit)).length;
});

/** 單筆紀錄；讀不到（不是好友、被封鎖、已刪除）回傳 null */
export const getSharedBrew = (owner, id) => run(async (sb) =>
  unwrap(await sb.from('shared_brews').select(BREW_COLUMNS).eq('owner', uuid(owner)).eq('id', uuid(id)).maybeSingle()));

/** 這些紀錄的讚 [{ brew_owner, brew_id, user_id }]（RLS：讀得到紀錄才讀得到讚） */
export const listLikes = (brews) => run(async (sb) => {
  if (!brews.length) return [];
  const ids = [...new Set(brews.map((b) => uuid(b.id)))];
  const rows = unwrap(await sb.from('likes').select('brew_owner, brew_id, user_id').in('brew_id', ids));
  const keys = new Set(brews.map((b) => `${b.owner}/${b.id}`));
  return rows.filter((r) => keys.has(`${r.brew_owner}/${r.brew_id}`));
});

/** 按讚（user_id 由資料庫用 auth.uid() 決定）；已經按過不算錯誤 */
export const like = (owner, id) => run(async (sb) => {
  const { error } = await sb.from('likes').insert({ brew_owner: uuid(owner), brew_id: uuid(id) });
  if (error && error.code !== '23505') unwrap({ error });
});

export const unlike = (myId, owner, id) => run(async (sb) => {
  unwrap(await sb.from('likes').delete().eq('user_id', uuid(myId)).eq('brew_owner', uuid(owner)).eq('brew_id', uuid(id)));
});

/** 這些人的 profile（RLS 只回傳看得到的：自己、好友、有待處理邀請的對方） */
export const listProfiles = (ids) => run(async (sb) => {
  const unique = [...new Set(ids)].map(uuid);
  if (!unique.length) return [];
  return unwrap(await sb.from('profiles').select('id, nickname, avatar_path').in('id', unique));
});

/* ===== 留言 ===== */

const COMMENT_COLUMNS = 'id, brew_owner, brew_id, parent_id, author, author_nickname, reply_to_user, reply_to_nickname, body, created_at';

/** 一筆紀錄的所有留言（RLS：讀得到紀錄、且和留言者沒有封鎖），舊→新 */
export const listComments = (owner, id) => run(async (sb) => {
  const all = [];
  for (let from = 0; ; from += PAGE) {
    const rows = unwrap(await sb.from('comments').select(COMMENT_COLUMNS)
      .eq('brew_owner', uuid(owner)).eq('brew_id', uuid(id))
      .order('created_at').order('id').range(from, from + PAGE - 1));
    all.push(...rows);
    if (rows.length < PAGE) return all;
  }
});

/** 這些紀錄各有幾則留言（看得到的）：{ 'owner/id': n } */
export const countComments = (brews) => run(async (sb) => {
  if (!brews.length) return {};
  const ids = [...new Set(brews.map((b) => uuid(b.id)))];
  const keys = new Set(brews.map((b) => `${b.owner}/${b.id}`));
  const counts = {};
  for (let from = 0; ; from += PAGE) {
    const rows = unwrap(await sb.from('comments').select('brew_owner, brew_id').in('brew_id', ids)
      .order('id').range(from, from + PAGE - 1));
    for (const r of rows) {
      const key = `${r.brew_owner}/${r.brew_id}`;
      if (keys.has(key)) counts[key] = (counts[key] ?? 0) + 1;
    }
    if (rows.length < PAGE) return counts;
  }
});

/** 留言或回覆（author 由資料庫用 auth.uid() 決定；兩層、回覆對象、每天 100 則都由資料庫檢查）；回傳新增的那一列 */
export const insertComment = ({ owner, id, body, parentId = null, replyToUser = null }) => run(async (sb) =>
  unwrap(await sb.from('comments').insert({
    brew_owner: uuid(owner), brew_id: uuid(id), body,
    parent_id: parentId ? uuid(parentId) : null, reply_to_user: replyToUser ? uuid(replyToUser) : null,
  }).select(COMMENT_COLUMNS).single()));

/** 刪除留言（留言作者或貼文作者才刪得到，RLS）；回傳有沒有刪到 */
export const deleteComment = (commentId) => run(async (sb) =>
  unwrap(await sb.from('comments').delete().eq('id', uuid(commentId)).select('id')).length === 1);

/**
 * 我的留言通知（只查目前登入的人）：{ post_comments, replies, latest_post_comment_at, latest_reply_at, posts }
 * postSince／replySince：上次看過的時間（雲端時間），null 為全部
 */
export const commentActivity = (postSince, replySince) => run(async (sb) =>
  unwrap(await sb.rpc('comment_activity', { post_since: postSince, reply_since: replySince })));

/* ===== 推播通知 ===== */
// 訂閱、偏好都只能讀寫自己的（RLS）；通知誰、合併由資料庫 trigger 判斷，送出由 Edge Function send-push（使用者呼叫不了）

/** 這個 endpoint 是不是已經存在我的訂閱裡（別人的讀不到，所以只會找到自己的） */
export const hasPushSubscription = (endpoint) => run(async (sb) =>
  unwrap(await sb.from('push_subscriptions').select('id').eq('endpoint', endpoint).limit(1)).length > 0);

/**
 * 存這台裝置的訂閱（user_id 由資料庫用 auth.uid() 決定）；已經存過就不再新增
 * 失敗時 CloudError 的 code：23505（endpoint 被別的帳號用了）、P0001 + hint too_many_devices（超過 10 台）
 */
export const savePushSubscription = (row) => run(async (sb) => {
  const existing = unwrap(await sb.from('push_subscriptions').select('id').eq('endpoint', row.endpoint).limit(1));
  if (existing.length) return;
  unwrap(await sb.from('push_subscriptions').insert(row));
});

export const deletePushSubscription = (endpoint) => run(async (sb) => {
  unwrap(await sb.from('push_subscriptions').delete().eq('endpoint', endpoint));
});

/** 通知的開關 { comments, replies, newPosts, likes }；沒存過＝好友新貼文關、其他開（和資料庫的預設值相同） */
export const getNotificationPrefs = () => run(async (sb) => {
  const row = unwrap(await sb.from('notification_prefs').select('comments, replies, new_posts, likes').maybeSingle());
  if (!row) return { comments: true, replies: true, newPosts: false, likes: true };
  return { comments: row.comments, replies: row.replies, newPosts: row.new_posts, likes: row.likes };
});

export const saveNotificationPrefs = ({ comments, replies, newPosts, likes }) => run(async (sb) => {
  unwrap(await sb.from('notification_prefs').upsert({ comments, replies, new_posts: newPosts, likes }, { onConflict: 'user_id' }));
});

/* ===== 沖煮熱度圖（brew_activity、activity_shares） ===== */

/** 自己的開關：開啟時 { deviceId }（負責上傳的那台），沒開回傳 null（別人的讀不到） */
export const getActivityShare = () => run(async (sb) => {
  const row = unwrap(await sb.from('activity_shares').select('device_id').maybeSingle());
  return row ? { deviceId: row.device_id } : null;
});

/** 開啟（或改由這台裝置上傳）；user_id 由資料庫用 auth.uid() 決定 */
export const setActivityShare = (deviceId) => run(async (sb) => {
  unwrap(await sb.from('activity_shares').upsert({ device_id: uuid(deviceId) }, { onConflict: 'user_id' }));
});

/** 關閉：刪掉開關，trigger 會把雲端的熱度圖資料全部刪除 */
export const deleteActivityShare = (userId) => run(async (sb) => {
  unwrap(await sb.from('activity_shares').delete().eq('user_id', uuid(userId)));
});

/** 某人每天的杯數 [{ day, cups }]（本人或沒有封鎖的好友才讀得到，其他一律是空陣列；最多約 366 列） */
export const listActivity = (userId) => run(async (sb) =>
  unwrap(await sb.from('brew_activity').select('day, cups').eq('user_id', uuid(userId)).order('day')));

/** 新增或修改自己這幾天的杯數（一次送出；開啟後才能寫，日期範圍、杯數由資料庫檢查） */
export const upsertActivity = (rows) => run(async (sb) => {
  if (!rows.length) return;
  unwrap(await sb.from('brew_activity').upsert(rows.map(({ day, cups }) => ({ day, cups })), { onConflict: 'user_id,day' }));
});

/** 刪掉自己這幾天的資料 */
export const deleteActivityDays = (userId, days) => run(async (sb) => {
  const valid = days.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)); // 只接受日期（組篩選字串時避免被插入其他條件）
  if (!valid.length) return;
  unwrap(await sb.from('brew_activity').delete().eq('user_id', uuid(userId)).in('day', valid));
});

/* ===== 檢舉、刪除帳號 ===== */

/** 檢舉一筆看得到的紀錄（reporter 由資料庫用 auth.uid() 決定；每天 10 次的上限由 trigger 檢查） */
export const insertReport = ({ owner, id, reason, detail }) => run(async (sb) => {
  unwrap(await sb.from('reports').insert({ brew_owner: uuid(owner), brew_id: uuid(id), reason, detail }));
});

/**
 * 送出意見回饋（Edge Function feedback：用呼叫者的身分存進 feedback 表，再寄 Email 給站長）
 * 失敗時 CloudError 的 code：network、rate_limited（每天 5 則）、no_profile、invalid，或 HTTP 狀態
 */
export const sendFeedback = ({ category, message, appVersion }) => run(async (sb) => {
  const { data, error } = await sb.functions.invoke('feedback', { body: { category, message, appVersion } });
  if (error) {
    if (error.name === 'FunctionsFetchError' || isNetworkError(error)) throw new CloudError('連不上伺服器，請確認網路連線', 'network');
    const body = await error.context?.json?.().catch(() => null);
    throw new CloudError('送出失敗，請稍後再試', body?.error ?? String(error.context?.status ?? 'function'));
  }
  return data;
});

/**
 * 刪除自己的帳號（Edge Function delete-account：刪照片、頭像與 auth 使用者，資料表跟著刪除）
 * 成功後清掉這台裝置的登入狀態
 */
export const deleteAccount = () => run(async (sb) => {
  const { data, error } = await sb.functions.invoke('delete-account', { method: 'POST' });
  if (error) {
    if (error.name === 'FunctionsFetchError' || isNetworkError(error)) throw new CloudError('連不上伺服器，請確認網路連線', 'network');
    throw new CloudError('刪除帳號失敗，請稍後再試', String(error.context?.status ?? 'function'));
  }
  if (!data?.deleted) throw new CloudError('刪除帳號失敗，請稍後再試', 'function');
  await sb.auth.signOut({ scope: 'local' });
});

/* ===== 開發者後台 ===== */
// 權限一律在資料庫（public.admin_*，不是開發者回 42501）與 Edge Function admin-delete-user 檢查；這裡只負責呼叫

/** 目前登入的人是不是開發者（只決定要不要顯示入口） */
export const amIAdmin = () => run(async (sb) => unwrap(await sb.rpc('am_i_admin')) === true);

/** 後台的讀取函式：name 是 admin_list_users 這類名稱，回傳 JSON */
export const adminQuery = (name, args = {}) => run(async (sb) => unwrap(await sb.rpc(name, args)));

export const adminDeleteComment = (commentId, reason) => run(async (sb) => {
  unwrap(await sb.rpc('admin_delete_comment', { comment_id: uuid(commentId), reason }));
});

/** 刪除貼文；回傳照片路徑（沒有照片是 null），由呼叫端用 removeBrewPhotos 刪（開發者可以刪 brew-photos） */
export const adminDeletePost = (owner, id, reason) => run(async (sb) =>
  unwrap(await sb.rpc('admin_delete_post', { p_owner: uuid(owner), p_id: uuid(id), reason })));

/** 刪除別人的帳號（Edge Function admin-delete-user）；被拒時 code 是 HTTP 狀態，hint 是 self／admin／forbidden… */
export const adminDeleteUser = (userId, reason) => run(async (sb) => {
  const { data, error } = await sb.functions.invoke('admin-delete-user', { body: { userId: uuid(userId), reason } });
  if (error) {
    if (error.name === 'FunctionsFetchError' || isNetworkError(error)) throw new CloudError('連不上伺服器，請確認網路連線', 'network');
    const body = await error.context?.json?.().catch(() => null);
    throw new CloudError('刪除帳號失敗', String(error.context?.status ?? 'function'), body?.error ?? '');
  }
  if (!data?.deleted) throw new CloudError('刪除帳號失敗', 'function');
});
