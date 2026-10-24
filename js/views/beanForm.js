// #/beans/new、#/beans/<id> 新增 / 編輯豆子
import { getBean, saveBean, setBeanArchived, deleteBean, todayLocal, PROCESS, ROAST_LEVEL } from '../models.js';
import { esc, setTitle, toast, segmentedHtml, bindSegmented, segmentedValue, showErrors } from './ui.js';

const toOptions = (labels) => Object.entries(labels).map(([value, label]) => ({ value, label }));

export async function render(container, { id, isCurrent }) {
  const isNew = id === null;
  const bean = isNew ? null : await getBean(id);
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
        <input id="name" name="name" value="${esc(b.name)}" placeholder="例：衣索比亞 耶加雪菲" autocomplete="off">
        <div class="error"></div>
      </div>
      <div class="field" data-field="origin">
        <label for="origin">產地 / 莊園</label>
        <input id="origin" name="origin" value="${esc(b.origin)}" autocomplete="off">
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

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = form.elements; // 注意 form.name 是表單自己的屬性，要從 elements 取
    const result = await saveBean({
      id,
      name: f.name.value,
      origin: f.origin.value,
      process: segmentedValue(form, 'process'),
      roastLevel: segmentedValue(form, 'roastLevel'),
      roastDate: f.roastDate.value,
    });
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
      if (!confirm(`確定刪除「${bean.name}」？`)) return;
      const result = await deleteBean(id);
      if (!result.ok) return alert(result.message);
      toast('已刪除');
      location.hash = '#/beans';
    }
  });
}
