// 唯一存取 Supabase 的地方（咖啡社群），角色和 db.js 一樣：只負責存取，驗證與訊息在 models.js
// supabase-js 只在第一次用到時才載入（約 220KB），平常開 App 不受影響；檔案在 repo 裡，離線也載得到
import { SUPABASE } from './config.js';

const SUPABASE_JS = {
  src: 'js/vendor/supabase-js-2.117.3.js',
  integrity: 'sha384-BWcjm9OdFth9TbhCxZPdm+gAOUMAzQy9nmTs12ioXdCcbVnJaPMn+fMUoQCLt60R',
};
const SIGNED_URL_SECONDS = 3600; // signed URL 有效 1 小時（規格）
const AVATARS = 'avatars';

/** 這個環境有沒有社群功能（config.js 沒設定就沒有） */
export const available = SUPABASE !== null;

/** 失敗時丟出的錯誤：code 是 'network'、PostgreSQL 錯誤碼（如 23514）或 HTTP 狀態 */
export class CloudError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
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
  throw new CloudError(error.message || '發生錯誤', error.code || String(error.status ?? error.statusCode ?? ''));
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

/** 封鎖（資料庫會同時解除好友、刪掉邀請與讚，並記下對方當下的暱稱） */
export const block = (otherId) => run(async (sb) => {
  unwrap(await sb.from('blocks').insert({ blocked: uuid(otherId) }));
});

export const unblock = (otherId) => run(async (sb) => {
  unwrap(await sb.from('blocks').delete().eq('blocked', uuid(otherId)));
});

export const listBlocks = () => run(async (sb) =>
  unwrap(await sb.from('blocks').select('blocked, blocked_nickname, created_at').order('created_at', { ascending: false })));
