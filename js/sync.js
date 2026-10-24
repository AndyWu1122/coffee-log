// 咖啡社群的同步：本機 visibility = 'friends' 的紀錄 → 雲端 shared_brews（只由 models.js 使用）
// 不記「要做哪些動作」，而是每次比對「本機現在應該長怎樣」和 sync store 記的「上次同步的內容」，有差異就補送：
// 離線、沒登入、匯入備份、改了豆子名稱，下次同步時都會自動補上；衝突一律以本機為準（直接覆蓋雲端）
// 只刪這台裝置認得的雲端紀錄（sync store 有、或本機有這筆），別台裝置上傳的不會被誤刪
import * as db from './db.js';
import * as cloud from './cloud.js';
import { photoForUpload } from './image.js';

// supabase-js 存 session 的位置（models.js 設定的 meta key）；沒有就代表沒登入，不必載入 supabase-js
const SESSION_KEY = 'auth:supabase-auth';

/**
 * 雲端照片路徑 <user_id>/<brew_id>.jpg
 * 要和 shared_brews.photo_path 的 check 約束、Storage 政策一致（uuid 轉成文字一律小寫）
 */
export const cloudPhotoPath = (userId, brewId) => `${String(userId).toLowerCase()}/${String(brewId).toLowerCase()}.jpg`;

