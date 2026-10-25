// Web Push（send-push 用）：VAPID（RFC 8292）簽章與內容加密（RFC 8291，aes128gcm）
// 只用 Web Crypto，沒有第三方相依；Deno（Edge Function）和 Node（scripts/webpush-test.mjs）都能直接載入
//
// 金鑰格式和瀏覽器一樣用 base64url（不補 =）：
//   公鑰：P-256 未壓縮的點（65 bytes，0x04 開頭）＝ App 的 applicationServerKey（js/config.js）
//   私鑰：32 bytes 的 d（只在 Supabase secrets）

const enc = new TextEncoder();

export function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
};

const B64URL = /^[A-Za-z0-9_-]+$/;
const isKey = (s: string, bytes: number) => B64URL.test(s) && b64urlDecode(s).length === bytes;

// 和 public.push_subscriptions 的 check 一致（資料庫已經擋過，送出前再檢查一次）
export const ENDPOINT = new RegExp('^https://('
  + 'fcm\\.googleapis\\.com'
  + '|[a-z0-9-]+\\.push\\.apple\\.com'
  + '|([a-z0-9-]+\\.)*push\\.services\\.mozilla\\.com'
  + '|[a-z0-9-]+\\.notify\\.windows\\.com'
  + ')/[!-~]*$');

export type Vapid = { publicKey: string; privateKey: string; subject: string };
export type VapidConfig = ({ ok: true } & Vapid) | { ok: false; reason: string };

/** 去掉前後空白、換行與成對的引號（secrets set 時常見的多餘字元） */
const clean = (v: string | undefined) => (v ?? '').trim().replace(/^(['"])(.*)\1$/, '$2').trim();

/**
 * 檢查 VAPID 設定；不對時回傳看得懂的原因（不含私鑰）
 * localPublicKey：本機測試用的公鑰，正式環境不能用它
 */
export async function vapidConfig(
  { publicKey, privateKey, subject, localPublicKey }: { publicKey?: string; privateKey?: string; subject?: string; localPublicKey?: string },
): Promise<VapidConfig> {
  const pub = clean(publicKey);
  const priv = clean(privateKey);
  const sub = clean(subject);
  if (!pub) return { ok: false, reason: '沒有設定 VAPID_PUBLIC_KEY' };
  if (!priv) return { ok: false, reason: '沒有設定 VAPID_PRIVATE_KEY' };
  if (!sub) return { ok: false, reason: '沒有設定 VAPID_SUBJECT' };
  if (localPublicKey && pub === localPublicKey) return { ok: false, reason: 'VAPID_PUBLIC_KEY 是本機測試用的金鑰，請用 scripts/vapid-keys.mjs 產生新的一組' };
  if (!isKey(pub, 65) || b64urlDecode(pub)[0] !== 4) return { ok: false, reason: 'VAPID_PUBLIC_KEY 格式不對（應該是 87 個字元的 base64url）' };
  if (!isKey(priv, 32)) return { ok: false, reason: 'VAPID_PRIVATE_KEY 格式不對（應該是 43 個字元的 base64url）' };
  if (!/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/.test(sub)) return { ok: false, reason: 'VAPID_SUBJECT 要是 mailto:你的信箱 或 https:// 網址' };
  // 公私鑰是不是同一組：簽一次再驗證
  try {
    const { sign, verify } = await vapidKeys(pub, priv);
    const data = enc.encode('check');
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, sign, data);
    if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verify, sig, data)) {
      return { ok: false, reason: 'VAPID_PUBLIC_KEY 和 VAPID_PRIVATE_KEY 不是同一組' };
    }
  } catch {
    return { ok: false, reason: 'VAPID_PUBLIC_KEY 和 VAPID_PRIVATE_KEY 不是同一組' };
  }
  return { ok: true, publicKey: pub, privateKey: priv, subject: sub };
}

async function vapidKeys(publicKey: string, privateKey: string) {
  const raw = b64urlDecode(publicKey);
  const jwk = { kty: 'EC', crv: 'P-256', x: b64urlEncode(raw.slice(1, 33)), y: b64urlEncode(raw.slice(33, 65)), ext: true };
  const sign = await crypto.subtle.importKey('jwk', { ...jwk, d: privateKey }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const verify = await crypto.subtle.importKey('raw', raw, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  return { sign, verify };
}

/** VAPID 的 Authorization header：ES256 JWT，aud 是推播服務的 origin，12 小時有效 */
export async function vapidAuthorization(endpoint: string, vapid: Vapid, now = Date.now()): Promise<string> {
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 3600,
    sub: vapid.subject,
  })));
  const { sign } = await vapidKeys(vapid.publicKey, vapid.privateKey);
  // Web Crypto 的 ECDSA 簽章就是 JWS 要的 r||s（64 bytes）
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, sign, enc.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${b64urlEncode(sig)}, k=${vapid.publicKey}`;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/**
 * 加密推播內容（RFC 8291 aes128gcm，單一 record）
 * 回傳的 body：salt(16) | rs(4) | idlen(1) | 伺服器的臨時公鑰(65) | 密文
 */
export async function encryptPayload(p256dh: string, authSecret: string, plaintext: string) {
  const uaPublic = b64urlDecode(p256dh);
  const auth = b64urlDecode(authSecret);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));

  const ikm = await hkdf(auth, ecdhSecret, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // 最後（也是唯一）一個 record：內容後面接 0x02
  const record = concat(enc.encode(plaintext), new Uint8Array([2]));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, record));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

/** Topic header（推播服務裡還沒送達的同一個 topic 會被取代）：最多 32 個 base64url 字元 */
export async function topicFor(tag: string) {
  return b64urlEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(tag)))).slice(0, 32);
}

export type Subscription = { endpoint: string; p256dh: string; auth: string };

/** 組出送給推播服務的請求（不送出）；ttl 秒數內手機沒連上就丟掉 */
export async function pushRequest(sub: Subscription, payload: string, vapid: Vapid, { ttl = 86400, topic }: { ttl?: number; topic?: string } = {}) {
  if (!ENDPOINT.test(sub.endpoint)) throw new Error('endpoint not allowed');
  const headers: Record<string, string> = {
    Authorization: await vapidAuthorization(sub.endpoint, vapid),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(ttl),
    Urgency: 'normal',
  };
  if (topic) headers.Topic = topic;
  return { headers, body: await encryptPayload(sub.p256dh, sub.auth, payload) };
}
