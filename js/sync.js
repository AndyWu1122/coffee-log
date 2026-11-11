// 咖啡社群的同步：本機 visibility = 'friends' 的紀錄 → 雲端 shared_brews、拉花 → shared_latte_arts（只由 models.js 使用）
// 不記「要做哪些動作」，而是每次比對「本機現在應該長怎樣」和 sync store 記的「上次同步的內容」，有差異就補送：
// 離線、沒登入、匯入備份、改了豆子名稱，下次同步時都會自動補上；衝突一律以本機為準（直接覆蓋雲端）
// 只刪這台裝置認得的雲端紀錄（sync store 有、或本機有這筆），別台裝置上傳的不會被誤刪
// 同一支手機換帳號：sync store 的 userId 記著這筆是用哪個帳號分享的，別的帳號的紀錄不上傳、不刪，
// 換回原本的帳號時照常同步；從來沒同步過的紀錄算目前登入的帳號
// 沖煮熱度圖（brew_activity）也在這裡同步，見檔案最後
import * as db from './db.js';
import * as cloud from './cloud.js';
import { photoForUpload } from './image.js';
import { activityRows, WINDOW_DAYS } from './heatmap.js';
import { localDate, addDays } from './stats.js';
import { newId } from './id.js';
import { originLabel } from './origins.js';

// supabase-js 存 session 的位置（models.js 設定的 meta key）；沒有就代表沒登入，不必載入 supabase-js
const SESSION_KEY = 'auth:supabase-auth';

/**
 * 雲端照片路徑 <user_id>/<brew_id>.jpg
 * 要和 shared_brews.photo_path 的 check 約束、Storage 政策一致（uuid 轉成文字一律小寫）
 */
export const cloudPhotoPath = (userId, brewId) => `${String(userId).toLowerCase()}/${String(brewId).toLowerCase()}.jpg`;

/** 本機紀錄 → shared_brews 的一列（豆子、磨豆機、濾杯轉成名稱；owner 由資料庫用 auth.uid() 決定） */
export function toSharedRow(brew, bean, grinder, dripper, photoPath) {
  const f = brew.flavor ?? {};
  return {
    id: brew.id,
    bean_name: bean?.name ?? '',
    bean_origin: bean ? originLabel(bean) : '', // 選了的國家、產區＋產地文字（雲端結構不變）
    bean_process: bean?.process ?? null,
    roast_level: bean?.roastLevel ?? null,
    roast_date: bean?.roastDate || null,
    brewed_at: brew.brewedAt,
    method: brew.method || 'pourover', // 舊紀錄沒有 method＝手沖
    dripper: dripper?.name ?? '',
    grinder_name: grinder?.name ?? '',
    grind_setting: brew.grindSetting ?? '',
    coffee_g: brew.coffeeG,
    water_g: brew.waterG,
    temp_c: brew.tempC ?? null,
    total_time_s: brew.totalTimeS ?? null,
    rating: brew.rating ?? null,
    acidity: f.acidity ?? null,
    sweetness: f.sweetness ?? null,
    bitterness: f.bitterness ?? null,
    body: f.body ?? null,
    flavor_notes: brew.flavorNotes ?? [],
    notes: brew.notes ?? '',
    photo_path: photoPath,
  };
}

/** 這筆紀錄現在「應該」在雲端的樣子：{ row, json, photo, photoAt } */
async function desiredBrew(brew, userId) {
  const [bean, grinder, dripper, photo] = await Promise.all([
    db.get('beans', brew.beanId),
    brew.grinderId ? db.get('grinders', brew.grinderId) : null,
    brew.dripperId ? db.get('drippers', brew.dripperId) : null,
    db.get('photos', brew.id),
  ]);
  const row = toSharedRow(brew, bean, grinder, dripper, photo ? cloudPhotoPath(userId, brew.id) : null);
  // 手沖（雲端的預設值）不放進比對用的 json：1.21.0 以前同步過的紀錄 json 不變，不用全部重送；
  // 從賽風改回手沖時 json 不同，照樣會送出 method: 'pourover'
  const { method, ...rest } = row;
  return { row, json: JSON.stringify(method === 'pourover' ? rest : row), photo, photoAt: photo?.createdAt ?? null };
}

