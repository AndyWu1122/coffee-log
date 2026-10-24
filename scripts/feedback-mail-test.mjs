// 意見回饋 Email 的設定檢查與錯誤說明（supabase/functions/feedback/mail.ts）
// 不需要 Supabase：Node（≥ 22.18／23.6，可直接載入 .ts）直接 import 純函式測試
// 確認：設定缺漏、假值、格式錯誤都有看得懂的原因；Resend 的各種錯誤翻成中文；log 裡不會出現金鑰
//
// 用法：node scripts/feedback-mail-test.mjs

import { mailConfig, describeResendError, describeNetworkError, clean } from '../supabase/functions/feedback/mail.ts';

let passed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) passed++;
  else failures.push(name);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

const KEY = 're_SECRETabc123456789';
const reason = (cfg) => (cfg.ok ? '' : cfg.reason);

/* ===== 設定 ===== */
const good = mailConfig({ apiKey: KEY, to: 'me@gmail.com' });
check('設定正確：ok', good.ok && good.apiKey === KEY && good.to === 'me@gmail.com');
check('沒有 RESEND_API_KEY', reason(mailConfig({ apiKey: undefined, to: 'me@gmail.com' })).includes('沒有設定 RESEND_API_KEY'));
check('RESEND_API_KEY 是空字串', reason(mailConfig({ apiKey: '  ', to: 'me@gmail.com' })).includes('沒有設定 RESEND_API_KEY'));
check('沒有 FEEDBACK_TO', reason(mailConfig({ apiKey: KEY, to: undefined })).includes('沒有設定 FEEDBACK_TO'));
check('正式環境是本機假 key：指出被 config.toml 蓋掉', reason(mailConfig({ apiKey: 'local-test-key', to: 'me@gmail.com' })).includes('假值'));
check('正式環境是本機假收件人：指出被 config.toml 蓋掉', reason(mailConfig({ apiKey: KEY, to: 'developer@test.local' })).includes('假值'));
check('本機允許假值', mailConfig({ apiKey: 'local-test-key', to: 'developer@test.local', local: true }).ok);
check('API key 不是 re_ 開頭', reason(mailConfig({ apiKey: 'sk_live_xxx', to: 'me@gmail.com' })).includes('re_ 開頭'));
const notEmail = reason(mailConfig({ apiKey: KEY, to: 'me@gmail' }));
check('FEEDBACK_TO 不是 email：顯示寫了什麼', notEmail.includes('不是一個 email') && notEmail.includes('me@gmail'), notEmail);
check('FEEDBACK_TO 有兩個地址：拒絕', !mailConfig({ apiKey: KEY, to: 'a@gmail.com,b@gmail.com' }).ok);
const quoted = mailConfig({ apiKey: ` "${KEY}" `, to: "'me@gmail.com'\n" });
check('去掉前後空白、換行與引號', quoted.ok && quoted.apiKey === KEY && quoted.to === 'me@gmail.com', JSON.stringify(quoted));
check('clean：只去掉成對的引號', clean('"abc') === '"abc' && clean('"abc"') === 'abc');
check('設定的原因都不含金鑰', [
  mailConfig({ apiKey: KEY, to: 'x' }), mailConfig({ apiKey: KEY, to: `${KEY}@x` }),
].every((c) => !reason(c).includes(KEY)));

/* ===== Resend 的錯誤 ===== */
const own = describeResendError(403, JSON.stringify({
  statusCode: 403, name: 'validation_error',
  message: 'You can only send testing emails to your own email address (owner@gmail.com). To send emails to other recipients, please verify a domain at resend.com/domains, and change the `from` address to an email using this domain.',
}), KEY);
check('403 只能寄給自己：說明 FEEDBACK_TO 要和 Resend 帳號 email 一樣', own.includes('一字不差') && own.includes('403') && own.includes('owner@gmail.com'), own);
const invalidKey = describeResendError(403, JSON.stringify({ statusCode: 403, name: 'invalid_api_key', message: 'API key is invalid' }), KEY);
check('invalid_api_key：說明 key 無效', invalidKey.includes('API key 無效'), invalidKey);
check('restricted_api_key：說明要 Sending access',
  describeResendError(401, JSON.stringify({ name: 'restricted_api_key', message: 'x' })).includes('Sending access'));
check('daily_quota_exceeded：說明超過額度',
  describeResendError(429, JSON.stringify({ name: 'daily_quota_exceeded', message: 'x' })).includes('每天'));
check('不是 JSON 的錯誤：照樣有狀態碼與原文', describeResendError(502, '<html>Bad Gateway</html>').includes('502'));
const echoed = describeResendError(401, JSON.stringify({ name: 'invalid_api_key', message: `bad key ${KEY}` }), KEY);
check('Resend 原文帶回金鑰時遮蔽', !echoed.includes(KEY) && echoed.includes('[已遮蔽]'), echoed);
check('原文太長時截斷', describeResendError(500, 'x'.repeat(5000)).length < 500);
const net = describeNetworkError(new TypeError(`fetch failed for ${KEY}`), KEY);
check('連不上 Resend：說明原因、遮蔽金鑰', net.includes('連不上 Resend') && !net.includes(KEY), net);

console.log(`\n${passed}/${passed + failures.length} 通過`);
process.exitCode = failures.length ? 1 : 0;
