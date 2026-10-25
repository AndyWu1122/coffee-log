// #/drippers/new、#/drippers/<id> 新增 / 編輯濾杯
import { getDripper, saveDripper, setDripperArchived, deleteDripper } from '../models.js';
import { esc, setTitle, toast, showErrors } from './ui.js';

export async function render(container, { id, isCurrent }) {
  const isNew = id === null;
  const dripper = isNew ? null : await getDripper(id);
  if (!isCurrent()) return;

  if (!isNew && !dripper) {
    setTitle('找不到濾杯');
    container.innerHTML = `<div class="empty"><p>找不到這支濾杯</p><a class="btn" href="#/drippers">回濾杯列表</a></div>`;
    return;
  }
  setTitle(isNew ? '新增濾杯' : '編輯濾杯');

  const d = dripper ?? { name: '', notes: '' };

  container.innerHTML = `
    <form class="form" novalidate>
      <div class="field" data-field="name">
        <label for="name">名稱 *</label>
        <input id="name" name="name" value="${esc(d.name)}" placeholder="例：V60、Kalita 155" autocomplete="off" maxlength="100">
        <div class="error"></div>
      </div>
      <div class="field" data-field="notes">
        <label for="notes">筆記</label>
        <textarea id="notes" name="notes" placeholder="例：陶瓷 02、搭配 Cafec 濾紙">${esc(d.notes)}</textarea>
        <div class="error"></div>
      </div>

      <div class="actions">
        <button class="btn btn-primary btn-block" type="submit">儲存</button>
        ${isNew ? '' : `
          <button class="btn btn-block" type="button" data-action="archive">${dripper.archived ? '取消封存' : '封存（不再使用）'}</button>
          <button class="btn btn-danger btn-block" type="button" data-action="delete">刪除</button>`}
      </div>
    </form>
  `;

  const form = container.querySelector('form');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = form.elements; // form.name 是表單自己的屬性，要從 elements 取
    const result = await saveDripper({ id, name: f.name.value, notes: f.notes.value });
    if (!result.ok) return showErrors(form, result.errors);
    toast('已儲存');
    location.hash = '#/drippers';
  });

  form.addEventListener('click', async (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'archive') {
      await setDripperArchived(id, !dripper.archived);
      toast(dripper.archived ? '已取消封存' : '已封存');
      location.hash = '#/drippers';
    } else if (action === 'delete') {
      if (!confirm(`確定刪除「${dripper.name}」？`)) return;
      const result = await deleteDripper(id);
      if (!result.ok) return alert(result.message);
      toast('已刪除');
      location.hash = '#/drippers';
    }
  });
}
