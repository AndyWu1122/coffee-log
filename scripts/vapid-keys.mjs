// 產生正式專案推播通知用的金鑰（站長在自己的電腦執行；私鑰不要貼給任何人，包括 Claude）
// 寫出兩個檔案（都被 .gitignore 的 .env.* 排除，不會進 repo），設定完就刪掉：
//   .env.push      → npx supabase@2.120.0 secrets set --env-file .env.push
//                    （VAPID_PUBLIC_KEY、VAPID_PRIVATE_KEY、VAPID_SUBJECT、PUSH_WEBHOOK_SECRET）
//   .env.push.sql  → 貼到 Supabase 後台的 SQL Editor 執行（vault 的 send_push_url、push_webhook_secret）
// 畫面上只印出公鑰（公開的，填進 js/config.js 的 PRODUCTION.vapidPublicKey）
// 步驟見 docs/supabase-setup.md 5-6
//
// 用法：node scripts/vapid-keys.mjs 你的信箱@gmail.com

import { createECDH, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_URL = 'https://rygsjrzddhhhdqpoayoa.supabase.co';
const envFile = path.join(root, '.env.push');
const sqlFile = path.join(root, '.env.push.sql');

const email = process.argv[2] ?? '';
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('用法：node scripts/vapid-keys.mjs 你的信箱@gmail.com');
  console.error('（推播服務在有問題時用這個信箱聯絡你；不會出現在通知裡）');
  process.exit(1);
}
if (existsSync(envFile) || existsSync(sqlFile)) {
  console.error('.env.push 或 .env.push.sql 已經存在：設定完請先刪掉，或確認不再需要後刪掉再執行');
  console.error('（重新產生金鑰後，所有裝置要重新「啟用通知」一次）');
  process.exit(1);
}

const ecdh = createECDH('prime256v1');
ecdh.generateKeys();
const publicKey = ecdh.getPublicKey().toString('base64url');
const privateKey = ecdh.getPrivateKey().toString('base64url');
const secret = randomBytes(32).toString('hex');

await writeFile(envFile, [
  `VAPID_PUBLIC_KEY=${publicKey}`,
  `VAPID_PRIVATE_KEY=${privateKey}`,
  `VAPID_SUBJECT=mailto:${email}`,
  `PUSH_WEBHOOK_SECRET=${secret}`,
  '',
].join('\n'), { mode: 0o600 });

await writeFile(sqlFile, [
  '-- 推播通知：資料庫 trigger 呼叫 send-push 的網址與簽章用的密鑰（和 PUSH_WEBHOOK_SECRET 相同）',
  '-- 貼到 Supabase 後台 → SQL Editor 執行；執行完刪掉這個檔案',
  "delete from vault.secrets where name in ('send_push_url', 'push_webhook_secret');",
  `select vault.create_secret('${PROJECT_URL}/functions/v1/send-push', 'send_push_url');`,
  `select vault.create_secret('${secret}', 'push_webhook_secret');`,
  '',
].join('\n'), { mode: 0o600 });

console.log('已產生：');
console.log(`  ${envFile}（私鑰、密鑰：不要貼給任何人）`);
console.log(`  ${sqlFile}（密鑰：只貼到 Supabase 的 SQL Editor）`);
console.log('');
console.log('VAPID 公鑰（公開的，填進 js/config.js 的 PRODUCTION.vapidPublicKey，可以給 Claude）：');
console.log(`  ${publicKey}`);
console.log('');
console.log('下一步見 docs/supabase-setup.md 5-6');