/** 本機拉花 → shared_latte_arts 的一列（不上傳豆子；owner 由資料庫用 auth.uid() 決定） */
export function toLatteRow(art, photoPath) {
  const s = art.scores ?? {};
  return {
    id: art.id,
    made_at: art.madeAt,
    pattern: art.pattern,
    pattern_note: art.patternNote ?? '',
    milk: art.milk ?? '',
    cup: art.cup ?? '',
    score_contrast: s.contrast ?? null,
    score_foam: s.foam ?? null,
    score_symmetry: s.symmetry ?? null,
    score_completion: s.completion ?? null,
    notes: art.notes ?? '',
    photo_path: photoPath,
  };
}

async function desiredLatte(art, userId) {
  const photo = await db.get('latteArtPhotos', art.id);
  const row = toLatteRow(art, photo ? cloudPhotoPath(userId, art.id) : null);
  return { row, json: JSON.stringify(row), photo, photoAt: photo?.createdAt ?? null };
}

// 兩種貼文：本機的 store、同步紀錄的 store（key 欄位）、雲端的種類；照片都在 brew-photos（路徑 <user_id>/<id>.jpg）
const KINDS = {
  brew: { store: 'brews', syncStore: 'sync', key: 'brewId', at: (b) => b.brewedAt, desired: desiredBrew },
  latte: { store: 'latteArts', syncStore: 'latteSync', key: 'artId', at: (a) => a.madeAt, desired: desiredLatte },
};

/** 本機 session 的使用者 id（只讀 IndexedDB，不載入 supabase-js、不連網路）；沒登入回傳 null */
export async function sessionUserId() {
  const value = await db.getMeta(SESSION_KEY);
  try {
    return JSON.parse(value)?.user?.id ?? null;
  } catch {
    return null;
  }
}

/** 台灣時間的日期 YYYY-MM-DD（每天 30 筆的上限以台灣時間的日曆日計算，和資料庫一致） */
const taipeiDate = (d = new Date()) => new Date(d.getTime() + 8 * 3600000).toISOString().slice(0, 10);

/** CloudError 的錯誤碼 → 記在 sync store 的原因 */
function failureReason(err) {
  if (err?.code === '23514' && err.hint === 'removed') return 'removed'; // 開發者刪掉的貼文，不能再上傳
  if (err?.code === 'P0001') return 'rate_limited';             // 每天 30 筆
  if (/^2[23]/.test(err?.code ?? '')) return 'invalid';         // check 約束、資料格式（內容沒改就不重送）
  return 'failed';
}

/**
 * 同步一次（先手沖、再拉花）。回傳 { status, uploaded, deleted, failed }（兩種合計）
 * status：unavailable（沒有社群功能）、idle（沒有要同步的）、signed-out、no-profile、offline、done
 * 連不上伺服器會在途中停下（status: offline），已完成的部分會保留
 */
async function syncOnce() {
  const result = { status: 'done', uploaded: 0, deleted: 0, failed: 0 };
  if (!cloud.available) return { ...result, status: 'unavailable' };
  const local = await Promise.all(Object.entries(KINDS).map(async ([kind, k]) => {
    const [items, states] = await Promise.all([db.getAll(k.store), db.getAll(k.syncStore)]);
    return { kind, k, items, states, friends: items.filter((x) => x.visibility === 'friends') };
  }));
  if (local.every((l) => !l.friends.length && !l.states.length)) return { ...result, status: 'idle' };
  if (!(await sessionUserId())) return { ...result, status: 'signed-out' };
  if (!navigator.onLine) return { ...result, status: 'offline' };

  try {
    const user = await cloud.currentUser();
    if (!user) return { ...result, status: 'signed-out' };
    if (!(await cloud.getMyProfile(user.id))) return { ...result, status: 'no-profile' };
    // 每天 30 筆是手沖和拉花共用：撞到上限後兩種的新增都先停
    const ctx = { insertBlocked: false };
    for (const l of local) await syncKind(l, user, ctx, result);
  } catch (err) {
    if (err?.code === 'network' || err?.code === 'load') return { ...result, status: 'offline' };
    throw err;
  }
  return result;
}

