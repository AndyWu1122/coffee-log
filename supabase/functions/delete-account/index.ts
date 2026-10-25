// 刪除我的帳號（咖啡社群 階段 5）
// 只能刪「呼叫者自己」：身分一律由 Auth 驗證呼叫者的 JWT 得到，不接受任何 user id 參數
// 刪除流程（照片、頭像 → auth 使用者）在 ../_shared/account.ts，和開發者刪帳號（admin-delete-user）共用

import { callerId, CORS, deleteAccount, json } from '../_shared/account.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const userId = await callerId(req);
  if (!userId) return json(401, { error: 'unauthorized' });

  try {
    await deleteAccount(userId);
  } catch (err) {
    console.error('delete-account failed', userId, err);
    return json(500, { error: 'failed' });
  }
  return json(200, { deleted: true });
});
