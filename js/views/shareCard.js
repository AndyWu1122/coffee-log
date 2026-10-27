// #/brew/<id>/share 分享卡片：預覽、選項、分享或下載 PNG
// 全部在手機上用 Canvas 繪製，不上傳任何資料，離線可用
import {
  getShareCardData, decodeImage, coverCrop, radarPoints, wrapText, layoutChips, formatRatio, formatSeconds, formatGrams, FLAVOR,
} from '../models.js';
import { esc, setTitle, toast, segmentedHtml, bindSegmented, segmentedValue, downloadBlob } from './ui.js';

// 卡片是一張圖，不跟著主題切換：固定用深色主題的咖啡色系（值對應 css/style.css 的深色變數）
const C = {
  bg: '#1c140f',
  bgClear: 'rgba(28, 20, 15, 0)', // 照片底部漸層用（bg 的透明版）
  chip: '#3a2a1f',                // 風味標籤底色（surface-2）
  grid: '#4d3a2c',
  text: '#f3e9df',
  dim: '#b8a594',
  accent: '#d9984f',
  accentFill: 'rgba(217, 152, 79, 0.35)',
};
// 和 css/style.css 的 font-family 相同
const FONT = 'system-ui, -apple-system, "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';

export const SIZES = {
  post: { w: 1080, h: 1350, label: 'IG 貼文 4:5' },
  story: { w: 1080, h: 1920, label: '限時動態 9:16' },
};
const SIZE_OPTIONS = Object.entries(SIZES).map(([value, { label }]) => ({ value, label }));

/* ===== 繪製 ===== */

const font = (px, weight = 400) => `${weight} ${px}px ${FONT}`;

/** 五角星路徑 */
function starPath(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
}

/** 圓角矩形路徑（不用 ctx.roundRect：iOS 15 以前的 Safari 沒有） */
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function polygon(ctx, points) {
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
}

/**
 * 在 canvas 上畫分享卡片
 * photo：已解碼的圖片（ImageBitmap 或 <img>），null 表示不放照片
 * 版面由上往下排：照片 → 豆名、資訊 → 參數＋星星（左）與雷達圖（右）→ 筆記 → 頁尾
 * 文字區塊的高度先量好，照片高度＝剩下的空間（有上下限），筆記只用最後剩下的行數，超過截斷加「…」
 * 回傳各區塊的範圍 boxes（測試用：檢查沒有超出畫布、互不重疊）
 */
