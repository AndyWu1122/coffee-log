// 本機 Supabase 測試的共用工具：讀金鑰、簽 JWT、HTTP、建立測試帳號、斷言
// 金鑰在執行時從 `supabase status` 讀取，不寫進檔案；只允許連本機，絕不連正式專案

import { execSync } from 'node:child_process';
import { createHmac } from 'node:crypto';

/* ===== 讀本機 Supabase 的網址與金鑰 ===== */
function localEnv() {
  const out = execSync('npx --yes supabase@2.120.0 status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const env = Object.fromEntries(
    [...out.matchAll(/^([A-Z_]+)="?([^"\n]*)"?$/gm)].map(([, k, v]) => [k, v]),
  );
  const url = new URL(env.API_URL);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error(`只允許連本機 Supabase，拒絕連線到 ${url.hostname}`);
  }
  return { api: env.API_URL, anonKey: env.ANON_KEY, serviceKey: env.SERVICE_ROLE_KEY, jwtSecret: env.JWT_SECRET };
}
export const { api, anonKey, serviceKey, jwtSecret } = localEnv();
const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

/**
 * 簽發使用者的存取 token（和 Supabase Auth 登入後拿到的格式相同：HS256，用本機 JWT secret 簽）
 * 本機關閉了 email 登入（正式只用 Google），所以測試帳號用 admin API 建立、token 在這裡簽
 */
export function userToken(sub) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 600 })}`;
  return `${body}.${createHmac('sha256', jwtSecret).update(body).digest('base64url')}`;
}

/* ===== 斷言 ===== */
let passed = 0;
export const failures = [];
export function check(name, cond, detail = '') {
  if (cond) passed++;
  else failures.push(name);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
/** 印出結果並設定結束代碼 */
export function summary() {
  console.log(`\n${passed}/${passed + failures.length} 通過`);
  process.exitCode = failures.length ? 1 : 0;
}

/* ===== HTTP 小工具 ===== */
/**
 * body：物件會送成 JSON；Uint8Array 原樣送出（Content-Type 由 headers 指定）
 * 回傳 { status, json, text, bytes }
 */
export async function call(path, { token, method = 'GET', body, headers = {} } = {}) {
  const binary = body instanceof Uint8Array;
  const res = await fetch(api + path, {
    method,
    headers: {
      apikey: anonKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined && !binary ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : binary ? body : JSON.stringify(body),
  });
  const bytes = new Uint8Array(await res.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  let json = null;
  try { json = JSON.parse(text); } catch { /* 不是 JSON */ }
  return { status: res.status, json, text, bytes };
}
export const rest = (path, opts) => call(`/rest/v1/${path}`, opts);
export const rpc = (fn, args, token) => rest(`rpc/${fn}`, { method: 'POST', body: args, token });
export const representation = { Prefer: 'return=representation' };
export const rows = (r) => (Array.isArray(r.json) ? r.json : null);

/* ===== 建立測試帳號（admin API，service_role 只在本機測試裡用） ===== */
export const run = Date.now().toString(36);
export const users = {};
export async function createUser(name) {
  const email = `${name.toLowerCase()}-${run}@test.local`;
  const password = `pw-${crypto.randomUUID()}`;
  const created = await call('/auth/v1/admin/users', {
    method: 'POST', headers: serviceHeaders, body: { email, password, email_confirm: true },
  });
  if (created.status >= 300) throw new Error(`建立 ${name} 失敗：${created.text}`);
  users[name] = { id: created.json.id, token: userToken(created.json.id) };
  return users[name];
}

/** 建立帳號與 profile，並讓 friends 裡的每一對成為好友，例如 setupUsers(['A','B','C'], [['A','B']]) */
export async function setupUsers(names, friends = []) {
  for (const name of names) {
    const u = await createUser(name);
    const r = await rest('profiles', { method: 'POST', token: u.token, body: { nickname: name } });
    if (r.status !== 201) throw new Error(`${name} 建立 profile 失敗：${r.text}`);
  }
  for (const [x, y] of friends) {
    const code = rows(await rest('profiles?select=friend_code', { token: users[x].token }))[0].friend_code;
    if ((await rpc('send_friend_request', { code }, users[y].token)).json !== 'sent') throw new Error(`${y} 邀請 ${x} 失敗`);
    const r = await rest(`friendships?requester=eq.${users[y].id}`, {
      method: 'PATCH', token: users[x].token, body: { status: 'accepted' }, headers: representation,
    });
    if (rows(r)?.[0]?.status !== 'accepted') throw new Error(`${x} 接受邀請失敗：${r.text}`);
  }
  return users;
}

/** 刪除測試帳號（資料表以 on delete cascade 一起刪除）；Storage 的檔案不會連帶刪除，先用 service_role 清掉 */
export async function cleanup() {
  for (const u of Object.values(users)) {
    const list = await call('/storage/v1/object/list/brew-photos', {
      method: 'POST', headers: serviceHeaders, body: { prefix: u.id, limit: 1000 },
    });
    const names = Array.isArray(list.json) ? list.json.map((o) => `${u.id}/${o.name}`) : [];
    if (names.length) {
      await call('/storage/v1/object/brew-photos', { method: 'DELETE', headers: serviceHeaders, body: { prefixes: names } });
    }
    await call(`/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: serviceHeaders });
  }
}

/* ===== 照片 ===== */
export const BUCKET = 'brew-photos';
export const photoPath = (owner, brewId) => `${owner}/${brewId}.jpg`;

/** 新增一筆 shared_brews；withPhoto 時 photo_path 指向 <owner>/<id>.jpg（先寫紀錄、再傳照片） */
export async function insertBrew(user, { withPhoto = true } = {}) {
  const id = crypto.randomUUID();
  const r = await rest('shared_brews', {
    method: 'POST', token: user.token,
    body: {
      id, bean_name: '測試豆', brewed_at: new Date().toISOString(), coffee_g: 15, water_g: 240,
      photo_path: withPhoto ? photoPath(user.id, id) : null,
    },
  });
  if (r.status !== 201) throw new Error(`新增紀錄失敗：${r.text}`);
  return id;
}

/** 上傳照片（upsert 時覆蓋既有檔案） */
export const uploadPhoto = (token, path, bytes, { contentType = 'image/jpeg', upsert = false } = {}) =>
  call(`/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST', token, body: bytes,
    headers: { 'Content-Type': contentType, ...(upsert ? { 'x-upsert': 'true' } : {}) },
  });
/** 以登入身分下載（套用 RLS） */
export const downloadPhoto = (token, path) => call(`/storage/v1/object/authenticated/${BUCKET}/${path}`, { token });
/** 建立 signed URL，成功回傳完整網址，否則回傳 null 與回應 */
export async function signPhoto(token, path, expiresIn = 3600) {
  const r = await call(`/storage/v1/object/sign/${BUCKET}/${path}`, { method: 'POST', token, body: { expiresIn } });
  return { url: r.json?.signedURL ? `${api}/storage/v1${r.json.signedURL}` : null, res: r };
}
/** 管理者確認檔案是否存在（不受 RLS 影響） */
export async function photoExists(path) {
  const r = await call(`/storage/v1/object/${BUCKET}/${path}`, { headers: serviceHeaders });
  return r.status === 200;
}
