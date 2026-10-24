// 照片處理：解碼、縮小、重新編碼成 JPEG（移除 EXIF）、base64、JPEG 驗證、上傳前的中繼資料清除
// 只用瀏覽器內建 API，本身不上傳任何資料；由 models.js 使用

const PHOTO_MAX_SIDE = 1600;
const PHOTO_QUALITY = 0.8;
const PHOTO_RETRY_BYTES = 350 * 1024; // 超過就用較低品質再編碼一次（目標約 200KB）
const PHOTO_RETRY_QUALITY = 0.7;
const THUMB_MAX_SIDE = 300;
const THUMB_QUALITY = 0.75;

// 只接受這三種格式（docs/social-spec.md 階段 2）；iPhone 的 HEIC 在 <input accept> 只列這三種時，系統通常會先轉成 JPEG
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const TYPE_ERROR = '只能選 JPEG、PNG 或 WebP 照片。iPhone 若出現這個訊息，請到「設定 → 相機 → 格式」改為「最相容」';
const DECODE_ERROR = '無法讀取這張照片，檔案可能已損壞，請換一張試試';

// 雲端照片上限，要和 Supabase bucket brew-photos 的 file_size_limit 一致（supabase/migrations/*_social_storage.sql）
export const CLOUD_PHOTO_MAX_BYTES = 1024 * 1024;
const UPLOAD_QUALITIES = [PHOTO_QUALITY, PHOTO_RETRY_QUALITY, 0.6, 0.5, 0.4];

const sizeOf = (src) => ({ width: src.naturalWidth || src.width, height: src.naturalHeight || src.height });

/**
 * 解碼圖片：先試 createImageBitmap，不行再用 <img>（較舊的 Safari、部分格式）
 * 兩種方式都會依 EXIF 方向轉正，直式照片不會躺著
 */
export async function decodeImage(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch { /* 改用 <img> */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    if (!sizeOf(img).width) throw new Error('empty');
    return img;
  } catch {
    throw new Error(DECODE_ERROR);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 畫到最長邊 ≤ maxSide 的 canvas；縮小超過一半時分段縮，避免鋸齒 */
function drawScaled(src, maxSide) {
  let { width, height } = sizeOf(src);
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  let cur = src;
  const temps = [];
  while (width / 2 > w) {
    width = Math.round(width / 2);
    height = Math.round(height / 2);
    const step = Object.assign(document.createElement('canvas'), { width, height });
    step.getContext('2d').drawImage(cur, 0, 0, width, height);
    temps.push(step);
    cur = step;
  }
  const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // 透明的 PNG 轉 JPEG 時底色用白色，不會變黑
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cur, 0, 0, w, h);
  for (const t of temps) releaseCanvas(t);
  return canvas;
}

/** iOS Safari 的 canvas 記憶體上限很低，用完立刻釋放 */
function releaseCanvas(canvas) {
  canvas.width = 0;
  canvas.height = 0;
}

const toBlob = (canvas, type, quality) => new Promise((resolve, reject) => {
  canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('照片編碼失敗'))), type, quality);
});

/**
 * 使用者選的照片（JPEG／PNG／WebP）→ { blob, thumb, width, height }
 * blob：最長邊 1600px 的 JPEG；thumb：最長邊 300px 的 JPEG
 * 一律經過 Canvas 重新編碼，原檔的 EXIF（含 GPS 位置）不會被保留
 */
export async function compressPhoto(file) {
  if (!PHOTO_TYPES.includes(file.type)) throw new Error(TYPE_ERROR);
  const src = await decodeImage(file);
  const canvas = drawScaled(src, PHOTO_MAX_SIDE);
  src.close?.();
  try {
    let blob = await toBlob(canvas, 'image/jpeg', PHOTO_QUALITY);
    if (blob.size > PHOTO_RETRY_BYTES) blob = await toBlob(canvas, 'image/jpeg', PHOTO_RETRY_QUALITY);
    const thumbCanvas = drawScaled(canvas, THUMB_MAX_SIDE);
    const thumb = await toBlob(thumbCanvas, 'image/jpeg', THUMB_QUALITY);
    releaseCanvas(thumbCanvas);
    return { blob, thumb, width: canvas.width, height: canvas.height };
  } finally {
    releaseCanvas(canvas);
  }
}

/** 已存好的 JPEG → 縮圖（匯入備份時重新產生；解碼失敗代表檔案壞掉） */
export async function makeThumb(blob) {
  const src = await decodeImage(blob);
  const canvas = drawScaled(src, THUMB_MAX_SIDE);
  src.close?.();
  try {
    return await toBlob(canvas, 'image/jpeg', THUMB_QUALITY);
  } finally {
    releaseCanvas(canvas);
  }
}

/* ===== base64（備份檔用） ===== */

/** 分段轉換，避免大檔案超過 String.fromCharCode 的參數上限 */
export async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const CHUNK = 0x8000;
  let s = '';
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

/** n 位元組轉成 base64 後的長度 */
export const base64Length = (n) => Math.ceil(n / 3) * 4;

