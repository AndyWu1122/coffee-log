// Web Push 的加密與 VAPID 簽章（supabase/functions/_shared/webpush.ts）
// 不需要 Supabase：Node（≥ 22.18／23.6，可直接載入 .ts）用 webpush.ts 加密，再用 node:crypto 另外寫的解密驗證
// （兩邊不共用程式，避免同一個錯誤兩邊都看不出來）
//
// 用法：node scripts/webpush-test.mjs

import { createECDH } from 'node:crypto';
import { browserKeys, decrypt, verifyVapid } from './push-helpers.mjs';
import {
  encryptPayload, vapidAuthorization, vapidConfig, pushRequest, topicFor, ENDPOINT, b64urlEncode, b64urlDecode,
} from '../supabase/functions/_shared/webpush.ts';

let passed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) passed++;
  else failures.push(name);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

function vapidPair() {
  const e = createECDH('prime256v1');
  e.generateKeys();
  return { publicKey: e.getPublicKey().toString('base64url'), privateKey: e.getPrivateKey().toString('base64url'), subject: 'mailto:me@example.com' };
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('webpush-test.mjs')) {
  /* ===== base64url ===== */
  const sample = Uint8Array.from({ length: 70 }, (_, i) => (i * 37) & 255);
  check('base64url 來回一致、沒有 = + /', b64urlEncode(sample) === Buffer.from(sample).toString('base64url'));
  check('base64url 解碼', Buffer.from(b64urlDecode(Buffer.from(sample).toString('base64url'))).equals(Buffer.from(sample)));

  /* ===== 加密：Node 解得開 ===== */
  const ua = browserKeys();
  const text = JSON.stringify({ v: 1, kind: 'comment', nickname: '小明☕', owner: 'x', brewId: 'y' });
  const body = await encryptPayload(ua.p256dh, ua.auth, text);
  const d = decrypt(body, ua);
  check('解密後內容一致（含中文、emoji）', d.text === text, d.text);
  check('record size 4096、idlen 65、結尾是 0x02', d.rs === 4096 && d.idlen === 65 && d.delimiterOk);
  const body2 = await encryptPayload(ua.p256dh, ua.auth, text);
  check('每次加密的 salt 與臨時金鑰都不同', !Buffer.from(body).subarray(0, 86).equals(Buffer.from(body2).subarray(0, 86)));
  let wrongKey = false;
  try { decrypt(body, browserKeys()); } catch { wrongKey = true; }
  check('別人的金鑰解不開', wrongKey);
  const tampered = Buffer.from(body);
  tampered[tampered.length - 1] ^= 1;
  let tamperFail = false;
  try { decrypt(tampered, ua); } catch { tamperFail = true; }
  check('被改過的內容解不開（GCM 驗證失敗）', tamperFail);

  /* ===== VAPID ===== */
  const vapid = vapidPair();
  const cfg = await vapidConfig(vapid);
  check('VAPID 設定正確：ok', cfg.ok === true, cfg.reason);
  const endpoint = 'https://fcm.googleapis.com/fcm/send/abc:def';
  const now = Date.now();
  const v = verifyVapid(await vapidAuthorization(endpoint, cfg, now), vapid.publicKey);
  check('VAPID 簽章驗證通過', v.ok);
  check('aud 是推播服務的 origin', v.claims?.aud === 'https://fcm.googleapis.com', v.claims?.aud);
  check('exp 是 12 小時後（≤ 24 小時）', v.claims?.exp === Math.floor(now / 1000) + 12 * 3600);
  check('sub 是 VAPID_SUBJECT', v.claims?.sub === vapid.subject);
  check('別人的公鑰驗證不過', !verifyVapid(await vapidAuthorization(endpoint, cfg), vapidPair().publicKey).ok);

  const reason = async (o) => { const c = await vapidConfig(o); return c.ok ? '' : c.reason; };
  check('沒有私鑰', (await reason({ ...vapid, privateKey: '' })).includes('VAPID_PRIVATE_KEY'));
  check('沒有 subject', (await reason({ ...vapid, subject: undefined })).includes('VAPID_SUBJECT'));
  check('subject 不是 mailto/https', (await reason({ ...vapid, subject: 'me@example.com' })).includes('mailto'));
  check('公鑰格式不對', (await reason({ ...vapid, publicKey: 'abc' })).includes('格式'));
  const mismatch = await reason({ ...vapid, privateKey: vapidPair().privateKey });
  check('公私鑰不是同一組', mismatch.includes('不是同一組'), mismatch);
  check('正式環境不能用本機測試的公鑰', (await reason({ ...vapid, localPublicKey: vapid.publicKey })).includes('本機'));
  check('去掉前後空白與引號', (await vapidConfig({ ...vapid, privateKey: ` "${vapid.privateKey}"\n` })).ok);
  const reasons = await Promise.all([
    reason({ ...vapid, privateKey: vapidPair().privateKey }), reason({ ...vapid, subject: 'x' }), reason({ ...vapid, publicKey: 'abc' }),
  ]);
  check('原因都不含私鑰', reasons.every((r) => !r.includes(vapid.privateKey)));

  /* ===== 允許的推播服務（防 SSRF） ===== */
  const allowed = [
    'https://fcm.googleapis.com/fcm/send/abc', 'https://web.push.apple.com/QAbc-_', 'https://updates.push.services.mozilla.com/wpush/v2/gAAA',
    'https://wns2-par02p.notify.windows.com/w/?token=AAA%3d',
  ];
  const denied = [
    'http://fcm.googleapis.com/fcm/send/abc', 'https://evil.com/fcm.googleapis.com/', 'https://fcm.googleapis.com.evil.com/x',
    'https://fcm.googleapis.com@evil.com/x', 'https://fcm.googleapis.com:8443/x', 'https://evilpush.apple.com.evil.com/x',
    'https://127.0.0.1/x', 'https://fcm.googleapis.com', 'https://fcm.googleapis.com/a b', 'https://kong:8000/rest/v1/',
  ];
  check('已知的推播服務都允許', allowed.every((u) => ENDPOINT.test(u)), allowed.filter((u) => !ENDPOINT.test(u)).join(' '));
  check('其他網址都拒絕', denied.every((u) => !ENDPOINT.test(u)), denied.filter((u) => ENDPOINT.test(u)).join(' '));
  let refused = false;
  try { await pushRequest({ endpoint: 'https://evil.com/x', p256dh: ua.p256dh, auth: ua.auth }, '{}', cfg); } catch { refused = true; }
  check('pushRequest 拒絕不在清單的 endpoint', refused);

  /* ===== 完整請求 ===== */
  const req = await pushRequest({ endpoint, p256dh: ua.p256dh, auth: ua.auth }, text, cfg, { topic: await topicFor('post:a/b') });
  check('header：aes128gcm、TTL 1 天、Urgency', req.headers['Content-Encoding'] === 'aes128gcm' && req.headers.TTL === '86400' && req.headers.Urgency === 'normal');
  check('Topic ≤ 32 個 base64url 字元、同一個 tag 相同', /^[\w-]{1,32}$/.test(req.headers.Topic) && req.headers.Topic === await topicFor('post:a/b')
    && req.headers.Topic !== await topicFor('post:a/c'));
  check('完整請求解得開', decrypt(req.body, ua).text === text);

  console.log(`\n${passed}/${passed + failures.length} 通過`);
  process.exitCode = failures.length ? 1 : 0;
}
