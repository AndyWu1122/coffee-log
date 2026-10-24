// #/backup JSON 匯出匯入（從右上角 ☰ 選單進入）
import {
  exportData, exportFileName, importData, getBackupStatus, recordBackup, formatDaysAgo,
} from '../models.js';
import { esc, setTitle, toast, segmentedHtml, bindSegmented, segmentedValue, downloadJson } from './ui.js';

const IMPORT_MODES = [
  { value: 'merge', label: '合併' },
  { value: 'replace', label: '取代全部' },
];

const shortDate = new Intl.DateTimeFormat('zh-TW', { month: 'numeric', day: 'numeric' });

/** 下載備份檔並記下備份時間（首頁的備份提醒也用這個） */
export async function exportBackup() {
  downloadJson(exportFileName(), await exportData());
  await recordBackup();
}

export function lastBackupText({ lastBackupAt, daysSince }) {
  return lastBackupAt
    ? `上次備份：${shortDate.format(new Date(lastBackupAt))}（${formatDaysAgo(daysSince)}）`
    : '還沒備份過';
}

export async function render(container, { isCurrent }) {
  setTitle('備份');
  const [{ beans, grinders, brews }, status] = await Promise.all([exportData(), getBackupStatus()]);
  if (!isCurrent()) return;

  container.innerHTML = `
    <section class="section">
      <h2>匯出</h2>
      <p class="last-backup${status.remind ? ' is-overdue' : ''}" id="last-backup">${esc(lastBackupText(status))}</p>
      <p class="hint">目前有 ${beans.length} 支豆子、${grinders.length} 台磨豆機、${brews.length} 筆紀錄。資料只存在這支手機上，建議定期匯出，存到雲端硬碟。</p>
      <button class="btn btn-primary btn-block" type="button" id="export">匯出 JSON</button>
    </section>

    <section class="section">
      <h2>匯入</h2>
      ${segmentedHtml('mode', IMPORT_MODES, 'merge')}
      <p class="hint" id="mode-hint"></p>
      <label class="btn btn-block" for="import-file">選擇備份檔…</label>
      <input type="file" id="import-file" accept="application/json,.json" hidden>
      <div id="import-result"></div>
    </section>
  `;

  const modeHint = container.querySelector('#mode-hint');
  const updateHint = (_, mode) => {
    modeHint.textContent = mode === 'replace'
      ? '先清空現有的所有資料，再匯入檔案內容。'
      : '保留現有資料；檔案中相同 id 的資料會覆蓋現有的。';
  };
  bindSegmented(container, updateHint);
  updateHint('mode', 'merge');

  container.querySelector('#export').addEventListener('click', async () => {
    await exportBackup();
    const el = container.querySelector('#last-backup');
    el.textContent = lastBackupText(await getBackupStatus());
    el.classList.remove('is-overdue');
    toast('已匯出');
  });

  const fileInput = container.querySelector('#import-file');
  const resultEl = container.querySelector('#import-result');
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = ''; // 讓同一個檔案可以再選一次
    if (!file) return;

    const replace = segmentedValue(container, 'mode') === 'replace';
    if (replace) {
      const current = await exportData();
      const ok = confirm(`將刪除現有的 ${current.beans.length} 支豆子、${current.grinders.length} 台磨豆機、${current.brews.length} 筆紀錄，改用備份檔內容。確定？`);
      if (!ok) return;
    }

    const result = await importData(await file.text(), { replace });
    if (!result.ok) {
      resultEl.innerHTML = `
        <div class="notice notice-error">
          <strong>沒有匯入任何資料：</strong>
          <ul>${result.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
        </div>`;
      return;
    }
    toast(`已匯入 ${result.beans} 支豆子、${result.grinders} 台磨豆機、${result.brews} 筆紀錄`);
    location.hash = '#/';
  });
}