/** 一種貼文的同步（邏輯和 1.24.0 以前的手沖同步完全一樣，只是表、store 換成參數） */
async function syncKind({ kind, k, items, states, friends }, user, ctx, result) {
  // 用別的帳號分享過的：不屬於現在這個帳號，不上傳、不刪（同步紀錄留著，換回那個帳號時繼續用）
  const known = new Map();
  const foreign = new Set();
  for (const s of states) {
    if (s.userId === user.id) known.set(s[k.key], s);
    else foreign.add(s[k.key]);
  }
  const remote = new Map((await cloud.listMyPosts(kind, user.id)).map((r) => [r.id, r]));
  const localIds = new Set(items.map((x) => x.id));
  const friendIds = new Set(friends.map((x) => x.id));
  const syncRow = (id, fields) => ({ [k.key]: id, userId: user.id, ...fields });

  // 1. 改回 private 或已刪除的：先刪貼文（好友立刻讀不到），再用 Storage API 刪照片
  const toDelete = new Set([...remote.keys(), ...known.keys()]);
  for (const id of toDelete) {
    if (friendIds.has(id) || foreign.has(id) || !(known.has(id) || localIds.has(id))) continue;
    const st = known.get(id);
    try {
      if (remote.has(id)) await cloud.deletePost(kind, user.id, id);
      if (remote.get(id)?.photo_path || st?.photoAt) await cloud.removeBrewPhotos([cloudPhotoPath(user.id, id)]);
      await db.remove(k.syncStore, id);
      result.deleted++;
    } catch (err) {
      if (err.code === 'network') throw err;
      // 留下同步紀錄，下次再試（照片時間設成非空，確保會再刪一次照片）
      await db.put(k.syncStore, syncRow(id, { row: null, photoAt: st?.photoAt ?? 'unknown', error: 'failed', failedRow: null }));
      result.failed++;
    }
  }

  // 2. 新增或修改：新的先送（遇到每天的上限時，最近的先分享出去）
  for (const item of [...friends].sort((a, b) => k.at(b).localeCompare(k.at(a)))) {
    if (foreign.has(item.id)) continue;                                                     // 另一個帳號的
    const st = known.get(item.id);
    const d = await k.desired(item, user.id);
    const exists = remote.has(item.id);
    const remotePhoto = remote.get(item.id)?.photo_path ?? null;
    if (st?.error === 'removed') continue;                                                  // 被開發者移除：永遠不再上傳
    if (exists && !st?.error && st?.row === d.json && st.photoAt === d.photoAt) continue; // 已同步
    if (st?.error === 'invalid' && st.failedRow === d.json) continue;                       // 內容沒改，送了也會被拒絕
    if (!exists && st?.error === 'rate_limited' && st.failedOn === taipeiDate()) ctx.insertBlocked = true; // 今天已經撞到上限
    const fail = async (error) => {
      await db.put(k.syncStore, {
        ...(st ?? { row: null, photoAt: null }), ...syncRow(item.id, { error, failedRow: d.json, failedOn: taipeiDate() }),
      });
      result.failed++;
    };
    if (!exists && ctx.insertBlocked) { await fail('rate_limited'); continue; }
    try {
      // 先寫貼文、再傳照片（Storage 政策要求 photo_path 已經指向這個路徑）
      if (exists) {
        if (!(await cloud.updatePost(kind, user.id, d.row))) throw new cloud.CloudError('紀錄不存在', 'gone');
      } else {
        await cloud.insertPost(kind, d.row);
      }
      const photoPath = cloudPhotoPath(user.id, item.id);
      if (d.photo && (!exists || st?.photoAt !== d.photoAt || remotePhoto !== d.row.photo_path)) {
        await cloud.uploadBrewPhoto(photoPath, await photoForUpload(d.photo.blob));
      } else if (!d.photo && (remotePhoto || st?.photoAt)) {
        await cloud.removeBrewPhotos([photoPath]); // photo_path 已經是 null，好友已經讀不到
      }
      await db.put(k.syncStore, syncRow(item.id, { row: d.json, photoAt: d.photoAt, error: '', failedRow: null }));
      result.uploaded++;
    } catch (err) {
      if (err.code === 'network') throw err;
      const reason = failureReason(err);
      if (reason === 'rate_limited') ctx.insertBlocked = true;
      if (reason === 'failed') console.warn('同步失敗', kind, item.id, err);
      await fail(reason);
    }
  }
}

let running = null;
let again = false;

/**
 * 要求同步：正在同步時不會同時跑兩次，而是結束後再跑一次（期間的修改不會漏掉）
 * 回傳最後一次同步的結果
 */
export function request() {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      let last;
      do {
        again = false;
        last = await syncOnce();
        // 熱度圖和紀錄的同步互不影響：一邊失敗不會擋住另一邊
        last.activity = await syncActivityOnce().catch((err) => {
          console.warn('熱度圖同步失敗', err);
          return { status: 'failed' };
        });
      } while (again);
      return last;
    } finally {
      running = null;
    }
  })();
  return running;
}

