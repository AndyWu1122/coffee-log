// 意見回饋 Email 的純函式（不用 Deno API）：寄信前檢查設定、把 Resend 的錯誤翻成看得懂的原因
// index.ts 使用；scripts/feedback-mail-test.mjs 直接用 Node 載入測試（只用 Node 能剝除的型別語法）
//
// 寫進 function log 的訊息一律經過 mask()：不會出現 RESEND_API_KEY

export type MailConfig =
  | { ok: true; apiKey: string; to: string }
  | { ok: false; reason: string };

// 本機測試用的假值。曾經被 config.toml 的 [edge_runtime.secrets] 隨 `supabase secrets set` 上傳到正式專案
const FAKE_KEYS = ['local-test-key'];
const FAKE_DOMAIN = /[@.]test\.local$/i;
const EMAIL = /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[^\s@,;<>"']+$/;

/** 去掉前後空白與成對的引號（`secrets set FEEDBACK_TO="a@b.c"` 在某些 shell 會把引號一起存進去） */
export function clean(value: string | undefined | null): string {
  let s = String(value ?? '').trim();
  while (s.length >= 2 && /^(["']).*\1$/s.test(s)) s = s.slice(1, -1).trim();
  return s;
}

/**
 * 寄信需要的設定；不完整時回傳 { ok: false, reason }（reason 寫進 log，不含金鑰）
 * local：本機（supabase start）一律用假 Resend，允許假值
 */
export function mailConfig({ apiKey, to, local = false }: { apiKey?: string | null; to?: string | null; local?: boolean }): MailConfig {
  const key = clean(apiKey);
  const address = clean(to);
  if (!key) return { ok: false, reason: '沒有設定 RESEND_API_KEY（npx supabase secrets set RESEND_API_KEY=re_...）' };
  if (!address) return { ok: false, reason: '沒有設定 FEEDBACK_TO（npx supabase secrets set FEEDBACK_TO=你的 email）' };
  if (!local && (FAKE_KEYS.includes(key) || FAKE_DOMAIN.test(address))) {
    return { ok: false, reason: 'RESEND_API_KEY 或 FEEDBACK_TO 是本機測試用的假值（被 config.toml 蓋掉過），請重新 secrets set 真的值' };
  }
  if (!local && !key.startsWith('re_')) return { ok: false, reason: 'RESEND_API_KEY 格式不對：Resend 的 API key 應該是 re_ 開頭' };
  if (!EMAIL.test(address)) return { ok: false, reason: `FEEDBACK_TO 不是一個 email 地址：「${mask(address, [key])}」` };
  return { ok: true, apiKey: key, to: address };
}

/** 把文字裡的金鑰換掉（保險：Resend 的錯誤訊息理論上不會帶回金鑰） */
export function mask(text: string, secrets: string[]): string {
  let out = String(text);
  for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join('[已遮蔽]');
  return out;
}

// Resend 的錯誤 name → 原因（https://resend.com/docs/api-reference/errors）
const RESEND_REASONS: Record<string, string> = {
  missing_api_key: '沒有帶 API key',
  invalid_api_key: 'API key 無效（被刪除或打錯）：到 Resend 後台重新建立，再 secrets set RESEND_API_KEY',
  restricted_api_key: '這把 API key 沒有寄信權限：建立時要選 Sending access',
  invalid_from_address: '寄件人格式不對',
  invalid_to_address: '收件人（FEEDBACK_TO）格式不對',
  rate_limit_exceeded: '短時間寄太多封，被 Resend 限流',
  daily_quota_exceeded: '超過 Resend 免費方案每天的寄信額度',
  monthly_quota_exceeded: '超過 Resend 免費方案每月的寄信額度',
};

/** Resend 回傳錯誤時，寫進 log 的說明（含 HTTP 狀態、Resend 的 name 與原文 message；不含金鑰） */
export function describeResendError(status: number, bodyText: string, apiKey = ''): string {
  let body: { name?: unknown; message?: unknown } | null = null;
  try { body = JSON.parse(bodyText); } catch { /* 不是 JSON */ }
  const name = typeof body?.name === 'string' ? body.name : '';
  const message = typeof body?.message === 'string' ? body.message : String(bodyText ?? '');
  let reason = RESEND_REASONS[name] ?? '';
  // 免費方案沒有驗證網域：只能寄到註冊 Resend 的那個 email
  if (/own email|testing emails|verify a domain/i.test(message)) {
    reason = 'Resend 免費方案只能寄給「註冊 Resend 的那個 email」：FEEDBACK_TO 必須和 Resend 帳號的 email 一字不差';
  }
  if (!reason) {
    reason = status === 401 || status === 403 ? 'API key 被拒絕'
      : status === 422 ? '寄信內容格式不對'
      : status === 429 ? '寄太多封，被限流或超過額度'
      : status >= 500 ? 'Resend 伺服器錯誤，稍後會恢復'
      : '寄信失敗';
  }
  const detail = [...message].slice(0, 300).join('');
  return mask(`Resend 回傳 ${status}${name ? `（${name}）` : ''}：${reason}。Resend 原文：${detail}`, [apiKey]);
}

/** 連不上 Resend（DNS、逾時等）時，寫進 log 的說明 */
export function describeNetworkError(err: unknown, apiKey = ''): string {
  const e = err as { name?: unknown; message?: unknown } | null;
  return mask(`連不上 Resend：${String(e?.name ?? 'Error')}：${String(e?.message ?? err)}`, [apiKey]);
}
