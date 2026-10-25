// 刪除帳號共用的程式（delete-account：使用者刪自己；admin-delete-user：開發者刪別人）
// 金鑰：SUPABASE_URL、SUPABASE_ANON_KEY、SUPABASE_SERVICE_ROLE_KEY 由 Supabase 自動提供（本機與正式專案都是），不進 repo
// 不用 supabase-js：直接呼叫 REST API，沒有第三方相依
// SQL 不能直接刪 storage.objects（protect_delete trigger），所以檔案用 Storage API 刪

export const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
export const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BUCKETS = ['brew-photos', 'avatars'];
const PAGE = 1000;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// App 從 GitHub Pages（或本機）用瀏覽器呼叫，需要 CORS；權限由 JWT 決定，不靠來源
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const admin = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

/** 用呼叫者的 JWT 問 Auth 這是誰；無效、過期或沒有就回傳 null */
export async function callerId(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY, Authorization: auth } });
  if (!res.ok) return null;
  const user = await res.json();
  return typeof user?.id === 'string' && UUID.test(user.id) ? user.id : null;
}

/** 刪掉 bucket 裡 <userId>/ 底下的所有檔案（一次最多列 1000 個，刪完再列直到空） */
async function removeFolder(bucket: string, userId: string) {
  for (;;) {
    const list = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${bucket}`, {
      method: 'POST',
      headers: { ...admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: userId, limit: PAGE, offset: 0 }),
    });
    if (!list.ok) throw new Error(`list ${bucket}: ${list.status}`);
    const files: { name: string }[] = await list.json();
    if (!files.length) return;
    const del = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}`, {
      method: 'DELETE',
      headers: { ...admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: files.map((f) => `${userId}/${f.name}`) }),
    });
    if (!del.ok) throw new Error(`delete ${bucket}: ${del.status}`);
    if (files.length < PAGE) return;
  }
}

/**
 * 刪除一個帳號：Storage 的照片、頭像 → auth 使用者（資料表的外鍵都是 on delete cascade，
 * profile、紀錄、讚、留言、好友關係一起刪除）。每一步都可以重複執行，中途失敗可以直接重試
 */
export async function deleteAccount(userId: string) {
  for (const bucket of BUCKETS) await removeFolder(bucket, userId);
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: admin });
  if (!res.ok && res.status !== 404) throw new Error(`delete user: ${res.status}`);
}