export function drawCard(canvas, data, { size = 'post', photo = null, includeNotes = false } = {}) {
  const { w: W, h: H } = SIZES[size];
  const story = size === 'story';
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const measureWith = (f) => (t) => { ctx.font = f; return ctx.measureText(t).width; };
  const boxes = [];
  const box = (name, x, y, w, h) => boxes.push({ name, x, y, w, h });

  /** 畫多行文字（每行高 lh，垂直置中），回傳總高度 */
  const drawLines = (lines, f, color, x, y, lh, align = 'left') => {
    ctx.font = f;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    lines.forEach((line, i) => ctx.fillText(line, x, y + i * lh + lh / 2));
    ctx.textAlign = 'left';
    return lines.length * lh;
  };
  /** 字放不下時縮小字級（到 minPx 為止），回傳字級 */
  const fitPx = (text, maxW, px, weight, minPx) => {
    while (px > minPx && measureWith(font(px, weight))(text) > maxW) px -= 2;
    return px;
  };
  /** 單行：先縮字，還是放不下就截斷 */
  const oneLine = (text, maxW, px, weight, minPx) => {
    const fitted = fitPx(text, maxW, px, weight, minPx);
    return { px: fitted, text: wrapText(text, maxW, measureWith(font(fitted, weight)), 1)[0] ?? '' };
  };

  const P = 72;            // 左右邊距
  const CW = W - P * 2;    // 內容寬度
  const GAP = 36;
  const FOOT_H = 36;
  const footerTop = H - 56 - FOOT_H;
  const contentBottom = footerTop - 40;

  /* ---- 1. 量出各區塊 ---- */

  // 豆名（最多 2 行）＋ 產地・處理法・烘焙度・養豆天數（最多 2 行）
  const NAME_F = font(story ? 72 : 64, 700);
  const NAME_LH = story ? 88 : 78;
  const nameLines = wrapText(data.beanName, CW, measureWith(NAME_F), 2);
  const INFO_F = font(32);
  const INFO_LH = 46;
  const infoText = [data.origin, data.process, data.roastLevel, data.restDays != null ? `養豆 ${data.restDays} 天` : '']
    .filter(Boolean).join(' · ');
  const infoLines = infoText ? wrapText(infoText, CW, measureWith(INFO_F), 2) : [];
  const headerH = nameLines.length * NAME_LH + (infoLines.length ? 12 + infoLines.length * INFO_LH : 0);

  // 雷達圖（右側）：上 酸度、右 甜度、下 苦度、左 醇厚度；四項都沒填就不畫
  const flavorKeys = Object.keys(FLAVOR);
  const radar = radarPoints(flavorKeys.map((k) => data.flavor[k]), 0, 0, 1);
  const R = 105;
  const LABEL_F = font(28, 600);
  const LABEL_GAP = 16;
  const LABEL_H = 34;
  const radarLabels = flavorKeys.map((k) => `${FLAVOR[k]} ${data.flavor[k] ?? '–'}`);
  const sideW = radar ? Math.max(...[radarLabels[1], radarLabels[3]].map(measureWith(LABEL_F))) : 0;
  const radarW = radar ? Math.ceil(2 * (R + LABEL_GAP + sideW)) : 0;
  const radarH = radar ? 2 * (R + LABEL_GAP + LABEL_H) : 0;
  const leftW = radar ? CW - radarW - 40 : CW;

  // 左側：粉量→水量、其他參數格、器材、星星
  const SMALL_F = font(26);
  const SMALL_LH = 34;
  const cells = [
    ['粉水比', formatRatio(data.ratio)],
    data.tempC != null && ['水溫', `${data.tempC}°C`],
    data.totalTimeS != null && ['總時間', formatSeconds(data.totalTimeS)],
  ].filter(Boolean);
  const grinderText = data.grinderName
    ? `磨豆機 ${data.grinderName}${data.grindSetting ? `・${data.grindSetting}` : ''}`
    : data.grindSetting ? `研磨度 ${data.grindSetting}` : '';
  // 濾杯（賽風寫「賽風」）、磨豆機各一行（太長各自截斷），不會出現「磨豆機」和名稱被拆到兩行
  const EQUIP_F = font(30);
  const EQUIP_LH = 42;
  const equipLines = [data.method === 'siphon' ? '賽風' : data.dripper && `濾杯 ${data.dripper}`, grinderText]
    .filter(Boolean)
    .map((t) => wrapText(t, leftW, measureWith(EQUIP_F), 1)[0]);
  const STAR = 44;
  const leftH = (SMALL_LH + 6 + 64) + 24 + (SMALL_LH + 6 + 52)
    + (equipLines.length ? 24 + equipLines.length * EQUIP_LH : 0)
    + (data.rating ? 28 + STAR : 0);
  const middleH = Math.max(leftH, radarH);

  // 風味標籤（風味輪選的風味）：自動換行，行數有上限，放不下的收成「+N」
  const CHIP_H = 52;
  const CHIP_GAP = 12;
  const CHIP_PAD = 22;
  const DOT = 14;
  const DOT_GAP = 12;
  const CHIP_F = font(28);
  const measureChip = measureWith(CHIP_F);
  const chipW = (text, dot = true) => CHIP_PAD * 2 + (dot ? DOT + DOT_GAP : 0) + measureChip(text);
  const chipRows = story ? (photo ? 2 : 3) : (photo ? 1 : 2);
  const chips = layoutChips(data.flavorNotes.map((n) => chipW(n.zh)), CW, CHIP_GAP, chipRows, (n) => chipW(`+${n}`, false));
  const chipsH = chips.rows ? chips.rows * CHIP_H + (chips.rows - 1) * CHIP_GAP : 0;

  const fixedH = headerH + GAP + 2 + GAP + middleH + (chipsH ? GAP + chipsH : 0);

  // 筆記
  const NOTE_F = font(32);
  const NOTE_LH = 48;
  const NOTE_PAD = 28;
  const NOTE_GAP = 40;
  const noteText = includeNotes ? data.notes.trim() : '';
  const measureNote = measureWith(NOTE_F);
  const noteAll = noteText ? wrapText(noteText, CW - NOTE_PAD, measureNote) : [];
  const notesH = (n) => (n ? NOTE_GAP + n * NOTE_LH : 0);

  /* ---- 2. 分配高度 ---- */
  let photoH = 0;
  let noteCount;
  let top;
  if (photo) {
    const BELOW_PHOTO = 56;
    const room = contentBottom - BELOW_PHOTO - fixedH; // 照片＋筆記可用的高度
    // 照片最少佔這麼高（開筆記時讓一點給筆記）、最多不超過正方形或畫面 55%
    const minPhoto = Math.round(H * (noteAll.length ? 0.2 : 0.28));
    const hardMinPhoto = Math.round(H * 0.15); // 開了筆記至少給 2 行，照片最多讓到這麼矮
    const maxPhoto = Math.round(Math.min(W, H * 0.55));
    const maxLines = story ? 8 : 4;
    const linesFor = (photoMin) => Math.floor((room - photoMin - NOTE_GAP) / NOTE_LH);
    noteCount = Math.max(0, Math.min(
      noteAll.length, maxLines,
      Math.max(linesFor(minPhoto), Math.min(2, linesFor(hardMinPhoto))),
    ));
    photoH = Math.max(0, Math.min(maxPhoto, room - notesH(noteCount)));
    top = photoH + BELOW_PHOTO;
  } else {
    const room = contentBottom - P - fixedH;
    const maxLines = story ? 14 : 8;
    noteCount = Math.max(0, Math.min(noteAll.length, maxLines, Math.floor((room - NOTE_GAP) / NOTE_LH)));
    // 沒有照片時內容整塊放在略偏上的位置，避免全部擠在上面、下面一大片空白
    top = P + Math.max(0, Math.round((room - notesH(noteCount)) / 2.5));
  }
  const noteLines = noteCount ? wrapText(noteText, CW - NOTE_PAD, measureNote, noteCount) : [];

  /* ---- 3. 繪製 ---- */
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // 照片：cover 裁切填滿上半部，不變形；底部漸層接到背景色
  if (photo && photoH > 0) {
    const srcW = photo.naturalWidth || photo.width;
    const srcH = photo.naturalHeight || photo.height;
    const { sx, sy, sw, sh } = coverCrop(srcW, srcH, W, photoH);
    ctx.drawImage(photo, sx, sy, sw, sh, 0, 0, W, photoH);
    const fade = Math.min(160, photoH / 3);
    const g = ctx.createLinearGradient(0, photoH - fade, 0, photoH);
    g.addColorStop(0, C.bgClear);
    g.addColorStop(1, C.bg);
    ctx.fillStyle = g;
    ctx.fillRect(0, photoH - fade, W, fade);
    box('photo', 0, 0, W, photoH);
  }

  let y = top;
  const nameH = drawLines(nameLines, NAME_F, C.text, P, y, NAME_LH);
  box('name', P, y, CW, nameH);
  y += nameH;
  if (infoLines.length) {
    y += 12;
    const h = drawLines(infoLines, INFO_F, C.dim, P, y, INFO_LH);
    box('info', P, y, CW, h);
    y += h;
  }
  y += GAP;
  ctx.fillStyle = C.grid;
  ctx.fillRect(P, y, CW, 2);
  y += 2 + GAP;

  // 左側參數
  let ly = y;
  drawLines(['粉量 → 水量'], SMALL_F, C.dim, P, ly, SMALL_LH);
  const doseText = `${formatGrams(data.coffeeG)} → ${formatGrams(data.waterG)}`;
  const dose = oneLine(doseText, leftW, 60, 700, 36);
  drawLines([dose.text], font(dose.px, 700), C.accent, P, ly + SMALL_LH + 6, 64);
  box('dose', P, ly, leftW, SMALL_LH + 6 + 64);
  ly += SMALL_LH + 6 + 64 + 24;

  const CELL_GAP = 24;
  const cellW = (leftW - CELL_GAP * (cells.length - 1)) / cells.length;
  cells.forEach(([label, value], i) => {
    const x = P + i * (cellW + CELL_GAP);
    drawLines([oneLine(label, cellW, 26, 400, 20).text], SMALL_F, C.dim, x, ly, SMALL_LH);
    const v = oneLine(value, cellW, 44, 700, 26);
    drawLines([v.text], font(v.px, 700), C.text, x, ly + SMALL_LH + 6, 52);
  });
  box('params', P, ly, leftW, SMALL_LH + 6 + 52);
  ly += SMALL_LH + 6 + 52;

  if (equipLines.length) {
    ly += 24;
    const h = drawLines(equipLines, EQUIP_F, C.text, P, ly, EQUIP_LH);
    box('equip', P, ly, leftW, h);
    ly += h;
  }

  if (data.rating) {
    ly += 28;
    for (let i = 0; i < 5; i++) {
      starPath(ctx, P + STAR / 2 + i * (STAR + 10), ly + STAR / 2, STAR / 2);
      ctx.fillStyle = i < data.rating ? C.accent : C.grid;
      ctx.fill();
    }
    box('stars', P, ly, 5 * STAR + 4 * 10, STAR);
    ly += STAR;
  }

  // 右側雷達圖
  if (radar) {
    const rx = P + CW - radarW;
    const cx = rx + radarW / 2;
    const cy = y + LABEL_H + LABEL_GAP + R;
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 2;
    for (let lv = 1; lv <= 5; lv++) {
      polygon(ctx, radarPoints(flavorKeys.map(() => lv), cx, cy, R).points);
      ctx.stroke();
    }
    const { points, axes } = radarPoints(flavorKeys.map((k) => data.flavor[k]), cx, cy, R);
    for (const a of axes) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(a.x, a.y);
      ctx.stroke();
    }
    polygon(ctx, points);
    ctx.fillStyle = C.accentFill;
    ctx.fill();
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.fillStyle = C.accent;
    for (const p of points) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    // 標籤：上、右、下、左
    drawLines([radarLabels[0]], LABEL_F, C.text, cx, cy - R - LABEL_GAP - LABEL_H, LABEL_H, 'center');
    drawLines([radarLabels[1]], LABEL_F, C.text, cx + R + LABEL_GAP, cy - LABEL_H / 2, LABEL_H, 'left');
    drawLines([radarLabels[2]], LABEL_F, C.text, cx, cy + R + LABEL_GAP, LABEL_H, 'center');
    drawLines([radarLabels[3]], LABEL_F, C.text, cx - R - LABEL_GAP, cy - LABEL_H / 2, LABEL_H, 'right');
    box('radar', rx, y, radarW, radarH);
  }
  y += middleH;

  // 風味標籤：大類顏色的圓點＋名稱；「+N」用次要文字色、沒有圓點
  if (chips.rows) {
    y += GAP;
    const drawChip = (x, top, w, text, color) => {
      roundRectPath(ctx, x, top, w, CHIP_H, CHIP_H / 2);
      ctx.fillStyle = C.chip;
      ctx.fill();
      let tx = x + CHIP_PAD;
      if (color) {
        ctx.beginPath();
        ctx.arc(tx + DOT / 2, top + CHIP_H / 2, DOT / 2, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        tx += DOT + DOT_GAP;
      }
      // 名稱比整行還長時（極少見）截斷
      const label = wrapText(text, x + w - CHIP_PAD - tx, measureChip, 1)[0] ?? '';
      drawLines([label], CHIP_F, color ? C.text : C.dim, tx, top, CHIP_H);
    };
    const rowTop = (row) => y + row * (CHIP_H + CHIP_GAP);
    for (const it of chips.items) {
      const note = data.flavorNotes[it.index];
      drawChip(P + it.x, rowTop(it.row), it.w, note.zh, note.color);
    }
    if (chips.more) drawChip(P + chips.more.x, rowTop(chips.more.row), chips.more.w, `+${chips.more.n}`, null);
    box('flavors', P, y, CW, chipsH);
    y += chipsH;
  }

  // 筆記：左側強調色直線
  if (noteLines.length) {
    y += NOTE_GAP;
    const h = noteLines.length * NOTE_LH;
    ctx.fillStyle = C.accent;
    ctx.fillRect(P, y + 6, 6, h - 12);
    drawLines(noteLines, NOTE_F, C.text, P + NOTE_PAD, y, NOTE_LH);
    box('notes', P, y, CW, h);
    y += h;
  }

  // 頁尾：左邊日期，右下角小字「咖啡紀錄」
  drawLines([data.date.replaceAll('-', '.')], font(28), C.dim, P, footerTop, FOOT_H);
  drawLines(['咖啡紀錄'], font(28, 600), C.dim, W - P, footerTop, FOOT_H, 'right');
  box('footer', P, footerTop, CW, FOOT_H);

  return { width: W, height: H, boxes, noteLines, nameLines, chips };
}

