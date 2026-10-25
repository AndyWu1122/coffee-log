// #/beans/new、#/beans/<id> 新增 / 編輯豆子
import {
  getBean, getBeanStock, getBeanPhoto, saveBean, setBeanArchived, deleteBean, todayLocal, formatGrams, formatStock, PROCESS, ROAST_LEVEL,
  preparePhoto, PHOTO_ACCEPT,
} from '../models.js';
import { esc, setTitle, toast, segmentedHtml, bindSegmented, segmentedValue, showErrors, photoFieldHtml, bindPhotoField } from './ui.js';

const toOptions = (labels) => Object.entries(labels).map(([value, label]) => ({ value, label }));

export async function render(container, { id, isCurrent }) {
  const isNew = id === null;
  const [bean, stock, photo] = isNew ? [null, null, null] : await Promise.all([getBean(id), getBeanStock(id), getBeanPhoto(id)]);
  if (!isCurrent()) return;

  if (!isNew && !bean) {
    setTitle('找不到豆子');
    container.innerHTML = `<div class="empty"><p>找不到這支豆子</p><a class="btn" href="#/beans">回豆子列表</a></div>`;
    return;
  }
  setTitle(isNew ? '新增豆子' : '編輯豆子');

  const b = bean ?? { name: '', origin: '', process: 'washed', roastLevel: 'light', roastDate: '' };

  container.innerHTML = `
    <form class="form" novalidate>
      <div class="field" data-field="name">
        <label for="name">名稱 *</label>
        <input id="name" name="name" value="${esc(b.name)}" placeholder="例：衣索比亞 耶加雪菲" autocomplete="off" maxlength="100">
        <div class="error"></div>
      </div>
      <div class="field" data-field="origin">
        <label for="origin">產地 / 莊園</label>
        <input id="origin" name="origin" value="${esc(b.origin)}" autocomplete="off" maxlength="100">
        <div class="error"></div>
      </div>
      <div class="field" data-field="process">
        <span class="label">處理法 *</span>
        ${segmentedHtml('process', toOptions(PROCESS), b.process, { wrap: true })}
        <div class="error"></div>
      </div>
      <div class="field" data-field="roastLevel">
        <span class="label">烘焙度 *</span>
        ${segmentedHtml('roastLevel', toOptions(ROAST_LEVEL), b.roastLevel)}
        <div class="error"></div>
      </div>
      <div class="field" data-field="roastDate">
        <label for="roastDate">烘焙日</label>
        <input id="roastDate" name="roastDate" type="date" value="${esc(b.roastDate)}" max="${todayLocal()}">
        <div class="error"></div>
      </div>
      <div class="field" data-field="bagWeightG">
        <label for="bagWeightG">整包重量 (g)</label>
        <input id="bagWeightG" name="bagWeightG" type="number" inputmode="decimal" step="1" min="0"
          value="${esc(b.bagWeightG ?? '')}" placeholder="例：200（填了才會計算剩餘量）">
        <div class="error"></div>
        ${stock ? `<p class="hint stock-hint">已用 ${formatGrams(stock.usedG)}（${stock.usedCups} 杯）・${esc(formatStock(stock))}</p>` : ''}
      </div>
      ${photoFieldHtml(PHOTO_ACCEPT)}

      <div class="actions">
        <button class="btn btn-primary btn-block" type="submit">儲存</button>
        ${isNew ? '' : `
          <button class="btn btn-block" type="button" data-action="archive">${bean.archived ? '取消封存' : '封存（喝完了）'}</button>
          <button class="btn btn-danger btn-block" type="button" data-action="delete">刪除</button>`}
      </div>
    </form>
  `;

  const form = container.querySelector('form');
  bindSegmented(form);
  // 照片（例如豆袋）：和紀錄一樣，選完就重新編碼成 JPEG、移除 EXIF 並預覽，按「儲存」才寫入；只存在這支手機
  const photoField = bindPhotoField(form, { photo, prepare: preparePhoto, alt: '這支豆子的照片' });
  let saving = false;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (photoField.busy()) return toast('照片處理中，請稍候');
    if (saving) return; // 避免連按存成兩支
    saving = true;
    const f = form.elements; // 注意 form.name 是表單自己的屬性，要從 elements 取
    const result = await saveBean({
      id,
      name: f.name.value,
      origin: f.origin.value,
      process: segmentedValue(form, 'process'),
      roastLevel: segmentedValue(form, 'roastLevel'),
      roastDate: f.roastDate.value,
      bagWeightG: f.bagWeightG.value,
    }, { photo: photoField.change() }).finally(() => { saving = false; });
    if (!result.ok) return showErrors(form, result.errors);
    toast('已儲存');
    location.hash = '#/beans';
  });

  form.addEventListener('click', async (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'archive') {
      await setBeanArchived(id, !bean.archived);
      toast(bean.archived ? '已取消封存' : '已封存');
      location.hash = '#/beans';
    } else if (action === 'delete') {
      if (!confirm(`確定刪除「${bean.name}」？${photo ? '照片也會一起刪除。' : ''}`)) return;
      const result = await deleteBean(id);
      if (!result.ok) return alert(result.message);
      toast('已刪除');
      location.hash = '#/beans';
    }
  });

  // 離開頁面時釋放照片的 objectURL
  return photoField.cleanup;
}
