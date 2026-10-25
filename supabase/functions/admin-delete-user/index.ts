// 開發者刪除別人的帳號（開發者後台）
// 1. 用 Auth 確認呼叫者是誰（JWT 無效 → 401）
// 2. 用「呼叫者的 JWT」呼叫 public.admin_begin_delete_user：資料庫檢查呼叫者在 private.admins、
//    對象不是自己也不是開發者、對象存在，並寫進 admin_audit_log（不是開發者 → 403）
// 3. 通過後才用 service_role 刪除（流程和 delete-account 相同：照片、頭像 → auth 使用者）
// service_role 只在 Supabase 自動提供的環境變數；這裡不接受、也不信任前端傳來的任何身分

import { ANON_KEY, callerId, CORS, deleteAccount, json, SUPABASE_URL, UUID } from '../_shared/account.ts';

/** 用呼叫者的 JWT 呼叫資料庫的權限檢查；回傳 null 表示通過，否則是要回給前端的 Response */
async function authorize(req: Request, userId: string, reason: string): Promise<Response | null> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_begin_delete_user`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: req.headers.get('Authorization')!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ target: userId, reason }),
  });
  if (res.ok) return null;
  const err = await res.json().catch(() => ({}));
  if (err?.code === '42501') return json(403, { error: err.hint === 'self' || err.hint === 'admin' ? err.hint : 'forbidden' });
  if (err?.code === 'P0002') return json(404, { error: 'not_found' });
  if (err?.code === '22023') return json(400, { error: 'invalid_reason' });
  console.error('admin_begin_delete_user failed', res.status, err?.code);
  return json(500, { error: 'failed' });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const actor = await callerId(req);
  if (!actor) return json(401, { error: 'unauthorized' });

  const body = await req.json().catch(() => null);
  const userId = typeof body?.userId === 'string' ? body.userId.toLowerCase() : '';
  const reason = typeof body?.reason === 'string' ? body.reason : '';
  if (!UUID.test(userId)) return json(400, { error: 'invalid_user' });

  const denied = await authorize(req, userId, reason);
  if (denied) return denied;

  try {
    await deleteAccount(userId);
  } catch (err) {
    // 紀錄已經寫了；中途失敗可以直接重試（每一步都可以重複執行）
    console.error('admin-delete-user failed', actor, userId, err);
    return json(500, { error: 'failed' });
  }
  return json(200, { deleted: true });
});