/** base64 → Uint8Array；格式不對回傳 null */
export function base64ToBytes(b64) {
  if (typeof b64 !== 'string' || b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return null;
  try {
    const s = atob(b64);
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/* ===== JPEG 驗證 ===== */

/**
 * 解析 JPEG 檔頭取得寬高：開頭 SOI（FF D8）、結尾 EOI（FF D9），
 * 中間各段標記長度要對得上，直到讀到 SOF（畫面尺寸）。不是合法 JPEG 回傳 null
 */
export function jpegSize(bytes) {
  const n = bytes?.length ?? 0;
  if (n < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[n - 2] !== 0xff || bytes[n - 1] !== 0xd9) return null;
  let i = 2;
  while (i + 4 <= n) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) { i += 1; continue; } // 填充位元組
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; } // 沒有長度的標記
    if (marker === 0xda || marker === 0xd9) return null; // 還沒讀到尺寸就開始影像資料或結束
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2 || i + 2 + len > n) return null;
    // SOF0–SOF15（C4 DHT、C8 保留、CC DAC 不是）
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (len < 7) return null;
      const height = (bytes[i + 5] << 8) | bytes[i + 6];
      const width = (bytes[i + 7] << 8) | bytes[i + 8];
      return width && height ? { width, height } : null;
    }
    i += 2 + len;
  }
  return null;
}

/* ===== 上傳前的中繼資料清除（咖啡社群） ===== */

const segName = (marker) => (marker === 0xfe ? 'COM' : `APP${marker - 0xe0}`);

/**
 * 列出 JPEG 影像資料（SOS）之前的中繼資料段：APP0–APP15、COM（註解）
 * 回傳 [{ name: 'APP1', id: 'Exif', offset, length }]；id 是段落開頭的識別字串（例如 JFIF、Exif、ICC_PROFILE）
 * 不是合法的 JPEG 結構回傳 null
 */
export function jpegMetadata(bytes) {
  const n = bytes?.length ?? 0;
  if (n < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const found = [];
  let i = 2;
  while (i + 4 <= n) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) { i += 1; continue; }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    if (marker === 0xda) return found; // 影像資料開始，後面沒有中繼資料段
    if (marker === 0xd9) return null;
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2 || i + 2 + len > n) return null;
    if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) {
      let id = '';
      for (let k = i + 4; k < Math.min(i + 2 + len, i + 20) && bytes[k] !== 0; k++) id += String.fromCharCode(bytes[k]);
      found.push({ name: segName(marker), id, offset: i, length: 2 + len });
    }
    i += 2 + len;
  }
  return null;
}

/** 只有 JFIF 標頭（APP0 'JFIF'）不含任何個人資訊，其他中繼資料段一律移除 */
const isAllowedSegment = (seg) => seg.name === 'APP0' && seg.id === 'JFIF';

/**
 * 移除 EXIF（含 GPS）、XMP、ICC、Photoshop、註解等中繼資料段，影像資料原封不動（不會再壓縮一次）
 * 不是合法的 JPEG 回傳 null
 */
export function stripJpegMetadata(bytes) {
  const segs = jpegMetadata(bytes);
  if (!segs) return null;
  const drop = segs.filter((seg) => !isAllowedSegment(seg));
  if (!drop.length) return bytes;
  const out = new Uint8Array(bytes.length - drop.reduce((sum, seg) => sum + seg.length, 0));
  let from = 0;
  let to = 0;
  for (const seg of drop) {
    out.set(bytes.subarray(from, seg.offset), to);
    to += seg.offset - from;
    from = seg.offset + seg.length;
  }
  out.set(bytes.subarray(from), to);
  return out;
}

/** 重新編碼成最長邊 ≤ 1600px 的 JPEG，品質由高往低試到 ≤ 1MB */
async function reencodeForUpload(blob) {
  const src = await decodeImage(blob);
  const canvas = drawScaled(src, PHOTO_MAX_SIDE);
  src.close?.();
  try {
    for (const q of UPLOAD_QUALITIES) {
      const out = await toBlob(canvas, 'image/jpeg', q);
      if (out.size <= CLOUD_PHOTO_MAX_BYTES) return new Uint8Array(await out.arrayBuffer());
    }
    throw new Error('照片太大，無法上傳');
  } finally {
    releaseCanvas(canvas);
  }
}

/**
 * 上傳到雲端前的最後一道檢查（照片來源是本機已經重新編碼過的 JPEG，這裡再保險一次）：
 * 不是 JPEG、最長邊 > 1600px 或 > 1MB 就重新編碼；最後移除 JFIF 以外的所有中繼資料段
 * 回傳 image/jpeg 的 Blob；仍不符合就丟出錯誤，絕不上傳
 */
export async function photoForUpload(blob) {
  let bytes = new Uint8Array(await blob.arrayBuffer());
  const size = jpegSize(bytes);
  if (!size || Math.max(size.width, size.height) > PHOTO_MAX_SIDE || bytes.length > CLOUD_PHOTO_MAX_BYTES) {
    bytes = await reencodeForUpload(blob);
  }
  bytes = stripJpegMetadata(bytes);
  const segs = bytes && jpegMetadata(bytes);
  const finalSize = bytes && jpegSize(bytes);
  if (!segs || !finalSize || !segs.every(isAllowedSegment)
      || Math.max(finalSize.width, finalSize.height) > PHOTO_MAX_SIDE || bytes.length > CLOUD_PHOTO_MAX_BYTES) {
    throw new Error('照片處理失敗，無法上傳');
  }
  return new Blob([bytes], { type: 'image/jpeg' });
}