/* ===== 頁面 ===== */

export async function render(container, { id, isCurrent }) {
  setTitle('分享卡片');
  const data = await getShareCardData(id);
  if (!isCurrent()) return;
  if (!data) {
    container.innerHTML = `<div class="empty"><p>找不到這筆紀錄</p><a class="btn" href="#/">回紀錄列表</a></div>`;
    return;
  }
  // 照片解碼失敗就當作沒有照片；畫字之前要等字型載入，中文才不會用錯字型
  const photo = data.photo ? await decodeImage(data.photo.blob).catch(() => null) : null;
  await document.fonts.ready;
  if (!isCurrent()) { photo?.close?.(); return; }

  container.innerHTML = `
    <div class="share">
      <div class="share-preview">
        <canvas id="card" role="img" aria-label="分享卡片預覽"></canvas>
      </div>
      <div class="share-options">
        ${photo ? '<label class="switch-row is-compact"><input type="checkbox" id="opt-photo" checked><span>包含照片</span></label>' : ''}
        ${data.notes ? '<label class="switch-row is-compact"><input type="checkbox" id="opt-notes"><span>包含筆記</span></label>' : ''}
        ${segmentedHtml('size', SIZE_OPTIONS, 'post')}
      </div>
      <div class="share-actions">
        <button type="button" class="btn btn-primary" id="share" disabled>分享</button>
        <button type="button" class="btn" id="download" disabled>下載</button>
      </div>
      <a class="btn btn-block" href="#/brew/${esc(id)}">回到紀錄</a>
    </div>
  `;

  const canvas = container.querySelector('#card');
  const optPhoto = container.querySelector('#opt-photo');
  const optNotes = container.querySelector('#opt-notes');
  const shareBtn = container.querySelector('#share');
  const downloadBtn = container.querySelector('#download');

  // 每次重畫就先轉好 PNG：iOS Safari 要求 navigator.share 在點擊當下呼叫，不能等編碼
  let file = null;
  let token = 0;
  const redraw = () => {
    const t = ++token;
    file = null;
    shareBtn.disabled = downloadBtn.disabled = true;
    drawCard(canvas, data, {
      size: segmentedValue(container, 'size'),
      photo: optPhoto?.checked ? photo : null,
      includeNotes: Boolean(optNotes?.checked),
    });
    canvas.toBlob((blob) => {
      if (t !== token || !blob) return;
      file = new File([blob], data.fileName, { type: 'image/png' });
      shareBtn.disabled = downloadBtn.disabled = false;
    }, 'image/png');
  };
  // 綁在這頁自己的元素上：#app 換頁不會被替換，綁在 container 上的監聽器會殘留到其他頁
  bindSegmented(container.querySelector('.share'), redraw);
  optPhoto?.addEventListener('change', redraw);
  optNotes?.addEventListener('change', redraw);
  redraw();

  const download = () => downloadBlob(file.name, file);
  downloadBtn.addEventListener('click', () => {
    if (!file) return;
    download();
    toast('已下載圖片');
  });
  shareBtn.addEventListener('click', async () => {
    if (!file) return;
    if (!navigator.canShare?.({ files: [file] })) {
      download();
      toast('這個瀏覽器不支援分享圖片，已改為下載');
      return;
    }
    try {
      await navigator.share({ files: [file] });
    } catch (err) {
      if (err.name === 'AbortError') return; // 使用者自己關掉分享面板
      download();
      toast('無法分享，已改為下載');
    }
  });

  // 離開頁面：釋放解碼的照片與 canvas 記憶體
  return () => {
    token++;
    photo?.close?.();
    canvas.width = 0;
    canvas.height = 0;
  };
}
