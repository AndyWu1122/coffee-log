// 分享卡片的計算：圖片裁切、雷達圖座標、文字換行、檔名
// 純函式，不碰 DOM／Canvas（量字寬由呼叫端傳入 measure），由 models.js 轉出給 views

/**
 * cover 裁切：來源圖要取哪一塊，才能填滿 dstW×dstH 又不變形（置中裁掉多的部分）
 * 回傳 drawImage 的 sx, sy, sw, sh
 */
export function coverCrop(srcW, srcH, dstW, dstH) {
  const scale = Math.max(dstW / srcW, dstH / srcH);
  const sw = dstW / scale;
  const sh = dstH / scale;
  return { sx: (srcW - sw) / 2, sy: (srcH - sh) / 2, sw, sh };
}

/**
 * 雷達圖座標：values 依軸的順序（第一軸朝上，順時針），null 當 0，max 為滿分
 * 全部都是 null 回傳 null（不畫）
 * 回傳 { points: [{x, y}]（資料多邊形）, axes: [{x, y, dx, dy}]（各軸端點與方向） }
 */
export function radarPoints(values, cx, cy, r, max = 5) {
  if (!values.length || values.every((v) => v == null)) return null;
  const n = values.length;
  const axes = values.map((_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const dx = Math.round(Math.cos(a) * 1e9) / 1e9; // 去掉 6e-17 這類浮點誤差
    const dy = Math.round(Math.sin(a) * 1e9) / 1e9;
    return { x: cx + dx * r, y: cy + dy * r, dx, dy };
  });
  const points = values.map((v, i) => {
    const k = Math.min(max, Math.max(0, Number(v) || 0)) / max;
    return { x: cx + axes[i].dx * r * k, y: cy + axes[i].dy * r * k };
  });
  return { points, axes };
}

// 中日韓文字、全形標點：每個字都可以斷行
const CJK = '\\u2E80-\\u9FFF\\uF900-\\uFAFF\\uFE30-\\uFE4F\\uFF00-\\uFFEF';
const TOKEN = new RegExp(`[${CJK}]|[^\\s${CJK}]+\\s*|\\s+`, 'gu');
// 不能放在行首的標點
const NO_LINE_START = /^[，。、！？；：」』）】》〉,.!?;:)\]}…％%]/u;

/**
 * 文字換行：中文逐字、英文逐詞（太長的單字再逐字切），保留原本的換行
 * measure(text) 回傳寬度；超過 maxLines 行時截斷，最後一行結尾加「…」
 * 回傳每一行的字串陣列（每行寬度都 ≤ maxWidth）
 */
export function wrapText(text, maxWidth, measure, maxLines = Infinity) {
  if (maxLines < 1) return [];
  const lines = [];
  let truncated = false;
  const push = (line) => {
    if (lines.length >= maxLines) { truncated = true; return false; }
    lines.push(line.trimEnd());
    return true;
  };

  const paras = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .trim()                     // 開頭、結尾的空行不算內容（結尾的會被誤判成「還有下一行」）
    .replace(/\n{3,}/g, '\n\n') // 連續空行最多留一行
    .split('\n');
  outer: for (const para of paras) {
    let line = '';
    for (const token of para.match(TOKEN) ?? []) {
      if (measure(line + token.trimEnd()) <= maxWidth) { line += token; continue; }
      // 避頭：「，」「。」這類標點不放在行首，把前一個字一起帶到下一行
      let carry = '';
      if (NO_LINE_START.test(token) && Array.from(line.trimEnd()).length > 1) {
        const chars = Array.from(line.trimEnd());
        carry = chars.pop();
        line = chars.join('');
      }
      if (line.trim() && !push(line)) break outer;
      line = carry;
      const t = carry ? token : token.trimStart(); // 新的一行不以空白開頭
      if (carry) {
        if (measure(line + t.trimEnd()) <= maxWidth) { line += t; continue; }
        if (!push(carry)) break outer; // 寬度窄到連兩個字都放不下：前一個字自己一行
      }
      line = '';
      if (!t) continue;
      if (measure(t.trimEnd()) <= maxWidth) { line = t; continue; }
      // 單一個字詞比整行還寬：逐字切（Array.from 不會切壞 emoji 等代理對）
      for (const ch of Array.from(t)) {
        if (measure(line + ch) <= maxWidth || !line) { line += ch; continue; }
        if (!push(line)) break outer;
        line = ch.trimStart();
      }
    }
    if (!push(line)) break;
  }
  // 結尾的空行沒有意義
  while (lines.length && !lines[lines.length - 1]) lines.pop();

  if (truncated && lines.length) {
    let last = lines[lines.length - 1];
    while (last && measure(`${last}…`) > maxWidth) last = Array.from(last).slice(0, -1).join('');
    lines[lines.length - 1] = `${last.trimEnd()}…`;
  }
  return lines;
}

/**
 * 標籤排版（風味標籤）：widths 為各標籤寬度，依序由左到右排、放不下就換行，最多 maxRows 行
 * 放不下的標籤收成最後一個「+N」標籤，寬度由 moreWidth(n) 提供；比整行還寬的標籤寬度縮成 maxWidth
 * 回傳 { items: [{ index, x, row, w }], more: { n, x, row, w } | null, rows }
 */
export function layoutChips(widths, maxWidth, gap, maxRows, moreWidth) {
  if (!widths.length || maxRows < 1) return { items: [], more: null, rows: 0 };
  // 試排前 count 個標籤，再加上一個寬度 extraW 的「+N」（選填）
  const place = (count, extraW) => {
    let x = 0;
    let row = 0;
    const put = (width) => {
      const w = Math.min(width, maxWidth);
      if (x > 0 && x + w > maxWidth) { row += 1; x = 0; }
      const p = { x, row, w };
      x += w + gap;
      return p;
    };
    const items = widths.slice(0, count).map((w, index) => ({ index, ...put(w) }));
    const more = extraW == null ? null : put(extraW);
    return { items, more, rows: row + 1 };
  };
  const all = place(widths.length);
  if (all.rows <= maxRows) return all;
  for (let count = widths.length - 1; count >= 0; count--) {
    const n = widths.length - count;
    const r = place(count, moreWidth(n));
    if (r.rows <= maxRows) return { ...r, more: { n, ...r.more } };
  }
  return { items: [], more: null, rows: 0 }; // 連「+N」都放不下（寬度極窄）
}

/**
 * 分享圖檔名：coffee-<豆子名稱>-<YYYY-MM-DD>.png
 * 名稱只留文字、數字、底線、連字號（其他字元、空白、emoji 都換成 -），最多 40 字
 */
export function shareFileName(beanName, date) {
  const name = Array.from(
    String(beanName ?? '')
      .normalize('NFC')
      .replace(/[︀-️‍]/g, '') // emoji 的變體選擇符、連接符（屬於 \p{M}，下一步不會被去掉）
      .replace(/[^\p{L}\p{M}\p{N}_-]+/gu, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-|-$/g, ''),
  ).slice(0, 40).join('').replace(/-$/, '');
  return `coffee-${name || 'brew'}-${date}.png`;
}
