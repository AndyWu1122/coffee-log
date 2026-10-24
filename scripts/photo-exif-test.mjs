// 照片上傳後沒有 EXIF（docs/social-spec.md 階段 2）
// 1. 用 headless Chrome 開 tests/photo.html：用 App 的 preparePhoto → photoForUpload 處理帶 EXIF（含 GPS）的測試照片
// 2. 把處理後的 JPEG 以 A 的身分上傳到本機 Supabase，再以好友 B 的身分下載
// 3. 在 Node 這邊用獨立的解析程式確認下載回來的檔案沒有任何中繼資料段、找不到 EXIF／GPS 內容
//
// 用法：先 npx supabase@2.120.0 start，再 node scripts/photo-exif-test.mjs
// 需要 Chrome 或 Edge（見 scripts/chrome.mjs）。不需要安裝任何套件

import {
  check, failures, summary, setupUsers, cleanup, photoPath, insertBrew, uploadPhoto, downloadPhoto,
} from './supabase-local.mjs';
import { startServer, launchChrome, inspectJpeg, extraMetadata } from './chrome.mjs';

const MAX_BYTES = 1024 * 1024;
const MARKERS = ['Exif\0\0', 'TestCam-EXIF-MARKER', 'GPS-XMP-MARKER', 'COMMENT-MARKER', 'http://ns.adobe.com/xap'];

/** 開測試頁，等它跑完，回傳 window.photoTestResult */
async function runPage(url) {
  const chrome = await launchChrome();
  try {
    const page = await chrome.newPage(url);
    const json = await page.waitFor('window.photoTestResult && JSON.stringify(window.photoTestResult)', {
      timeout: 60000, label: '測試頁跑完',
    }).catch((err) => { throw new Error(`${err.message}${page.errors.length ? `：${page.errors.join(' / ')}` : ''}`); });
    return JSON.parse(json);
  } finally {
    await chrome.close();
  }
}

let server;
try {
  /* ----- 1. 瀏覽器端處理 ----- */
  server = await startServer();
  const pageUrl = `http://127.0.0.1:${server.address().port}/tests/photo.html`;
  const result = await runPage(pageUrl);
  console.log(`瀏覽器：${result.userAgent}\n`);
  if (result.error) failures.push(`測試頁錯誤：${result.error}`);
  for (const c of result.checks) check(`[瀏覽器] ${c.name}`, c.ok, c.detail);
  check('[瀏覽器] 有產生要上傳的照片', result.uploads.length >= 7, `${result.uploads.length} 張`);

  /* ----- 2. 上傳到本機 Supabase、好友下載回來檢查 ----- */
  console.log('');
  const { A, B } = await setupUsers(['A', 'B'], [['A', 'B']]);
  for (const { label, base64, expect } of result.uploads) {
    const bytes = Buffer.from(base64, 'base64');
    const brewId = await insertBrew(A);
    const p = photoPath(A.id, brewId);
    const up = await uploadPhoto(A.token, p, bytes);
    check(`[上傳] ${label}：上傳成功`, up.status === 200, `HTTP ${up.status} ${up.text.slice(0, 80)}`);
    const down = await downloadPhoto(B.token, p);
    const got = Buffer.from(down.bytes);
    check(`[上傳] ${label}：好友下載回來的檔案和上傳的完全一樣`, down.status === 200 && got.equals(bytes), `HTTP ${down.status}`);

    const info = inspectJpeg(got);
    check(`[上傳] ${label}：是合法的 JPEG`, !info.error && info.size, info.error ?? '');
    if (info.error) continue;
    const meta = extraMetadata(info);
    check(`[上傳] ${label}：沒有 EXIF、XMP、ICC、註解等中繼資料段（只剩 JFIF）`,
      meta.length === 0, meta.map((s) => `${s.marker.toString(16)}:${s.id}`).join(' '));
    const left = MARKERS.filter((m) => got.includes(Buffer.from(m, 'latin1')));
    check(`[上傳] ${label}：整個檔案找不到 EXIF／GPS／XMP／註解內容`, left.length === 0, left.join(', '));
    check(`[上傳] ${label}：最長邊 ≤ 1600px、≤ 1MB`,
      Math.max(info.size.width, info.size.height) <= 1600 && got.length <= MAX_BYTES,
      `${info.size.width}×${info.size.height}，${(got.length / 1024).toFixed(0)}KB`);
    if (expect) {
      check(`[上傳] ${label}：尺寸是 ${expect.width}×${expect.height}`,
        info.size.width === expect.width && info.size.height === expect.height, `${info.size.width}×${info.size.height}`);
    }
  }
} catch (err) {
  failures.push(`執行錯誤：${err.message}`);
  console.error(err);
} finally {
  server?.close();
  await cleanup();
}

summary();
