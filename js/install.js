// 安裝 App（加到主畫面）：判斷裝置與瀏覽器、什麼時候該提醒
// 純函式，不 import 任何東西，Node 可直接測（scripts/install-test.mjs）；由 models.js 使用

/** LINE、Facebook、Instagram、微信等 App 內建的瀏覽器：不能安裝、不能下載檔案、Google 不允許在裡面登入 */
export const IN_APP_RE = /\bLine\/|FBAN|FBAV|Instagram|MicroMessenger/i;

/** iPhone 上 Safari 以外的瀏覽器（Chrome、Firefox、Edge、Opera、DuckDuckGo、Google App） */
const IOS_OTHER_RE = /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|GSA\//;

/**
 * 這是什麼裝置、什麼瀏覽器 → { kind, tablet, oldIos }
 * kind：
 *   'in-app'            App 內建的瀏覽器（要請使用者改用真的瀏覽器開啟）
 *   'ios-safari'        iPhone／iPad 的 Safari（分享 → 加入主畫面）
 *   'ios-other'         iPhone／iPad 的其他瀏覽器（iOS 16.4 起也能加入主畫面；oldIos＝太舊，請改用 Safari）
 *   'android'           Android（Chrome／Edge 有 beforeinstallprompt；沒有就教 ⋮ 選單）
 *   'desktop-chromium'  電腦的 Chrome／Edge（網址列右邊的安裝圖示）
 *   'desktop-other'     電腦的其他瀏覽器
 *   'unknown'           認不出來（讓使用者自己選裝置）
 * tablet：iPad、Android 平板（分享按鈕在右上角）
 */
export function detectPlatform({ userAgent = '', maxTouchPoints = 0 } = {}) {
  const ua = String(userAgent);
  // iPadOS 的 Safari 自稱 Mac，用觸控點判斷
  const ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
  const ios = ipad || /iPhone|iPod/.test(ua);
  const android = /Android/.test(ua);
  const tablet = ipad || (android && !/Mobile/.test(ua));
  const version = ios ? ua.match(/OS (\d+)[_.](\d+)/) : null;
  const oldIos = Boolean(version) && (Number(version[1]) < 16 || (Number(version[1]) === 16 && Number(version[2]) < 4));

  let kind = 'unknown';
  if (IN_APP_RE.test(ua)) kind = 'in-app';
  else if (ios) kind = IOS_OTHER_RE.test(ua) ? 'ios-other' : 'ios-safari';
  else if (android) kind = 'android';
  else if (/Windows NT|Macintosh|X11|Linux|CrOS/.test(ua)) {
    kind = /Chrome\/|Edg\//.test(ua) && !/OPR\/|Firefox\//.test(ua) ? 'desktop-chromium' : 'desktop-other';
  }
  return { kind, tablet, oldIos };
}

/** 認不出來、或使用者說「不是這個裝置」時自己選 */
export const PLATFORM_CHOICES = [
  { value: 'iphone', label: 'iPhone', platform: { kind: 'ios-safari', tablet: false, oldIos: false } },
  { value: 'ipad', label: 'iPad', platform: { kind: 'ios-safari', tablet: true, oldIos: false } },
  { value: 'android', label: 'Android 手機', platform: { kind: 'android', tablet: false, oldIos: false } },
  { value: 'desktop', label: '電腦', platform: { kind: 'desktop-other', tablet: false, oldIos: false } },
];

const DAY = 86400000;
export const LATER_DAYS = 3;  // 按「稍後」：幾天後在首頁提示
export const STICKY_DAYS = 7; // iPhone 的瀏覽器裡已經有資料：關掉提示後幾天再提醒（7 天沒打開資料可能被清掉）

/**
 * meta `installGuide` 的內容：{ seenAt, choice, hintAfter, quiet }
 *   choice：'later'（稍後；教學看到一半關掉 App 也算）｜'skip'（略過）｜'installed'
 *   hintAfter：什麼時候起首頁可以提示（ISO）
 *   quiet：使用者說不用再提醒（略過、或關掉首頁的提示）
 * sticky：iPhone／iPad 不是從主畫面開啟、而且已經有資料 → 就算 quiet 也每 7 天提醒一次
 */

/** 第一次顯示安裝教學時記下（之後不再主動跳出） */
export const guideSeen = (now) => ({
  seenAt: new Date(now).toISOString(), choice: 'later', hintAfter: new Date(now + LATER_DAYS * DAY).toISOString(), quiet: false,
});

/** 教學關掉時的選擇 */
export function afterChoice(meta, choice, now) {
  const base = meta ?? guideSeen(now);
  if (choice === 'installed') return { ...base, choice, hintAfter: null, quiet: true };
  if (choice === 'skip') return { ...base, choice, hintAfter: new Date(now + STICKY_DAYS * DAY).toISOString(), quiet: true };
  return { ...base, choice: 'later', hintAfter: new Date(now + LATER_DAYS * DAY).toISOString(), quiet: false };
}

/** 關掉首頁的提示 */
export const afterDismiss = (meta, now) => ({
  ...(meta ?? guideSeen(now)), hintAfter: new Date(now + STICKY_DAYS * DAY).toISOString(), quiet: true,
});

/**
 * 現在該做什麼 → { auto, hint }
 * auto：要主動顯示安裝教學（沒看過、不是已安裝的 App）
 * hint：首頁要顯示小提示
 */
export function guideState(meta, { now, standalone = false, sticky = false }) {
  if (standalone) return { auto: false, hint: false };
  if (!meta) return { auto: true, hint: false };
  const due = meta.choice !== 'installed' && meta.hintAfter != null && now >= new Date(meta.hintAfter).getTime();
  return { auto: false, hint: due && (!meta.quiet || sticky) };
}
