// 推播通知：有人留言我的貼文、回覆我的留言（由資料庫 trigger private.comments_push 透過 pg_net 呼叫）
// 通知誰、封鎖、偏好、5 分鐘合併都已經在資料庫判斷好；這裡只負責「讀訂閱 → 加密 → 送出 → 清掉過期的」
//
// 身分：呼叫者是資料庫，不是使用者（config.toml 的 verify_jwt = false）
//   一律檢查 x-push-signature ＝ 內容的 HMAC-SHA256（金鑰 PUSH_WEBHOOK_SECRET，資料庫那邊存在 vault），而且內容的 sent_at 在 2 分鐘內；
//   不對就 401：一般使用者拿 JWT 或 anon key 都呼叫不了（密鑰本身不會出現在請求裡）
// 金鑰：SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY 由 Supabase 自動提供；
//   正式專案的 VAPID_PUBLIC_KEY、VAPID_PRIVATE_KEY、VAPID_SUBJECT、PUSH_WEBHOOK_SECRET 用 `supabase secrets set` 設定（不進 repo）
// 本機（supabase start）不讀任何設定：用下面本機測試用的金鑰，而且所有推播一律送到測試腳本開的假推播伺服器
//   （port 54398，保留路徑），本機絕對不會連到真的推播服務
// ⚠ 不要用 config.toml 的 [edge_runtime.secrets]：`supabase secrets set` 會把它一起上傳到正式專案
//
// 推播內容只有 { v, kind, nickname, owner, brewId }：不含留言原文；點擊的網址由 sw.js 驗證 uuid 後自己組
// log 只記數量與狀態碼（沒送出時寫原因），不記 endpoint、金鑰
import { ENDPOINT, pushRequest, topicFor, vapidConfig } from '../_shared/webpush.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// 正式專案的網址是 https://<ref>.supabase.co；本機是 http://kong:8000 之類
const LOCAL = !new URL(SUPABASE_URL).hostname.endsWith('.supabase.co');

// 本機測試用（公開的，和 js/config.js 的 LOCAL.vapidPublicKey 是同一組）：只在本機、只送到假推播伺服器
const LOCAL_VAPID = {
  publicKey: 'BLB8xISVwsudCQHkIqTCHD6wXCj_aQtohBMMge9PDf9cRImVMYN19IAhz5iscwu_riTKEk1hIiKQstaO2vliO-g',
  privateKey: 'Ka74bLPnWHTLH-BKFBBnVQpa50WJ8D376h19RonUCj4',
  subject: 'mailto:developer@test.local',
};
const LOCAL_SECRET = 'local-push-secret';
const FAKE_PUSH = 'http://host.docker.internal:54398';

