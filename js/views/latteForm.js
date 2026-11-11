// #/latte/new、#/latte/new?from=<id>（再拉一杯）、#/latte/<id> 新增／編輯拉花紀錄
// 照片放最上面（拉花最重要的就是照片）；照片選完就重新編碼成 JPEG（移除 EXIF），按「儲存」才和紀錄一起寫入
import {
  getLatteArt, saveLatteArt, deleteLatteArt, getLatteArtPhoto, latteTemplateFrom, defaultLatteBeanId, latteSuggestions, listBeans,
  LATTE_PATTERNS, LATTE_SCORES, LATTE_TEXT_MAX, latteTotal, toLocalInputValue, VISIBILITY, socialAvailable, getLatteShareStatus, setHomeTab, fromLocalInputValue, preparePhoto, PHOTO_ACCEPT,
} from '../models.js';
import { esc, setTitle, toast, segmentedHtml, bindSegmented, segmentedValue, showErrors, photoFieldHtml, bindPhotoField } from './ui.js';

const PATTERN_ICON = { heart: '♥', tulip: '🌷', rosetta: '🌿', swan: '🦢', other: '✨' };
const PATTERN_OPTIONS = Object.entries(LATTE_PATTERNS).map(([value, label]) => ({ value, label: `${PATTERN_ICON[value]} ${label}` }));
const SCORE_OPTIONS = [1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }));
const totalText = (scores) => {
  const t = latteTotal({ scores });
  return t == null ? '總分：四項都打完就會算出來' : `總分 ${t.toFixed(1)}`;
};
const VISIBILITY_ICON = { private: '🔒', friends: '👥' };
const VISIBILITY_OPTIONS = Object.entries(VISIBILITY).map(([value, label]) => ({ value, label: `${VISIBILITY_ICON[value]} ${label}` }));
const shortDate =new Intl.DateTimeFormat('zh-TW', { month: 'numeric', day: 'numeric' });

