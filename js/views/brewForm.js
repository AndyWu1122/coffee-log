// #/brew/new、#/brew/<id> 新增 / 編輯沖煮紀錄
import {
  getBrew, saveBrew, deleteBrew, listBeans, latestBrewByBean, brewTemplateFrom,
  listGrinders, defaultGrinderId, listDrippers, defaultDripperId, formatStock, ratio, formatRatio, toSeconds, toLocalInputValue, fromLocalInputValue, FLAVOR,
  getPhoto, preparePhoto, PHOTO_ACCEPT, VISIBILITY, socialAvailable, getShareStatus,
} from '../models.js';
import { esc, setTitle, toast, segmentedHtml, bindSegmented, segmentedValue, showErrors, photoFieldHtml, bindPhotoField } from './ui.js';
import { createFlavorPicker } from './flavorPicker.js';

const SCORE_OPTIONS = [1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }));
const VISIBILITY_ICON = { private: '🔒', friends: '👥' };
const VISIBILITY_OPTIONS = Object.entries(VISIBILITY).map(([value, label]) => ({ value, label: `${VISIBILITY_ICON[value]} ${label}` }));
const shortDate = new Intl.DateTimeFormat('zh-TW', { month: 'numeric', day: 'numeric' });

export async function render(container, { id, query, isCurrent }) {
  const isNew = id === null;
  const [brew, photo, beans, grinders, drippers, latestByBean, source, defaultGrinder, defaultDripper, shareStatus] = await Promise.all([
    isNew ? null : getBrew(id),
    isNew ? null : getPhoto(id),
    listBeans({ includeArchived: true }),
    listGrinders({ includeArchived: true }),
    listDrippers({ includeArchived: true }),
    isNew ? latestBrewByBean() : new Map(),
    isNew && query.from ? getBrew(query.from) : null,
    isNew ? defaultGrinderId() : '',
    isNew ? defaultDripperId() : '',
    isNew || !socialAvailable ? null : getShareStatus(id),
  ]);
  if (!isCurrent()) return;

  if (!isNew && !brew) {
    setTitle('找不到紀錄');
    container.innerHTML = `<div class="empty"><p>找不到這筆紀錄</p><a class="btn" href="#/">回紀錄列表</a></div>`;
    return;
  }

  // 下拉只列未封存的豆子；編輯時原本的豆子即使已封存也要列出
  const beanOptions = beans.filter((b) => !b.archived || b.id === brew?.beanId);
  if (beanOptions.length === 0) {
    setTitle('新增紀錄');
    container.innerHTML = `
      <div class="empty">
        <p>要先有豆子才能記錄沖煮</p>
        <a class="btn btn-primary" href="#/beans/new">新增豆子</a>
      </div>`;
    return;
  }
  setTitle(isNew ? '新增紀錄' : '編輯紀錄');

  // 磨豆機、濾杯同樣只列未封存的；編輯時原本那台即使已封存也列出
  const grinderOptions = grinders.filter((g) => !g.archived || g.id === brew?.grinderId);
  const hasActiveGrinder = grinders.some((g) => !g.archived);
  const dripperOptions = drippers.filter((d) => !d.archived || d.id === brew?.dripperId);
  const hasActiveDripper = drippers.some((d) => !d.archived);

  const b = brew ?? {
    beanId: beanOptions[0].id,
    grinderId: defaultGrinder,
    brewedAt: new Date().toISOString(),
    dripperId: defaultDripper,
    grindSetting: '', coffeeG: '', waterG: '', tempC: '',
    totalTimeS: null, rating: null, flavor: {}, flavorNotes: [], notes: '', visibility: 'private',
  };

  // #/brew/new?from=<id>：複製該筆紀錄的參數
  let notice = '';
  if (isNew && query.from) {
    if (source) {
      Object.assign(b, brewTemplateFrom(source));
      notice = `已帶入 ${shortDate.format(new Date(source.brewedAt))} 的參數`;
      if (!beanOptions.some((bean) => bean.id === b.beanId)) {
        b.beanId = beanOptions[0].id;
        notice += '（原本的豆子已封存，請重新選擇豆子）';
      }
      // 原紀錄沒有磨豆機、或那台已封存／刪除時，改用預設值
      if (!grinderOptions.some((g) => g.id === b.grinderId)) b.grinderId = defaultGrinder;
      if (!dripperOptions.some((d) => d.id === b.dripperId)) b.dripperId = defaultDripper;
    } else {
      notice = '找不到要複製的紀錄';
    }
  }
  const totalMin = b.totalTimeS == null ? '' : Math.floor(b.totalTimeS / 60);
  const totalSec = b.totalTimeS == null ? '' : b.totalTimeS % 60;

  container.innerHTML = `
    <form class="form" novalidate>
      ${notice ? `<div class="notice">${esc(notice)}</div>` : ''}
      <div class="field" data-field="beanId">
        <label for="beanId">豆子 *</label>
        <select id="beanId" name="beanId">
          ${beanOptions.map((bean) => `
            <option value="${esc(bean.id)}" ${bean.id === b.beanId ? 'selected' : ''}>
              ${esc(bean.name)}${bean.archived ? '（已封存）' : ''}${bean.stock ? `（${esc(formatStock(bean.stock, { short: true }))}）` : ''}
            </option>`).join('')}
        </select>
        <div class="error"></div>
        ${isNew ? '<a class="btn btn-block" id="copy-last" hidden>帶入這支豆子上次的參數</a>' : ''}
      </div>

      <div class="field" data-field="brewedAt">
        <label for="brewedAt">沖煮時間 *</label>
        <input id="brewedAt" name="brewedAt" type="datetime-local" value="${esc(toLocalInputValue(b.brewedAt))}">
        <div class="error"></div>
      </div>

      <div class="field" data-field="dripperId">
        <label for="dripperId">濾杯</label>
        <select id="dripperId" name="dripperId">
          <option value="">未指定</option>
          ${dripperOptions.map((d) => `
            <option value="${esc(d.id)}" ${d.id === b.dripperId ? 'selected' : ''}>
              ${esc(d.name)}${d.archived ? '（已封存）' : ''}
            </option>`).join('')}
        </select>
        <div class="error"></div>
        ${hasActiveDripper ? '' : '<a class="field-link" href="#/drippers/new">＋ 新增濾杯</a>'}
      </div>

      <div class="field" data-field="grinderId">
        <label for="grinderId">磨豆機</label>
        <select id="grinderId" name="grinderId">
          <option value="">未指定</option>
          ${grinderOptions.map((g) => `
            <option value="${esc(g.id)}" ${g.id === b.grinderId ? 'selected' : ''}>
              ${esc(g.name)}${g.archived ? '（已封存）' : ''}
            </option>`).join('')}
        </select>
        <div class="error"></div>
        ${hasActiveGrinder ? '' : '<a class="field-link" href="#/grinders/new">＋ 新增磨豆機</a>'}
      </div>

      <div class="field-row">
        <div class="field" data-field="grindSetting">
          <label for="grindSetting">研磨度</label>
          <input id="grindSetting" name="grindSetting" value="${esc(b.grindSetting)}" placeholder="例：24 格" autocomplete="off">
          <div class="error"></div>
        </div>
        <div class="field" data-field="tempC">
          <label for="tempC">水溫 (°C)</label>
          <input id="tempC" name="tempC" type="number" inputmode="numeric" min="70" max="100" value="${esc(b.tempC ?? '')}" placeholder="92">
          <div class="error"></div>
        </div>
      </div>

      <div class="field-row">
        <div class="field" data-field="coffeeG">
          <label for="coffeeG">粉量 (g) *</label>
          <input id="coffeeG" name="coffeeG" type="number" inputmode="decimal" step="0.1" min="0" value="${esc(b.coffeeG)}" placeholder="15">
          <div class="error"></div>
        </div>
        <div class="field" data-field="waterG">
          <label for="waterG">水量 (g) *</label>
          <input id="waterG" name="waterG" type="number" inputmode="decimal" step="1" min="0" value="${esc(b.waterG)}" placeholder="240">
          <div class="error"></div>
        </div>
      </div>
      <div class="ratio-display" id="ratio">粉水比 ${formatRatio(ratio(b))}</div>

      <div class="field" data-field="totalTimeS">
        <span class="label">總時間</span>
        <div class="field-row">
          <label class="unit-input">
            <input name="totalMin" type="number" inputmode="numeric" min="0" value="${esc(totalMin)}" placeholder="2" aria-label="分">
            <span class="unit" aria-hidden="true">分</span>
          </label>
          <label class="unit-input">
            <input name="totalSec" type="number" inputmode="numeric" min="0" max="59" value="${esc(totalSec)}" placeholder="30" aria-label="秒">
            <span class="unit" aria-hidden="true">秒</span>
          </label>
        </div>
        <div class="error"></div>
      </div>

      <div class="field" data-field="rating">
        <span class="label">整體評分</span>
        ${segmentedHtml('rating', SCORE_OPTIONS, b.rating, { allowEmpty: true })}
        <div class="error"></div>
      </div>

      <div class="score-rows">
        ${Object.entries(FLAVOR).map(([key, label]) => `
          <div class="field score-row" data-field="flavor.${key}">
            <span class="label">${label}</span>
            ${segmentedHtml(`flavor.${key}`, SCORE_OPTIONS, b.flavor?.[key], { allowEmpty: true })}
            <div class="error"></div>
          </div>`).join('')}
      </div>

      <div class="field" data-field="flavorNotes">
        <span class="label">風味輪</span>
        <div class="flavor-picker" id="flavor-picker"></div>
        <div class="error"></div>
      </div>

      <div class="field" data-field="notes">
        <label for="notes">筆記</label>
        <textarea id="notes" name="notes" placeholder="風味、下次想調整的地方…">${esc(b.notes)}</textarea>
        <div class="error"></div>
      </div>

      ${photoFieldHtml(PHOTO_ACCEPT)}

      ${socialAvailable ? `
        <div class="field" data-field="visibility">
          <span class="label">誰看得到</span>
          ${segmentedHtml('visibility', VISIBILITY_OPTIONS, b.visibility ?? 'private')}
          <p class="hint" id="visibility-hint"></p>
          <p class="share-status" id="share-status" hidden></p>
          <div class="error"></div>
        </div>` : ''}

      <button class="btn btn-primary btn-block save-bar" type="submit">儲存</button>
      <div class="actions">
        <button class="btn btn-block" type="button" data-action="share">${isNew ? '儲存並分享' : '分享'}</button>
        ${isNew ? '' : `
          <a class="btn btn-block" href="#/brew/new?from=${esc(id)}">用這次參數再沖一杯</a>
          <button class="btn btn-danger btn-block" type="button" data-action="delete">刪除這筆紀錄</button>`}
      </div>
    </form>
  `;

  const form = container.querySelector('form');
  const f = form.elements;

  // 可見度：選「好友」時提醒會分享哪些內容；分享狀態只在可見度沒改過時顯示（改了要存檔後才算數）
  const visibilityHint = form.querySelector('#visibility-hint');
  const statusEl = form.querySelector('#share-status');
  const updateVisibility = (value) => {
    if (!visibilityHint) return;
    visibilityHint.textContent = value === 'friends'
      ? '豆子、參數、風味、筆記和照片都會讓好友看到（只有互相加好友的人）'
      : '只存在這支手機，不會上傳';
    const showStatus = Boolean(shareStatus) && value === (b.visibility ?? 'private');
    statusEl.hidden = !showStatus;
    if (showStatus) {
      statusEl.textContent = shareStatus.text;
      statusEl.dataset.tone = shareStatus.tone;
    }
  };
  updateVisibility(b.visibility ?? 'private');
  bindSegmented(form, (name, value) => { if (name === 'visibility') updateVisibility(value); });
  const flavorPicker = createFlavorPicker(form.querySelector('#flavor-picker'), b.flavorNotes ?? []);

  // 粉水比即時更新
  const ratioEl = form.querySelector('#ratio');
  const updateRatio = () => {
    ratioEl.textContent = `粉水比 ${formatRatio(ratio({ coffeeG: Number(f.coffeeG.value), waterG: Number(f.waterG.value) }))}`;
  };
  f.coffeeG.addEventListener('input', updateRatio);
  f.waterG.addEventListener('input', updateRatio);

  // 「帶入這支豆子上次的參數」：隨選擇的豆子更新；沒紀錄或剛帶入的就是那筆時隱藏
  const copyLast = form.querySelector('#copy-last');
  const updateCopyLast = () => {
    const last = latestByBean.get(f.beanId.value);
    copyLast.hidden = !last || last.id === query.from;
    if (last) copyLast.href = `#/brew/new?from=${encodeURIComponent(last.id)}`;
  };
  if (copyLast) {
    f.beanId.addEventListener('change', updateCopyLast);
    updateCopyLast();
  }

  // 照片：選完就壓縮（重新編碼成 JPEG、移除 EXIF）並預覽，按「儲存」才和紀錄一起寫入
  const photoField = bindPhotoField(form, { photo, prepare: preparePhoto, alt: '這杯咖啡的照片' });

  /** 存檔（含照片）；成功回傳存好的紀錄，驗證失敗顯示錯誤並回傳 null */
  let saving = false;
  const save = async () => {
    if (photoField.busy()) { toast('照片處理中，請稍候'); return null; }
    if (saving) return null; // 避免連按存成兩筆
    saving = true;
    try {
      const result = await saveBrewFromForm();
      if (!result.ok) { showErrors(form, result.errors); return null; }
      return result.brew;
    } finally {
      saving = false;
    }
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!(await save())) return;
    toast('已儲存');
    location.hash = '#/';
  });

  // 分享前先存檔：剛選的照片、改過的欄位才會出現在卡片上
  form.querySelector('[data-action="share"]').addEventListener('click', async () => {
    const saved = await save();
    if (!saved) return;
    toast('已儲存');
    location.hash = `#/brew/${encodeURIComponent(saved.id)}/share`;
  });

  function saveBrewFromForm() {
    return saveBrew({
      id: brew?.id,
      beanId: f.beanId.value,
      grinderId: f.grinderId.value,
      brewedAt: fromLocalInputValue(f.brewedAt.value),
      dripperId: f.dripperId.value,
      grindSetting: f.grindSetting.value,
      coffeeG: f.coffeeG.value,
      waterG: f.waterG.value,
      tempC: f.tempC.value,
      totalTimeS: toSeconds(f.totalMin.value, f.totalSec.value),
      rating: segmentedValue(form, 'rating'),
      flavor: Object.fromEntries(Object.keys(FLAVOR).map((k) => [k, segmentedValue(form, `flavor.${k}`)])),
      flavorNotes: flavorPicker.value(),
      notes: f.notes.value,
      visibility: socialAvailable ? segmentedValue(form, 'visibility') : (brew?.visibility ?? 'private'),
    }, { photo: photoField.change() });
  }

  form.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
    const extra = [photo ? '照片也會一起刪除。' : '', brew.visibility === 'friends' ? '好友也會看不到。' : ''].join('');
    if (!confirm(`確定刪除這筆紀錄？${extra}`)) return;
    await deleteBrew(id);
    toast('已刪除');
    location.hash = '#/';
  });

  // 離開頁面時釋放照片的 objectURL
  return photoField.cleanup;
}
