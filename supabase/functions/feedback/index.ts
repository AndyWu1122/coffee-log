// 意見回饋（☰ →「意見回饋」）：存進 public.feedback，再寄 Email 通知站長
// 身分：用呼叫者的 JWT 寫入資料表（RLS 要求 author = auth.uid()，每天 5 則由 trigger 強制），不接受任何 user id 參數
// 先存檔再寄信：寄信失敗不影響回饋（站長在 Supabase 後台的 Table Editor 看得到全部）
//
// 金鑰：SUPABASE_URL、SUPABASE_ANON_KEY 由 Supabase 自動提供；
// 正式專案的 RESEND_API_KEY、FEEDBACK_TO 用 `supabase secrets set` 設定（不進 repo），沒設定時只存檔、不寄信
// 本機（supabase start）不讀任何設定，一律寄到測試腳本開的假 Resend（scripts/social-feedback-test.mjs，port 54399）
// ⚠ 不要用 config.toml 的 [edge_runtime.secrets]：`supabase secrets set` 會把它一起上傳到正式專案
// 不用 supabase-js：直接呼叫 REST API，沒有第三方相依
//
// 沒寄出信時，function log（Supabase 後台 → Edge Functions → feedback → Logs）一定有一行 [feedback] 說明原因（不含金鑰）
import { mailConfig, describeResendError, describeNetworkError } from './mail.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
// 正式專案的網址是 https://<ref>.supabase.co；本機是 http://kong:8000 之類
const LOCAL = !new URL(SUPABASE_URL).hostname.endsWith('.supabase.co');
const RESEND_API_URL = LOCAL ? 'http://host.docker.internal:54399/emails' : 'https://api.resend.com/emails';
const MAIL = LOCAL
  ? mailConfig({ apiKey: 'local-test-key', to: 'developer@test.local', local: true })
  : mailConfig({ apiKey: Deno.env.get('RESEND_API_KEY'), to: Deno.env.get('FEEDBACK_TO') });
// Resend 免費方案不用自己的網域：從 onboarding@resend.dev 只能寄給註冊 Resend 的那個 email（就是站長自己）
const FROM = '手沖紀錄 <onboarding@resend.dev>';

const CATEGORIES: Record<string, string> = { bug: '問題回報', idea: '功能建議', other: '其他' };
const MESSAGE_MAX = 1000; // 和 public.feedback 的 check 一致
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// App 從 GitHub Pages（或本機）用瀏覽器呼叫，需要 CORS；權限由 JWT 決定，不靠來源
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/** 用呼叫者的 JWT 問 Auth 這是誰；無效、過期或沒有就回傳 null */
async function callerId(auth: string): Promise<string | null> {
  if (!auth.startsWith('Bearer ')) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY, Authorization: auth } });
  if (!res.ok) return null;
  const user = await res.json();
  return typeof user?.id === 'string' && UUID.test(user.id) ? user.id : null;
}

/** 以呼叫者的身分呼叫 PostgREST（RLS 照常生效） */
const asCaller = (auth: string, path: string, init: RequestInit = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: ANON_KEY, Authorization: auth, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });

/**
 * App 版本號 → 字串：'1.2.3'（sw.js 的 APP_VERSION）；舊版 App 送的是整數 CACHE_VERSION，轉成 '18'
 * 格式不對就當作不明（null），不擋下回饋；和資料庫的 feedback_app_version_format 一致
 */
function toAppVersion(v: unknown): string | null {
  if (typeof v === 'string' && /^(\d{1,4}\.\d{1,4}\.\d{1,4}|[1-9]\d{0,6})$/.test(v)) return v;
  if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 1000000) return String(v);
  return null;
}

/** 驗證內容；不合格回傳 null（資料庫也會再檢查一次） */
function parse(body: unknown) {
  const b = body as { category?: unknown; message?: unknown; appVersion?: unknown } | null;
  const category = typeof b?.category === 'string' && Object.hasOwn(CATEGORIES, b.category) ? b.category : null;
  const message = typeof b?.message === 'string' ? b.message.trim() : '';
  const length = [...message].length;
  const appVersion = toAppVersion(b?.appVersion);
  if (!category || length < 1 || length > MESSAGE_MAX) return null;
  return { category, message, appVersion };
}

/** 主旨只放一行：去掉換行等控制字元，太長截斷 */
const subjectLine = (s: string) => {
  const line = s.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim();
  return [...line].length > 40 ? `${[...line].slice(0, 40).join('')}…` : line;
};

/** 寄 Email 給站長（純文字，不用 HTML：回饋內容不會被當成 HTML）；回傳有沒有寄出 */
async function notify(f: { category: string; message: string; appVersion: string | null }, userId: string, nickname: string) {
  if (!MAIL.ok) {
    console.error(`[feedback] 沒有寄信：${MAIL.reason}`);
    return false;
  }
  const text = [
    `類型：${CATEGORIES[f.category]}`,
    `暱稱：${nickname || '（不明）'}`,
    `使用者 id：${userId}`,
    `App 版本：${f.appVersion ?? '（不明）'}`,
    `時間：${new Date().toISOString()}`,
    '',
    f.message,
    '',
    '—',
    '全部回饋在 Supabase 後台 → Table Editor → feedback',
  ].join('\n');
  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${MAIL.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [MAIL.to],
        subject: `[手沖紀錄] ${CATEGORIES[f.category]}：${subjectLine(f.message)}`,
        text,
      }),
    });
    const body = await res.text();
    if (!res.ok) {
      console.error(`[feedback] 沒有寄信：${describeResendError(res.status, body, MAIL.apiKey)}`);
      return false;
    }
    // Resend 後台 → Emails 可以用這個 id 查寄送狀態（送達、退信、被當垃圾信）
    const id = (() => { try { return JSON.parse(body)?.id; } catch { return null; } })();
    console.log(`[feedback] 已交給 Resend 寄出（id ${id ?? '不明'}，收件人 ${MAIL.to}）`);
    return true;
  } catch (err) {
    console.error(`[feedback] 沒有寄信：${describeNetworkError(err, MAIL.apiKey)}`);
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const auth = req.headers.get('Authorization') ?? '';
  const userId = await callerId(auth);
  if (!userId) return json(401, { error: 'unauthorized' });

  const f = parse(await req.json().catch(() => null));
  if (!f) return json(400, { error: 'invalid' });

  // 1. 存檔（以呼叫者的身分；沒有讀取權限，所以用 return=minimal）
  const insert = await asCaller(auth, 'feedback', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ category: f.category, message: f.message, app_version: f.appVersion }),
  });
  if (!insert.ok) {
    const code = (await insert.json().catch(() => null))?.code;
    if (code === 'P0001') return json(429, { error: 'rate_limited' });
    if (code === '23503') return json(400, { error: 'no_profile' });
    if (code === '23514') return json(400, { error: 'invalid' });
    console.error('feedback insert failed', insert.status, code);
    return json(500, { error: 'failed' });
  }

  // 2. 寄信（失敗也回傳成功：回饋已經存好了）
  const profile = await asCaller(auth, `profiles?select=nickname&id=eq.${userId}`).then((r) => (r.ok ? r.json() : []));
  const notified = await notify(f, userId, profile?.[0]?.nickname ?? '');
  return json(200, { ok: true, notified });
});
