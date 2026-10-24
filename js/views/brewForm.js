// #/brew/new、#/brew/<id> 新增 / 編輯沖煮紀錄
import {
  getBrew, saveBrew, deleteBrew, listBeans, listRecentDrippers,
  ratio, formatRatio, toSeconds, toLocalInputValue, fromLocalInputValue, FLAVOR,
} from '../models.js';
import { esc, setTitle, toast, segmentedHtml, bindSegmented, segmentedValue, showErrors } from './ui.js';

const SCORE_OPTIONS = [1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }));

export async function render(container, { id, query, isCurrent }) {
  const isNew = id === null;
  const [brew, beans, drippers] = await Promise.all([
    isNew ? null : getBrew(id),
    listBeans({ includeArchived: true }),
    listRecentDrippers(),
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

  // TODO v0.2：query.from 有值時，複製該筆紀錄的參數當預設值
  void query;
  const b = brew ?? {
    beanId: beanOptions[0].id,
    brewedAt: new Date().toISOString(),
    dripper: drippers[0] ?? '',
    grindSetting: '', coffeeG: '', waterG: '', tempC: '',
    totalTimeS: null, rating: null, flavor: {}, notes: '',
  };
  const totalMin = b.totalTimeS == null ? '' : Math.floor(b.totalTimeS / 60);
  const totalSec = b.totalTimeS == null ? '' : b.totalTimeS % 60;

  container.innerHTML = `
    <form class="form" novalidate>
      <div class="field" data-field="beanId">
        <label for="beanId">豆子 *</label>
        <select id="beanId" name="beanId">
          ${beanOptions.map((bean) => `
            <option value="${esc(bean.id)}" ${bean.id === b.beanId ? 'selected' : ''}>
              ${esc(bean.name)}${bean.archived ? '（已封存）' : ''}
            </option>`).join('')}
        </select>
        <div class="error"></div>
      </div>

      <div class="field" data-field="brewedAt">
        <label for="brewedAt">沖煮時間 *</label>
        <input id="brewedAt" name="brewedAt" type="datetime-local" value="${esc(toLocalInputValue(b.brewedAt))}">
        <div class="error"></div>
      </div>

      <div class="field-row">
        <div class="field" data-field="dripper">
          <label for="dripper">濾杯</label>
          <input id="dripper" name="dripper" list="dripper-list" value="${esc(b.dripper)}" placeholder="V60" autocomplete="off">
          <datalist id="dripper-list">${drippers.map((d) => `<option value="${esc(d)}">`).join('')}</datalist>
          <div class="error"></div>
        </div>
        <div class="field" data-field="grindSetting">
          <label for="grindSetting">研磨度</label>
          <input id="grindSetting" name="grindSetting" value="${esc(b.grindSetting)}" placeholder="例：24 格" autocomplete="off">
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

      <div class="field" data-field="tempC">
        <label for="tempC">水溫 (°C)</label>
        <input id="tempC" name="tempC" type="number" inputmode="numeric" min="70" max="100" value="${esc(b.tempC ?? '')}" placeholder="92">
        <div class="error"></div>
      </div>

      <div class="field" data-field="totalTimeS">
        <span class="label">總時間</span>
        <div class="field-row">
          <input name="totalMin" type="number" inputmode="numeric" min="0" value="${esc(totalMin)}" placeholder="分" aria-label="分">
          <input name="totalSec" type="number" inputmode="numeric" min="0" max="59" value="${esc(totalSec)}" placeholder="秒" aria-label="秒">
        </div>
        <div class="error"></div>
      </div>

      <div class="field" data-field="rating">
        <span class="label">整體評分</span>
        ${segmentedHtml('rating', SCORE_OPTIONS, b.rating, { allowEmpty: true })}
        <div class="error"></div>
      </div>

      ${Object.entries(FLAVOR).map(([key, label]) => `
        <div class="field" data-field="flavor.${key}">
          <span class="label">${label}</span>
          ${segmentedHtml(`flavor.${key}`, SCORE_OPTIONS, b.flavor?.[key], { allowEmpty: true })}
          <div class="error"></div>
        </div>`).join('')}

      <div class="field" data-field="notes">
        <label for="notes">筆記</label>
        <textarea id="notes" name="notes" placeholder="風味、下次想調整的地方…">${esc(b.notes)}</textarea>
      </div>

      <div class="actions">
        <button class="btn btn-primary btn-block" type="submit">儲存</button>
        ${isNew ? '' : '<button class="btn btn-danger btn-block" type="button" data-action="delete">刪除這筆紀錄</button>'}
      </div>
    </form>
  `;

  const form = container.querySelector('form');
  const f = form.elements;
  bindSegmented(form);

  // 粉水比即時更新
  const ratioEl = form.querySelector('#ratio');
  const updateRatio = () => {
    ratioEl.textContent = `粉水比 ${formatRatio(ratio({ coffeeG: Number(f.coffeeG.value), waterG: Number(f.waterG.value) }))}`;
  };
  f.coffeeG.addEventListener('input', updateRatio);
  f.waterG.addEventListener('input', updateRatio);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const result = await saveBrew({
      id: brew?.id,
      beanId: f.beanId.value,
      brewedAt: fromLocalInputValue(f.brewedAt.value),
      dripper: f.dripper.value,
      grindSetting: f.grindSetting.value,
      coffeeG: f.coffeeG.value,
      waterG: f.waterG.value,
      tempC: f.tempC.value,
      totalTimeS: toSeconds(f.totalMin.value, f.totalSec.value),
      rating: segmentedValue(form, 'rating'),
      flavor: Object.fromEntries(Object.keys(FLAVOR).map((k) => [k, segmentedValue(form, `flavor.${k}`)])),
      notes: f.notes.value,
    });
    if (!result.ok) return showErrors(form, result.errors);
    toast('已儲存');
    location.hash = '#/';
  });

  form.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
    if (!confirm('確定刪除這筆紀錄？')) return;
    await deleteBrew(id);
    toast('已刪除');
    location.hash = '#/';
  });
}
