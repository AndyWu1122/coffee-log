// 照片上傳後沒有 EXIF（docs/social-spec.md 階段 2）
// 1. 用 headless Chrome 開 tests/photo.html：用 App 的 preparePhoto → photoForUpload 處理帶 EXIF（含 GPS）的測試照片
// 2. 把處理後的 JPEG 以 A 的身分上傳到本機 Supabase，再以好友 B 的身分下載
// 3. 在 Node 這邊用獨立的解析程式確認下載回來的檔案沒有任何中繼資料段、找不到 EXIF／GPS 內容
//
// 用法：先 npx supabase@2.120.0 start，再 node scripts/photo-exif-test.mjs
// 需要 Chrome 或 Edge；找不到時用環境變數 CHROME_PATH 指定。不需要安裝任何套件

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  check, failures, summary, setupUsers, cleanup, photoPath, insertBrew, uploadPhoto, downloadPhoto,
} from './supabase-local.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BYTES = 1024 * 1024;
const MARKERS = ['Exif\0\0', 'TestCam-EXIF-MARKER', 'GPS-XMP-MARKER', 'COMMENT-MARKER', 'http://ns.adobe.com/xap'];

/* ===== 靜態伺服器（只聽 127.0.0.1，只能讀 repo 裡的檔案） ===== */
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
};
function startServer() {
  const server = createServer(async (req, res) => {
    const file = path.resolve(root, `.${decodeURIComponent(new URL(req.url, 'http://x').pathname)}`);
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/* ===== Chrome（DevTools Protocol，用 Node 內建的 WebSocket） ===== */
function findChrome() {
  const env = process.env;
  const candidates = [
    env.CHROME_PATH,
    `${env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
    `${env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
    `${env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    `${env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ];
  const found = candidates.find((p) => p && existsSync(p));
  if (!found) throw new Error('找不到 Chrome／Edge，請用環境變數 CHROME_PATH 指定');
  return found;
}

async function launchChrome() {
  const userDir = await mkdtemp(path.join(tmpdir(), 'coffee-log-chrome-'));
  const proc = spawn(findChrome(), [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--remote-debugging-port=0', `--user-data-dir=${userDir}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('Chrome 啟動逾時')), 30000);
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    proc.on('exit', (code) => { clearTimeout(timer); reject(new Error(`Chrome 意外結束（${code}）`)); });
  });
  return { proc, userDir, wsUrl };
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    const p = msg.id && pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
    } else {
      for (const fn of listeners) fn(msg);
    }
  };
  const opened = new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('連不上 Chrome')); });
  return {
    opened,
    send(method, params = {}, sessionId) {
      const id = ++nextId;
      ws.send(JSON.stringify({ id, method, params, sessionId }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    on: (fn) => listeners.push(fn),
    close: () => ws.close(),
  };
}

/** 開測試頁，等它跑完，回傳 window.photoTestResult */
async function runPage(url) {
  const chrome = await launchChrome();
  const client = connect(chrome.wsUrl);
  try {
    await client.opened;
    const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
    const pageErrors = [];
    client.on((msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === 'Runtime.exceptionThrown') pageErrors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
      if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') pageErrors.push(`${msg.params.entry.text} ${msg.params.entry.url ?? ''}`);
    });
    await client.send('Runtime.enable', {}, sessionId);
    await client.send('Log.enable', {}, sessionId);
    await client.send('Page.navigate', { url }, sessionId);

    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const r = await client.send('Runtime.evaluate', {
        expression: 'window.photoTestResult ? JSON.stringify(window.photoTestResult) : null', returnByValue: true,
      }, sessionId);
      if (r.result.value) return JSON.parse(r.result.value);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`測試頁逾時${pageErrors.length ? `：${pageErrors.join(' / ')}` : ''}`);
  } finally {
    client.close();
    chrome.proc.kill();
    await new Promise((resolve) => (chrome.proc.exitCode !== null ? resolve() : chrome.proc.once('exit', resolve)));
    await rm(chrome.userDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
  }
}

/* ===== 獨立的 JPEG 檢查（不用 App 的 image.js，避免同一個錯誤兩邊都看不出來） ===== */
function inspectJpeg(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return { error: '不是 JPEG（沒有 SOI）' };
  const segments = [];
  let size = null;
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return { error: `位置 ${i} 不是段落標記` };
    const marker = bytes[i + 1];
    if (marker === 0xda) break;
    const len = bytes.readUInt16BE(i + 2);
    const id = bytes.subarray(i + 4, Math.min(i + 2 + len, i + 20)).toString('latin1').split('\0')[0];
    segments.push({ marker, id });
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      size = { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return { segments, size };
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
    const meta = info.segments.filter((s) => (s.marker >= 0xe0 && s.marker <= 0xef) || s.marker === 0xfe);
    check(`[上傳] ${label}：沒有 EXIF、XMP、ICC、註解等中繼資料段（只剩 JFIF）`,
      meta.every((s) => s.marker === 0xe0 && s.id === 'JFIF'),
      meta.map((s) => `${s.marker.toString(16)}:${s.id}`).join(' '));
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
