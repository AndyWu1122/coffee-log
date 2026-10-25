// 推播測試共用：瀏覽器那一邊的解密（RFC 8291）、VAPID 驗證、假推播伺服器
// 只用 node:crypto，不載入 supabase/functions/_shared/webpush.ts（避免同一個錯誤兩邊都看不出來）

import { createECDH, createDecipheriv, hkdfSync, createPublicKey, verify as verifySig } from 'node:crypto';
import { createServer } from 'node:http';

/** 瀏覽器的訂閱：P-256 金鑰對＋16 bytes 的 auth secret */
export function browserKeys() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = Buffer.from(crypto.getRandomValues(new Uint8Array(16)));
  return { ecdh, p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') };
}

export function decrypt(body, { ecdh, auth }) {
  body = Buffer.from(body);
  const salt = body.subarray(0, 16);
  const rs = body.readUInt32BE(16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const cipher = body.subarray(21 + idlen);
  const uaPublic = ecdh.getPublicKey();
  const secret = ecdh.computeSecret(asPublic);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', secret, Buffer.from(auth, 'base64url'), info, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(cipher.subarray(cipher.length - 16));
  const plain = Buffer.concat([decipher.update(cipher.subarray(0, cipher.length - 16)), decipher.final()]);
  // 最後一個 record：內容後面是 0x02，再接可有可無的 0x00 填充
  const end = plain.lastIndexOf(2);
  return { text: plain.subarray(0, end).toString('utf8'), rs, idlen, delimiterOk: plain.subarray(end + 1).every((b) => b === 0) };
}

/** 驗證 VAPID 的 Authorization header；回傳 { ok, claims, k } */
export function verifyVapid(authorization, publicKey) {
  const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(authorization);
  if (!m) return { ok: false };
  const [, h, c, s, k] = m;
  const header = JSON.parse(Buffer.from(h, 'base64url'));
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  const raw = Buffer.from(k, 'base64url');
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });
  const ok = header.alg === 'ES256' && k === publicKey
    && verifySig('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
  return { ok, claims, k };
}

/**
 * 假推播伺服器（本機的 send-push 一律送到 port 54398，保留 endpoint 的路徑）
 * 收到的請求記在 received：{ path, headers, body(Buffer) }；status(path) 回傳要回應的狀態碼（預設 201）
 */
export function fakePushServer({ port = 54398, status = () => 201 } = {}) {
  const received = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      received.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(status(req.url)).end();
    });
  });
  return {
    received,
    listen: () => new Promise((resolve) => server.listen(port, '0.0.0.0', resolve)),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