const SECRET = LOCAL ? LOCAL_SECRET : (Deno.env.get('PUSH_WEBHOOK_SECRET') ?? '').trim();
const VAPID = await vapidConfig(LOCAL ? LOCAL_VAPID : {
  publicKey: Deno.env.get('VAPID_PUBLIC_KEY'),
  privateKey: Deno.env.get('VAPID_PRIVATE_KEY'),
  subject: Deno.env.get('VAPID_SUBJECT'),
  localPublicKey: LOCAL_VAPID.publicKey,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KINDS = new Set(['comment', 'reply']);
const admin = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const MAX_AGE_S = 120;

/** x-push-signature 是 body 的 HMAC-SHA256（hex）；crypto.subtle.verify 的比對時間和內容無關 */
async function signedBy(secret: string, body: string, signature: string) {
  if (!secret || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const sig = Uint8Array.from(signature.match(/../g)!, (h) => parseInt(h, 16));
  return crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(body));
}

type Job = { owner: string; brewId: string; nickname: string; recipients: { userId: string; kind: string }[] };

/** 驗證 trigger 送來的內容；不合格回傳 null */
function parse(body: unknown): Job | null {
  const b = body as { brew_owner?: unknown; brew_id?: unknown; actor_nickname?: unknown; recipients?: unknown; sent_at?: unknown } | null;
  // 太舊的（被重送的）不收：同一則通知不能被拿來一直重送
  if (typeof b?.sent_at !== 'number' || Math.abs(Date.now() / 1000 - b.sent_at) > MAX_AGE_S) return null;
  if (typeof b.brew_owner !== 'string' || !UUID.test(b.brew_owner)) return null;
  if (typeof b.brew_id !== 'string' || !UUID.test(b.brew_id)) return null;
  if (!Array.isArray(b.recipients) || b.recipients.length < 1 || b.recipients.length > 3) return null;
  const recipients = [];
  for (const r of b.recipients as { user_id?: unknown; kind?: unknown }[]) {
    if (typeof r?.user_id !== 'string' || !UUID.test(r.user_id) || typeof r.kind !== 'string' || !KINDS.has(r.kind)) return null;
    recipients.push({ userId: r.user_id, kind: r.kind });
  }
  // 暱稱 ≤ 20 字（資料庫的 check）；這裡只再截一次，顯示時 sw.js 也會清理
  const nickname = typeof b.actor_nickname === 'string' ? [...b.actor_nickname].slice(0, 20).join('') : '';
  return { owner: b.brew_owner, brewId: b.brew_id, nickname, recipients };
}

type Row = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };

/** 送一個裝置；回傳 'sent' | 'expired'（已刪除訂閱）| 'failed' */
async function deliver(sub: Row, payload: string, topic: string): Promise<'sent' | 'expired' | 'failed'> {
  if (!VAPID.ok) return 'failed';
  try {
    const { headers, body } = await pushRequest(sub, payload, VAPID, { topic });
    const url = LOCAL ? FAKE_PUSH + new URL(sub.endpoint).pathname : sub.endpoint;
    const res = await fetch(url, { method: 'POST', headers, body });
    await res.body?.cancel();
    if (res.status === 404 || res.status === 410) {
      // 推播服務說這個訂閱已經不存在（解除安裝、清除網站資料、關掉通知）：刪掉
      await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?id=eq.${sub.id}`, { method: 'DELETE', headers: admin });
      return 'expired';
    }
    if (!res.ok) {
      console.error(`[send-push] 推播服務回傳 ${res.status}`);
      return 'failed';
    }
    return 'sent';
  } catch (err) {
    console.error(`[send-push] 送出失敗：${(err as Error)?.name ?? 'Error'}`);
    return 'failed';
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  if (!SECRET) console.error('[send-push] 沒有送出：沒有設定 PUSH_WEBHOOK_SECRET');
  const raw = await req.text();
  if (!await signedBy(SECRET, raw, req.headers.get('x-push-signature') ?? '')) return json(401, { error: 'unauthorized' });

  const job = parse((() => { try { return JSON.parse(raw); } catch { return null; } })());
  if (!job) return json(400, { error: 'invalid' });
  if (!VAPID.ok) {
    console.error(`[send-push] 沒有送出：${VAPID.reason}`);
    return json(503, { error: 'not_configured' });
  }

  const ids = job.recipients.map((r) => r.userId).join(',');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?select=id,user_id,endpoint,p256dh,auth&user_id=in.(${ids})`, { headers: admin });
  if (!res.ok) {
    console.error(`[send-push] 讀不到訂閱：${res.status}`);
    return json(500, { error: 'failed' });
  }
  const subs = (await res.json() as Row[]).filter((s) => ENDPOINT.test(s.endpoint));
  const kindOf = new Map(job.recipients.map((r) => [r.userId, r.kind]));

  // 同一篇貼文同一個 tag：sw.js 顯示時取代舊的通知，推播服務裡還沒送達的也被取代
  const topic = await topicFor(`post:${job.owner}/${job.brewId}`);
  const results = await Promise.all(subs.map((s) => deliver(s, JSON.stringify({
    v: 1, kind: kindOf.get(s.user_id), nickname: job.nickname, owner: job.owner, brewId: job.brewId,
  }), topic)));

  const count = (r: string) => results.filter((x) => x === r).length;
  const summary = { sent: count('sent'), expired: count('expired'), failed: count('failed') };
  console.log(`[send-push] 送出 ${summary.sent}、過期刪除 ${summary.expired}、失敗 ${summary.failed}`);
  return json(200, summary);
});
