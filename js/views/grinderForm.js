// #/grinders/new、#/grinders/<id> 新增 / 編輯磨豆機
import { getGrinder, saveGrinder, setGrinderArchived, deleteGrinder } from '../models.js';
import { esc, setTitle, toast, showErrors } from './ui.js';

export async function render(container, { id, isCurrent }) {
  const isNew = id === null;
  const grinder = isNew ? null : await getGrinder(id);
  if (!isCurrent()) return;

  if (!isNew && !grinder) {
    setTitle('找不到磨豆機');
    container.innerHTML = `<div class="empty"><p>找不到這台磨豆機</p><a class="btn" href="#/grinders">回磨豆機列表</a></div>`;
    return;
  }
  setTitle(isNew ? '新增磨豆機' : '編輯磨豆機');

  const g = grinder ?? { name: '', notes: '' };

  container.innerHTML = `
    <form class="form" novalidate>
      <div class="field" data-field="name">
        <label for="name">名稱 *</label>
        <input id="name" name="name" value="${esc(g.name)}" placeholder="例：C40、Ode Gen 2" autocomplete="off" maxlength="100">
        <div class="error"></div>
      </div>
      <div class="field" data-field="notes">
        <label for="notes">筆記</label>
        <textarea id="notes" name="notes" placeholder="例：C40 每格約 30 微米，手沖常用 22–26 格">${esc(g.notes)}</textarea>
        <div class="error"></div>
      </div>

      <div class="actions">
        <button class="btn btn-primary btn-block" type="submit">儲存</button>
        ${isNew ? '' : `
          <button class="btn btn-block" type="button" data-action="archive">${grinder.archived ? '取消封存' : '封存（不再使用）'}</button>
          <button class="btn btn-danger btn-block" type="button" data-action="delete">刪除</button>`}
      </div>
    </form>
  `;

  const form = container.querySelector('form');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = form.elements; // form.name 是表單自己的屬性，要從 elements 取
    const result = await saveGrinder({ id, name: f.name.value, notes: f.notes.value });
    if (!result.ok) return showErrors(form, result.errors);
    toast('已儲存');
    location.hash = '#/grinders';
  });

  form.addEventListener('click', async (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'archive') {
      await setGrinderArchived(id, !grinder.archived);
      toast(grinder.archived ? '已取消封存' : '已封存');
      location.hash = '#/grinders';
    } else if (action === 'delete') {
      if (!confirm(`確定刪除「${grinder.name}」？`)) return;
      const result = await deleteGrinder(id);
      if (!result.ok) return alert(result.message);
      toast('已刪除');
      location.hash = '#/grinders';
    }
  });
}