export async function render(container, { id, query, isCurrent }) {
  const isNew = id === null;
  const [art, photo, beans, source, suggestions, shareStatus] = await Promise.all([
    isNew ? null : getLatteArt(id),
    isNew ? null : getLatteArtPhoto(id),
    listBeans({ includeArchived: true }),
    isNew && query.from ? getLatteArt(query.from) : null,
    latteSuggestions(),
    isNew || !socialAvailable ? null : getLatteShareStatus(id),
  ]);
  if (!isCurrent()) return;

  if (!isNew && !art) {
    setTitle('找不到紀錄');
    container.innerHTML = '<div class="empty"><p>找不到這杯拉花</p><a class="btn" href="#/">回紀錄列表</a></div>';
    return;
  }
  setTitle(isNew ? '新增拉花' : '編輯拉花');

  // 豆子選填：只列未封存的；編輯時原本的豆子即使已封存也列出
  const beanOptions = beans.filter((b) => !b.archived || b.id === art?.espressoBeanId);
  const a = art ?? {
    madeAt: new Date().toISOString(), pattern: '', patternNote: '', milk: '', cup: '',
    espressoBeanId: await defaultLatteBeanId(beanOptions), scores: {}, notes: '', visibility: 'private',
  };
  if (!isCurrent()) return;

  let notice = '';
  if (isNew && query.from) {
    if (source) {
      Object.assign(a, latteTemplateFrom(source));
      notice = `已帶入 ${shortDate.format(new Date(source.madeAt))} 的圖案、牛奶、杯子和豆子`;
      if (a.espressoBeanId && !beanOptions.some((b) => b.id === a.espressoBeanId)) {
        a.espressoBeanId = '';
        notice += '（原本的豆子已封存）';
      }
    } else {
      notice = '找不到要複製的紀錄';
    }
  }
  const datalist = (listId, values) => `<datalist id="${listId}">${values.map((v) => `<option value="${esc(v)}"></option>`).join('')}</datalist>`;

  container.innerHTML = `
    <form class="form latte-form" novalidate>
      ${notice ? `<div class="notice">${esc(notice)}</div>` : ''}
      ${photoFieldHtml(PHOTO_ACCEPT)}

      <div class="field pattern-picker" data-field="pattern">
        <span class="label">圖案 *</span>
        ${segmentedHtml('pattern', PATTERN_OPTIONS, a.pattern, { wrap: true })}
        <div class="error"></div>
      </div>

      <div class="field" data-field="patternNote" ${a.pattern === 'other' ? '' : 'hidden'}>
        <label for="patternNote">什麼圖案</label>
        <input id="patternNote" name="patternNote" value="${esc(a.patternNote)}" maxlength="${LATTE_TEXT_MAX}" placeholder="例：多層愛心" autocomplete="off">
        <div class="error"></div>
      </div>

      <div class="field latte-scores">
        <span class="label">自評 *（參考拉花比賽的評分，各 1–5）</span>
        ${Object.entries(LATTE_SCORES).map(([key, { label, hint }]) => `
          <div class="latte-score" data-field="scores.${key}">
            <div class="latte-score-head"><span class="latte-score-name">${esc(label)}</span><span class="hint">${esc(hint)}</span></div>
            ${segmentedHtml(`scores.${key}`, SCORE_OPTIONS, a.scores?.[key])}
            <div class="error"></div>
          </div>`).join('')}
        <div class="ratio-display" id="latte-total" aria-live="polite">${esc(totalText(a.scores))}</div>
      </div>

      <div class="field-row">
        <div class="field" data-field="milk">
          <label for="milk">牛奶</label>
          <input id="milk" name="milk" list="milk-list" value="${esc(a.milk)}" maxlength="${LATTE_TEXT_MAX}" placeholder="例：全脂、燕麥" autocomplete="off">
          ${datalist('milk-list', suggestions.milk)}
          <div class="error"></div>
        </div>
        <div class="field" data-field="cup">
          <label for="cup">杯子</label>
          <input id="cup" name="cup" list="cup-list" value="${esc(a.cup)}" maxlength="${LATTE_TEXT_MAX}" placeholder="例：300ml 拿鐵杯" autocomplete="off">
          ${datalist('cup-list', suggestions.cup)}
          <div class="error"></div>
        </div>
      </div>

      <div class="field" data-field="espressoBeanId">
        <label for="espressoBeanId">豆子</label>
        <select id="espressoBeanId" name="espressoBeanId">
          <option value="">不指定</option>
          ${beanOptions.map((b) => `<option value="${esc(b.id)}" ${b.id === a.espressoBeanId ? 'selected' : ''}>
            ${esc(b.name)}${b.archived ? '（已封存）' : ''}</option>`).join('')}
        </select>
        <div class="error"></div>
      </div>

      <div class="field" data-field="madeAt">
        <label for="madeAt">時間 *</label>
        <input id="madeAt" name="madeAt" type="datetime-local" value="${esc(toLocalInputValue(a.madeAt))}">
        <div class="error"></div>
      </div>

      <div class="field" data-field="notes">
        <label for="notes">筆記</label>
        <textarea id="notes" name="notes" placeholder="打奶泡、融合、注入高度…下次想改的地方">${esc(a.notes)}</textarea>
        <div class="error"></div>
      </div>

      ${socialAvailable ? `
        <div class="field" data-field="visibility">
          <span class="label">誰看得到</span>
          ${segmentedHtml('visibility', VISIBILITY_OPTIONS, a.visibility ?? 'private')}
          <p class="hint" id="visibility-hint"></p>
          <p class="share-status" id="share-status" hidden></p>
          <div class="error"></div>
        </div>` : ''}

      <button class="btn btn-primary btn-block save-bar" type="submit">儲存</button>
      ${isNew ? '' : `<div class="actions">
        <a class="btn btn-block" href="#/latte/new?from=${esc(id)}" aria-label="用這杯的圖案、牛奶、杯子再拉一杯">再拉一杯</a>
        <button class="link-btn delete-btn" type="button" data-action="delete">刪除這杯拉花</button>
      </div>`}
    </form>`;

  const form = container.querySelector('form');
  const f = form.elements;
  const noteField = form.querySelector('[data-field="patternNote"]');
  // 可見度：選「好友」時說明會分享哪些內容；分享狀態只在可見度沒改過時顯示（改了要存檔後才算數）
  const visibilityHint = form.querySelector('#visibility-hint');
  const statusEl = form.querySelector('#share-status');
  const updateVisibility = (value) => {
    if (!visibilityHint) return;
    visibilityHint.textContent = value === 'friends'
      ? '照片、圖案、四項自評、牛奶、杯子和筆記會讓好友看到（只有互相加好友的人；豆子不會上傳）'
      : '只存在這支手機，不會上傳';
    const showStatus = Boolean(shareStatus) && value === (a.visibility ?? 'private');
    statusEl.hidden = !showStatus;
    if (showStatus) {
      statusEl.textContent = shareStatus.text;
      statusEl.dataset.tone = shareStatus.tone;
    }
  };
  updateVisibility(a.visibility ?? 'private');
  const readScores = () => Object.fromEntries(Object.keys(LATTE_SCORES).map((k) => [k, Number(segmentedValue(form, `scores.${k}`)) || null]));
  const totalEl = form.querySelector('#latte-total');
  bindSegmented(form, (name, value) => {
    // 選了就拿掉這一項「請選擇／請打分」的錯誤（不用等下次按儲存）
    const field = form.querySelector(`[data-field="${name}"]`);
    if (field && value) {
      field.classList.remove('invalid');
      field.querySelector('.error').textContent = '';
    }
    if (name === 'pattern') noteField.hidden = value !== 'other';
    if (name === 'visibility') updateVisibility(value);
    if (name.startsWith('scores.')) totalEl.textContent = totalText(readScores());
  });
  const photoField = bindPhotoField(form, { photo, prepare: preparePhoto, alt: '這杯拉花的照片' });

  let saving = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (photoField.busy()) { toast('照片處理中，請稍候'); return; }
    if (saving) return; // 避免連按存成兩筆
    saving = true;
    try {
      const result = await saveLatteArt({
        id: art?.id,
        madeAt: fromLocalInputValue(f.madeAt.value),
        pattern: segmentedValue(form, 'pattern'),
        patternNote: f.patternNote.value,
        scores: readScores(),
        milk: f.milk.value,
        cup: f.cup.value,
        espressoBeanId: f.espressoBeanId.value,
        notes: f.notes.value,
        visibility: socialAvailable ? segmentedValue(form, 'visibility') : (art?.visibility ?? 'private'),
      }, { photo: photoField.change() });
      if (!result.ok) { showErrors(form, result.errors); return; }
    } finally {
      saving = false;
    }
    toast('已儲存');
    await setHomeTab('latte'); // 回到首頁的「拉花」分頁，看得到剛存的這杯
    location.hash = '#/';
  });

  form.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
    const extra = [photo ? '照片也會一起刪除。' : '', art.visibility === 'friends' ? '好友也會看不到。' : ''].join('');
    if (!confirm(`確定刪除這杯拉花？${extra}`)) return;
    await deleteLatteArt(id);
    toast('已刪除');
    await setHomeTab('latte');
    location.hash = '#/';
  });

  return photoField.cleanup;
}