/**
 * 一筆貼文的分享狀態（只讀本機，不連網路）：kind 'brew'｜'latte'
 * off（只有我）、signed-out（沒登入）、synced（已分享）、pending（等待上傳）、
 * rate_limited（今天的額度用完）、invalid（內容不符合雲端的限制）、failed（上傳失敗，會再試）、
 * removed（被開發者移除，不會再上傳）、other-account（用另一個帳號分享的，登入那個帳號才會同步）
 */
export async function postStatus(kind, item) {
  const k = KINDS[kind];
  if (item?.visibility !== 'friends') return 'off';
  const userId = await sessionUserId();
  if (!userId) return 'signed-out';
  const st = await db.get(k.syncStore, item.id);
  if (!st) return 'pending';
  if (st.userId !== userId) return 'other-account';
  if (st.error === 'removed') return 'removed';
  const d = await k.desired(item, userId);
  if (st.error && st.failedRow === d.json) return st.error;
  return !st.error && st.row === d.json && st.photoAt === d.photoAt ? 'synced' : 'pending';
}
export const brewStatus = (brew) => postStatus('brew', brew);

/* ===== 沖煮熱度圖：近一年每天的杯數 → 雲端 brew_activity ===== */
// 只有打開「讓好友看到我的熱度圖」的那台裝置上傳（雲端 activity_shares.device_id），兩台手機的紀錄不會互相蓋掉
// 本機 meta activityShare = { userId } 記著「這台負責上傳」：沒有就直接跳過，不載入 supabase-js
// 不記動作佇列：每次讀雲端現有的（最多約 366 列）和本機應該有的比對，有差異的天才送；被別台關掉或接手時清掉本機的記號

const DEVICE_KEY = 'deviceId';         // 這台裝置的 id（第一次用到時產生；不匯出、匯入也不清）
const ACTIVITY_KEY = 'activityShare';  // { userId }：這台負責上傳熱度圖

/** 這台裝置的 id */
export async function deviceId() {
  let id = await db.getMeta(DEVICE_KEY);
  if (!id) {
    id = newId();
    await db.setMeta(DEVICE_KEY, id);
  }
  return id;
}

/** 記下（userId）或清掉（null）「這台負責上傳熱度圖」 */
export const setActivityUploader = (userId) =>
  (userId ? db.setMeta(ACTIVITY_KEY, { userId }) : db.remove('meta', ACTIVITY_KEY));

/**
 * 熱度圖同步一次：{ status, upserted, deleted }
 * status：unavailable、idle（這台不負責上傳）、signed-out、other-account、offline、off（雲端已關閉或改由別台上傳）、done
 */
async function syncActivityOnce() {
  const result = { status: 'done', upserted: 0, deleted: 0 };
  if (!cloud.available) return { ...result, status: 'unavailable' };
  const share = await db.getMeta(ACTIVITY_KEY);
  if (!share) return { ...result, status: 'idle' };
  const userId = await sessionUserId();
  if (!userId) return { ...result, status: 'signed-out' };
  if (share.userId !== userId) return { ...result, status: 'other-account' }; // 用另一個帳號打開的
  if (!navigator.onLine) return { ...result, status: 'offline' };

  try {
    const remote = await cloud.getActivityShare();
    if (!remote || remote.deviceId !== await deviceId()) {
      await setActivityUploader(null);
      return { ...result, status: 'off' };
    }
    // 日期用本機日期；資料庫用台灣時間檢查範圍，時區比台灣快的裝置在半夜可能多出「明天」，先濾掉
    const taipeiToday = taipeiDate();
    const want = activityRows(await db.getAll('brews'), localDate(new Date()))
      .filter((r) => r.day <= taipeiToday && r.day > addDays(taipeiToday, -WINDOW_DAYS));
    const wantByDay = new Map(want.map((r) => [r.day, r.cups]));
    const have = new Map((await cloud.listActivity(userId)).map((r) => [r.day, r.cups]));
    const upserts = want.filter((r) => have.get(r.day) !== r.cups);
    const deletes = [...have.keys()].filter((day) => !wantByDay.has(day)); // 紀錄刪了、改了日期，或滑出一年範圍
    await cloud.upsertActivity(upserts);
    await cloud.deleteActivityDays(userId, deletes);
    return { ...result, upserted: upserts.length, deleted: deletes.length };
  } catch (err) {
    if (err?.code === 'network' || err?.code === 'load') return { ...result, status: 'offline' };
    throw err;
  }
}
