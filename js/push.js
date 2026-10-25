// 推播通知：瀏覽器那一邊（Notification、PushManager、Service Worker）；只由 models.js 使用
// 雲端的訂閱、偏好在 cloud.js；VAPID 公鑰在 config.js（私鑰只在 Supabase secrets）
import { SUPABASE } from './config.js';

const READY_TIMEOUT = 5000;

export const publicKey = () => SUPABASE?.vapidPublicKey || '';

/** iPhone、iPad（iPadOS 的 Safari 自稱 Mac，用觸控點判斷） */
export const isIos = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

/** 從主畫面開啟（iOS 只有這時才能用推播） */
export const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

/**
 * 這台裝置能不能用推播
 *   'ios-browser'：iPhone 但不是從主畫面開啟（要先加入主畫面）
 *   'unsupported'：瀏覽器不支援（iOS 16.4 以前、非 secure context 等）
 *   'unconfigured'：這個網址還沒設定 VAPID 公鑰
 *   'ok'
 */
export function support() {
  if (isIos() && !isStandalone()) return 'ios-browser';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (!publicKey()) return 'unconfigured';
  return 'ok';
}

/** 'granted' | 'denied' | 'default'（還沒問過） */
export const permission = () => Notification.permission;

/** 只在使用者按按鈕時呼叫（瀏覽器規定要在點擊當下，也不要一打開 App 就詢問） */
export const requestPermission = () => Notification.requestPermission();

/** Service Worker 的 registration；等太久（沒註冊成功）就當作沒有 */
function registration() {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((resolve) => setTimeout(() => resolve(null), READY_TIMEOUT)),
  ]);
}

/** 這台裝置目前的訂閱；沒有回傳 null */
export async function currentSubscription() {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await registration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

const b64url = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function b64urlBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

/** 訂閱是不是用目前的 VAPID 公鑰建立的（換過金鑰的舊訂閱要重新訂閱） */
function sameKey(sub) {
  const key = sub.options?.applicationServerKey;
  return !key || b64url(key) === publicKey();
}

/** 取得這台裝置的訂閱（沒有、或金鑰換過就重新訂閱）；fresh 時一律退訂後重新訂閱（換一個新的 endpoint） */
export async function subscribe({ fresh = false } = {}) {
  const reg = await registration();
  if (!reg) throw new Error('Service Worker 還沒準備好，請重新整理後再試');
  let sub = await reg.pushManager.getSubscription();
  if (sub && (fresh || !sameKey(sub))) {
    await sub.unsubscribe();
    sub = null;
  }
  return sub ?? reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlBytes(publicKey()) });
}

/** 訂閱 → 雲端要存的欄位（金鑰轉成 base64url） */
export function subscriptionRow(sub) {
  return {
    endpoint: sub.endpoint,
    p256dh: b64url(sub.getKey('p256dh')),
    auth: b64url(sub.getKey('auth')),
    user_agent: navigator.userAgent.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').slice(0, 300),
  };
}

/** 退訂這台裝置（推播服務那邊的訂閱也失效）；回傳退訂前的 endpoint，沒有訂閱回傳 null */
export async function unsubscribe() {
  const sub = await currentSubscription();
  if (!sub) return null;
  await sub.unsubscribe().catch(() => {});
  return sub.endpoint;
}
