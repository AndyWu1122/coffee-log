// #/beans/new、#/beans/<id> 新增 / 編輯豆子
import {
  getBean, getBeanStock, getBeanPhoto, saveBean, setBeanArchived, deleteBean, todayLocal, formatGrams, formatStock, PROCESS, ROAST_LEVEL,
  preparePhoto, PHOTO_ACCEPT, COUNTRIES, ORIGIN_GROUPS, COUNTRY_BY_CODE, REGION_BY_KEY, regionsOf, matchOrigin,
} from '../models.js';
import { esc, setTitle, toast, segmentedHtml, bindSegmented, segmentedValue, showErrors, photoFieldHtml, bindPhotoField } from './ui.js';

const toOptions = (labels) => Object.entries(labels).map(([value, label]) => ({ value, label }));

const countryOptions = (selected) => Object.entries(ORIGIN_GROUPS).map(([group, label]) => `
  <optgroup label="${esc(label)}">
    ${COUNTRIES.filter((c) => c.group === group)
      .map((c) => `<option value="${esc(c.code)}"${c.code === selected ? ' selected' : ''}>${esc(c.zh)}</option>`).join('')}
  </optgroup>`).join('');
const regionOptions = (country, selected) => `<option value="">不指定</option>${regionsOf(country)
  .map((r) => `<option value="${esc(r.key)}"${r.key === selected ? ' selected' : ''}>${esc(r.zh)}</option>`).join('')}`;
const placeText = ({ country, region }) => [COUNTRY_BY_CODE.get(country)?.zh, REGION_BY_KEY.get(region)?.zh].filter(Boolean).join('・');

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

  const b = bean ?? { name: '', origin: '', country: '', region: '', process: 'washed', roastLevel: 'light', roastDate: '' };

  container.innerHTML = `
    <form class="form" novalidate>
      <div class="field" data-field="name">
        <label for="name">名稱 *</label>
        <input id="name" name="name" value="${esc(b.name)}" placeholder="例：衣索比亞 耶加雪菲" autocomplete="off" maxlength="100">
        <div class="error"></div>
      </div>
      <!-- 產地：國家、產區從清單選（產地地圖用），莊園、批次等其他資訊寫在文字欄 -->
      <div class="field" data-field="country">
        <label for="country">產地國家</label>
        <select id="country" name="country">
          <option value="">沒選</option>
          ${countryOptions(b.country)}
        </select>
        <p class="hint origin-guess" hidden><span></span>
          <button class="btn" type="button" data-action="apply-guess">套用</button></p>
        <div class="error"></div>
      </div>
      <div class="field" data-field="region"${b.country ? '' : ' hidden'}>
        <label for="region">產區</label>
        <select id="region" name="region">${regionOptions(b.country, b.region)}</select>
        <div class="error"></div>
      </div>
      <div class="field" data-field="origin">
        <label for="origin">莊園 / 批次</label>
        <input id="origin" name="origin" value="${esc(b.origin)}" autocomplete="off" maxlength="100" placeholder="例：Konga 處理站 G1">
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

  // 產地：選了國家才顯示產區；沒選國家時，從名稱和文字猜到就提示「看起來是…」，按「套用」才填（不自動存猜的）
  const f0 = form.elements;
  const regionField = form.querySelector('[data-field="region"]');
  const guessHint = form.querySelector('.origin-guess');
  let guess = null;
  const setCountry = (country, region = '') => {
    f0.country.value = country;
    f0.region.innerHTML = regionOptions(country, region);
    regionField.hidden = !country;
  };
  const updateGuess = () => {
    guess = f0.country.value ? null : matchOrigin(f0.origin.value, f0.name.value);
    guessHint.hidden = !guess;
    if (guess) guessHint.querySelector('span').textContent = `看起來是 ${placeText(guess)}`;
  };
  f0.country.addEventListener('change', () => { setCountry(f0.country.value); updateGuess(); });
  f0.name.addEventListener('input', updateGuess);
  f0.origin.addEventListener('input', updateGuess);
  updateGuess();

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
      country: f.country.value,
      region: f.region.value,
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
    if (action === 'apply-guess' && guess) {
      setCountry(guess.country, guess.region);
      updateGuess();
      f0.country.focus();
    } else if (action === 'archive') {
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