/** 本機紀錄 → shared_brews 的一列（豆子、磨豆機轉成名稱；owner 由資料庫用 auth.uid() 決定） */
export function toSharedRow(brew, bean, grinder, photoPath) {
  const f = brew.flavor ?? {};
  return {
    id: brew.id,
    bean_name: bean?.name ?? '',
    bean_origin: bean?.origin ?? '',
    bean_process: bean?.process ?? null,
    roast_level: bean?.roastLevel ?? null,
    roast_date: bean?.roastDate || null,
    brewed_at: brew.brewedAt,
    dripper: brew.dripper ?? '',
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
async function desired(brew, userId) {
  const [bean, grinder, photo] = await Promise.all([
    db.get('beans', brew.beanId),
    brew.grinderId ? db.get('grinders', brew.grinderId) : null,
    db.get('photos', brew.id),
  ]);
  const row = toSharedRow(brew, bean, grinder, photo ? cloudPhotoPath(userId, brew.id) : null);
  return { row, json: JSON.stringify(row), photo, photoAt: photo?.createdAt ?? null };
}

/** 本機 session 的使用者 id（只讀 IndexedDB，不載入 supabase-js、不連網路）；沒登入回傳 null */
async function sessionUserId() {
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
  if (err?.code === 'P0001') return 'rate_limited';             // 每天 30 筆
  if (/^2[23]/.test(err?.code ?? '')) return 'invalid';         // check 約束、資料格式（內容沒改就不重送）
  return 'failed';
}

/**
 * 同步一次。回傳 { status, uploaded, deleted, failed }
 * status：unavailable（沒有社群功能）、idle（沒有要同步的）、signed-out、no-profile、offline、done
 * 連不上伺服器會在途中停下（status: offline），已完成的部分會保留
 */
async function syncOnce() {
  const result = { status: 'done', uploaded: 0, deleted: 0, failed: 0 };
  if (!cloud.available) return { ...result, status: 'unavailable' };
  const [brews, states] = await Promise.all([db.getAll('brews'), db.getAll('sync')]);
  const friends = brews.filter((b) => b.visibility === 'friends');
  if (!friends.length && !states.length) return { ...result, status: 'idle' };
  if (!(await sessionUserId())) return { ...result, status: 'signed-out' };
  if (!navigator.onLine) return { ...result, status: 'offline' };

  try {
    const user = await cloud.currentUser();
    if (!user) return { ...result, status: 'signed-out' };
    if (!(await cloud.getMyProfile(user.id))) return { ...result, status: 'no-profile' };

    // 換了帳號登入：上一個帳號的同步紀錄不再有效（那些雲端紀錄這個帳號也刪不到）
    const known = new Map();
    for (const s of states) {
      if (s.userId === user.id) known.set(s.brewId, s);
      else await db.remove('sync', s.brewId);
    }
    const remote = new Map((await cloud.listMySharedBrews(user.id)).map((r) => [r.id, r]));
    const localIds = new Set(brews.map((b) => b.id));
    const friendIds = new Set(friends.map((b) => b.id));

    // 1. 改回 private 或已刪除的：先刪紀錄（好友立刻讀不到），再用 Storage API 刪照片
    const toDelete = new Set([...remote.keys(), ...known.keys()]);
    for (const id of toDelete) {
      if (friendIds.has(id) || !(known.has(id) || localIds.has(id))) continue;
      const st = known.get(id);
      try {
        if (remote.has(id)) await cloud.deleteSharedBrew(user.id, id);
        if (remote.get(id)?.photo_path || st?.photoAt) await cloud.removeBrewPhotos([cloudPhotoPath(user.id, id)]);
        await db.remove('sync', id);
        result.deleted++;
      } catch (err) {
        if (err.code === 'network') throw err;
        // 留下同步紀錄，下次再試（照片時間設成非空，確保會再刪一次照片）
        await db.put('sync', { brewId: id, userId: user.id, row: null, photoAt: st?.photoAt ?? 'unknown', error: 'failed', failedRow: null });
        result.failed++;
      }
    }

    // 2. 新增或修改：新的先送（遇到每天的上限時，最近的紀錄先分享出去）
    let insertBlocked = false;
    for (const brew of [...friends].sort((a, b) => b.brewedAt.localeCompare(a.brewedAt))) {
      const st = known.get(brew.id);
      const d = await desired(brew, user.id);
      const exists = remote.has(brew.id);
      const remotePhoto = remote.get(brew.id)?.photo_path ?? null;
      if (exists && !st?.error && st?.row === d.json && st.photoAt === d.photoAt) continue; // 已同步
      if (st?.error === 'invalid' && st.failedRow === d.json) continue;                       // 內容沒改，送了也會被拒絕
      if (!exists && st?.error === 'rate_limited' && st.failedOn === taipeiDate()) insertBlocked = true; // 今天已經撞到上限
      const fail = async (error) => {
        await db.put('sync', {
          ...(st ?? { row: null, photoAt: null }), brewId: brew.id, userId: user.id, error, failedRow: d.json, failedOn: taipeiDate(),
        });
        result.failed++;
      };
      if (!exists && insertBlocked) { await fail('rate_limited'); continue; }
      try {
        // 先寫紀錄、再傳照片（Storage 政策要求 photo_path 已經指向這個路徑）
        if (exists) {
          if (!(await cloud.updateSharedBrew(user.id, d.row))) throw new cloud.CloudError('紀錄不存在', 'gone');
        } else {
          await cloud.insertSharedBrew(d.row);
        }
        const photoPath = cloudPhotoPath(user.id, brew.id);
        if (d.photo && (!exists || st?.photoAt !== d.photoAt || remotePhoto !== d.row.photo_path)) {
          await cloud.uploadBrewPhoto(photoPath, await photoForUpload(d.photo.blob));
        } else if (!d.photo && (remotePhoto || st?.photoAt)) {
          await cloud.removeBrewPhotos([photoPath]); // photo_path 已經是 null，好友已經讀不到
        }
        await db.put('sync', { brewId: brew.id, userId: user.id, row: d.json, photoAt: d.photoAt, error: '', failedRow: null });
        result.uploaded++;
      } catch (err) {
        if (err.code === 'network') throw err;
        const reason = failureReason(err);
        if (reason === 'rate_limited') insertBlocked = true;
        if (reason === 'failed') console.warn('同步失敗', brew.id, err);
        await fail(reason);
      }
    }
  } catch (err) {
    if (err?.code === 'network' || err?.code === 'load') return { ...result, status: 'offline' };
    throw err;
  }
  return result;
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
      } while (again);
      return last;
    } finally {
      running = null;
    }
  })();
  return running;
}

/**
 * 一筆紀錄的分享狀態（只讀本機，不連網路）：
 * off（只有我）、signed-out（沒登入）、synced（已分享）、pending（等待上傳）、
 * rate_limited（今天的額度用完）、invalid（內容不符合雲端的限制）、failed（上傳失敗，會再試）
 */
export async function brewStatus(brew) {
  if (brew?.visibility !== 'friends') return 'off';
  const userId = await sessionUserId();
  if (!userId) return 'signed-out';
  const st = await db.get('sync', brew.id);
  if (!st || st.userId !== userId) return 'pending';
  const d = await desired(brew, userId);
  if (st.error && st.failedRow === d.json) return st.error;
  return !st.error && st.row === d.json && st.photoAt === d.photoAt ? 'synced' : 'pending';
}
