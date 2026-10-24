// 測試用：靜態伺服器 + headless Chrome（DevTools Protocol，用 Node 內建的 WebSocket，不需要安裝套件）
// 需要 Chrome 或 Edge；找不到時用環境變數 CHROME_PATH 指定

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ===== 靜態伺服器（只聽 127.0.0.1，只能讀 repo 裡的檔案） ===== */
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
};
export function startServer() {
  const server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.resolve(root, `.${pathname.endsWith('/') ? `${pathname}index.html` : pathname}`);
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

/* ===== Chrome ===== */
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
      if (msg.error) p.reject(new Error(`${msg.error.message}`)); else p.resolve(msg.result);
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

/**
 * 啟動 headless Chrome，回傳 { newPage(url, { isolated }), close() }
 * extraArgs：額外的命令列參數（例如 --host-resolver-rules）
 */
export async function launchChrome({ extraArgs = [] } = {}) {
  const userDir = await mkdtemp(path.join(tmpdir(), 'coffee-log-chrome-'));
  const proc = spawn(findChrome(), [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--remote-debugging-port=0', `--user-data-dir=${userDir}`, ...extraArgs, 'about:blank',
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
  const client = connect(wsUrl);
  await client.opened;

  /** 開新分頁；isolated 時用獨立的瀏覽器環境（IndexedDB、cookie 互不相通，像兩支不同的手機） */
  async function newPage(url, { isolated = false } = {}) {
    const browserContextId = isolated ? (await client.send('Target.createBrowserContext')).browserContextId : undefined;
    const { targetId } = await client.send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
    const errors = [];
    client.on((msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        errors.push(d.exception?.description ?? d.text);
      }
      if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        errors.push(`${msg.params.entry.text} ${msg.params.entry.url ?? ''}`.trim());
      }
    });
    const send = (method, params) => client.send(method, params, sessionId);
    await send('Runtime.enable');
    await send('Log.enable');
    await send('Page.enable');

    const page = {
      errors,
      /** 直接送 DevTools Protocol 指令（截圖、模擬裝置等） */
      cdp: send,
      /** 在頁面執行運算式（可以是 Promise），回傳 JSON 可序列化的結果 */
      async eval(expression) {
        const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
        return r.result.value;
      },
      /** 等到運算式為真（每 100ms 檢查一次），回傳它的值 */
      async waitFor(expression, { timeout = 10000, label = expression } = {}) {
        const deadline = Date.now() + timeout;
        for (;;) {
          let value;
          try { value = await page.eval(expression); } catch { /* 換頁中 */ }
          if (value) return value;
          if (Date.now() > deadline) throw new Error(`等待逾時：${label}`);
          await sleep(100);
        }
      },
      async goto(target) {
        await send('Page.navigate', { url: target });
        await page.waitFor('document.readyState === "complete"');
      },
      async reload() {
        await page.eval('window.__reloading = true');
        await send('Page.reload', { ignoreCache: true });
        await page.waitFor('!window.__reloading && document.readyState === "complete"');
      },
      /** 設定 <input type="file"> 的檔案（觸發 change） */
      async setFiles(selector, files) {
        const { root: doc } = await send('DOM.getDocument');
        const { nodeId } = await send('DOM.querySelector', { nodeId: doc.nodeId, selector });
        if (!nodeId) throw new Error(`找不到 ${selector}`);
        await send('DOM.setFileInputFiles', { nodeId, files });
      },
      /** 模擬斷網／恢復網路（navigator.onLine 會跟著變，並觸發 offline／online 事件） */
      async setOffline(offline) {
        await send('Network.enable');
        await send('Network.emulateNetworkConditions', { offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      },
      close: () => client.send('Target.closeTarget', { targetId }),
    };
    if (url) await page.goto(url);
    return page;
  }

  async function close() {
    client.close();
    proc.kill();
    await new Promise((resolve) => (proc.exitCode !== null ? resolve() : proc.once('exit', resolve)));
    await rm(userDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
  }

  return { newPage, close };
}

/* ===== 獨立的 JPEG 檢查（不用 App 的 image.js，避免同一個錯誤兩邊都看不出來） ===== */

/** 回傳 { segments: [{ marker, id }], size: { width, height } } 或 { error } */
export function inspectJpeg(bytes) {
  bytes = Buffer.from(bytes);
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

/** 中繼資料段（APP0–APP15、COM）裡，JFIF 以外的 */
export const extraMetadata = (info) =>
  info.segments.filter((s) => ((s.marker >= 0xe0 && s.marker <= 0xef) || s.marker === 0xfe) && !(s.marker === 0xe0 && s.id === 'JFIF'));

/* ===== 操作 App 畫面的小工具（社群的端對端測試共用） ===== */

const q = JSON.stringify;

/** 每次整頁載入後：confirm 一律按確定、prompt 不開、pwn() 被呼叫就記下來（XSS 偵測） */
export async function prepare(page) {
  await page.eval(`
    window.confirm = () => true;
    window.prompt = () => null;
    window.pwn = () => { window.__pwned = (window.__pwned || 0) + 1; };
    true`);
}
export async function visit(page, base, hash) {
  if ((await page.eval('location.hash')) === hash) await page.reload();
  else await page.goto(base + hash);
  await prepare(page);
}
// 換頁後畫面可能還在等網路資料：先等元素出現再操作
const ready = (page, sel) => page.waitFor(`Boolean(document.querySelector(${q(sel)}))`, { label: `出現 ${sel}` });
export async function click(page, sel) {
  await ready(page, sel);
  return page.eval(`(document.querySelector(${q(sel)}).click(), true)`);
}
export async function fill(page, sel, value) {
  await ready(page, sel);
  return page.eval(`(() => {
    const el = document.querySelector(${q(sel)});
    el.value = ${q(value)};
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
}
export async function submit(page, sel) {
  await ready(page, sel);
  return page.eval(`(document.querySelector(${q(sel)}).requestSubmit(), true)`);
}
export const text = (page, sel) => page.eval(`document.querySelector(${q(sel)})?.textContent ?? null`);
export const toast = (page, includes) => page.waitFor(`(() => {
  const t = document.getElementById('toast');
  return t.classList.contains('show') && t.textContent.includes(${q(includes)}) && t.textContent;
})()`, { label: `toast「${includes}」` });
export const fieldError = (page, sel) => page.waitFor(`document.querySelector(${q(`${sel} .error`)})?.textContent`, { label: `${sel} 的錯誤訊息` });
export const metaKeys = (page) => page.eval(`import('/js/db.js').then((db) => db.getAllKeys('meta'))`);
/** 他人內容沒有變成 HTML：pwn() 沒被呼叫、沒有 <b>、沒有帶 onload 的 svg */
export const noInjection = (page) => page.eval(`!window.__pwned && !document.querySelector('#app b') && !document.querySelector('svg[onload]')`);

/** 用 App 自己的 IndexedDB 存放登入狀態（和 supabase-js 登入後存的位置、格式相同） */
export async function signIn(page, session) {
  await page.eval(`import('/js/db.js').then((db) => db.setMeta('auth:supabase-auth', ${q(JSON.stringify(session))})).then(() => true)`);
}

/** 做一張帶 EXIF（含相機型號、GPS 標記）的 JPEG 給頭像測試 */
export async function exifJpeg(page) {
  const b64 = await page.eval(`(async () => {
    const c = Object.assign(document.createElement('canvas'), { width: 600, height: 400 });
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#8a5a3b'; ctx.fillRect(0, 0, 600, 400);
    ctx.fillStyle = '#f2d7b6'; ctx.fillRect(200, 50, 200, 300);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  })()`);
  const jpeg = Buffer.from(b64, 'base64');
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), Buffer.from('II*\0\x08\0\0\0TestCam-EXIF-MARKER GPS 22.99N 120.21E', 'latin1')]);
  const seg = Buffer.alloc(4);
  seg.writeUInt16BE(0xffe1, 0);
  seg.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), seg, payload, jpeg.subarray(2)]);
}

