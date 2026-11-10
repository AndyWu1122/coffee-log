// #/backup JSON 匯出匯入（從右上角 ☰ 選單進入）
import {
  exportData, exportFileName, importData, getBackupStatus, getBackupSummary, recordBackup, formatDaysAgo, formatBytes,
  isInAppBrowser,
} from '../models.js';
import { esc, setTitle, toast, segmentedHtml, bindSegmented, segmentedValue, downloadJson, notifyBadgesChanged } from './ui.js';

const IMPORT_MODES = [
  { value: 'merge', label: '合併' },
  { value: 'replace', label: '取代全部' },
];

const shortDate = new Intl.DateTimeFormat('zh-TW', { month: 'numeric', day: 'numeric' });

/** 下載備份檔並記下備份時間（首頁的備份提醒也用這個，預設包含照片）；☰ 和「備份」的「!」跟著消失 */
export async function exportBackup({ includePhotos = true } = {}) {
  downloadJson(exportFileName(), await exportData({ includePhotos }));
  await recordBackup();
  notifyBadgesChanged();
}

/**
 * LINE、Facebook 等 App 內建的瀏覽器會忽略 <a download>：按了沒有檔案，所以不能當成已經備份
 * 改成先把備份檔準備好，再讓使用者按一次「分享備份檔」（navigator.share 必須在點擊當下呼叫）；
 * 瀏覽器不能分享檔案時回傳 null（畫面請他改用 Safari／Chrome）
 */
async function inAppBackupFile({ includePhotos }) {
  const json = JSON.stringify(await exportData({ includePhotos }), null, 2);
  const file = new File([json], exportFileName(), { type: 'application/json' });
  return navigator.canShare?.({ files: [file] }) ? file : null;
}

/** 匯出、匯入失敗的原因（可直接顯示） */
export const errorReason = (err) => (err?.name === 'QuotaExceededError' ? '手機的儲存空間不足' : err?.message || '發生錯誤');

export function lastBackupText({ lastBackupAt, daysSince }) {
  return lastBackupAt
    ? `上次備份：${shortDate.format(new Date(lastBackupAt))}（${formatDaysAgo(daysSince)}）`
    : '還沒備份過';
}

export async function render(container, { isCurrent }) {
  setTitle('備份');
  const [summary, status] = await Promise.all([getBackupSummary(), getBackupStatus()]);
  if (!isCurrent()) return;

  const inApp = isInAppBrowser();
  container.innerHTML = `
    <section class="section panel" id="export-section">
      <h2>匯出</h2>
      <p class="last-backup${status.remind ? ' is-overdue' : ''}" id="last-backup">${esc(lastBackupText(status))}</p>
      <p class="hint">${summary.empty ? '還沒有資料可以匯出。' : `目前有 ${summary.beans} 支豆子、${summary.grinders} 台磨豆機、${summary.drippers} 支濾杯、${summary.brews} 筆紀錄、${summary.photos} 張照片。`}資料只存在這支手機上，建議定期匯出，存到雲端硬碟。</p>
      ${inApp ? `<div class="notice" id="in-app-notice">你現在是在 LINE、Facebook 這類 App 內建的瀏覽器裡：這裡不能直接下載檔案，而且這裡的資料和 Safari／Chrome 是分開的。要把這裡的資料帶走，請按「匯出 JSON」後再按「分享備份檔」。</div>` : ''}
      <label class="switch-row is-compact"><input type="checkbox" id="include-photos" checked><span>包含照片</span></label>
      <p class="hint" id="export-size"></p>
      <button class="btn btn-primary btn-block" type="button" id="export">匯出 JSON</button>
      <div id="export-result"></div>
    </section>

    <section class="section panel" id="import-section">
      <h2>匯入</h2>
      ${segmentedHtml('mode', IMPORT_MODES, 'merge')}
      <p class="hint" id="mode-hint"></p>
      <label class="btn btn-block" for="import-file">選擇備份檔…</label>
      <input type="file" id="import-file" accept="application/json,.json" hidden>
      <div id="import-result"></div>
    </section>
  `;

  const includePhotos = container.querySelector('#include-photos');
  const sizeEl = container.querySelector('#export-size');
  const updateSize = () => {
    const bytes = includePhotos.checked ? summary.sizeWithPhotos : summary.sizeWithoutPhotos;
    sizeEl.textContent = `預估檔案大小：${formatBytes(bytes)}${includePhotos.checked ? '' : '（不含照片）'}`;
  };
  includePhotos.addEventListener('change', updateSize);
  updateSize();

  const modeHint = container.querySelector('#mode-hint');
  const updateHint = (_, mode) => {
    modeHint.textContent = mode === 'replace'
      ? '先清空現有的所有資料（含照片），再匯入檔案內容。'
      : '保留現有資料；檔案中相同 id 的資料會覆蓋現有的。';
  };
  // 綁在這頁自己的元素上：#app 換頁不會被替換，綁在 container 上的監聽器會殘留到其他頁，
  // 讓紀錄表單的分段按鈕被切換兩次（選了又取消）
  bindSegmented(container.querySelector('#import-section'), updateHint);
  updateHint('mode', 'merge');

  const exportBtn = container.querySelector('#export');
  const exportResult = container.querySelector('#export-result');
  const markExported = async () => {
    const el = container.querySelector('#last-backup');
    el.textContent = lastBackupText(await getBackupStatus());
    el.classList.remove('is-overdue');
    toast('已匯出');
  };
  exportBtn.addEventListener('click', async () => {
    // 按下時再問一次（打開這一頁之後可能才有資料）：什麼都沒有就不匯出空的檔案
    if ((await getBackupSummary()).empty) { toast('還沒有資料可以匯出'); return; }
    exportBtn.disabled = true; // 照片多時轉 base64 需要一點時間，避免重複按
    try {
      if (inApp) {
        const file = await inAppBackupFile({ includePhotos: includePhotos.checked });
        showInAppResult(file);
        return;
      }
      await exportBackup({ includePhotos: includePhotos.checked });
    } catch (err) {
      console.error(err);
      toast(`匯出失敗：${errorReason(err)}`);
      return;
    } finally {
      exportBtn.disabled = false;
    }
    await markExported();
  });

  // App 內建的瀏覽器：備份檔準備好之後，按「分享備份檔」才真的交出去；分享完成才記成已備份
  function showInAppResult(file) {
    if (!file) {
      exportResult.innerHTML = `<div class="notice notice-error" id="in-app-blocked">這個瀏覽器沒辦法匯出檔案，<strong>還沒有備份</strong>。
        請用 Safari 或 Chrome 開啟這個網址；在這裡新增的資料不會跟過去，重要的紀錄請先在那邊重新輸入。</div>`;
      return;
    }
    exportResult.innerHTML = `
      <p class="hint">備份檔準備好了（${esc(formatBytes(file.size))}）。按下面的按鈕，選「儲存到檔案」或傳給自己。</p>
      <button class="btn btn-primary btn-block" type="button" id="share-backup">分享備份檔</button>`;
    exportResult.querySelector('#share-backup').addEventListener('click', async () => {
      try {
        await navigator.share({ files: [file] });
      } catch (err) {
        if (err?.name !== 'AbortError') toast(`分享失敗：${errorReason(err)}`); // 自己按取消的不用提示
        return;
      }
      await recordBackup();
      notifyBadgesChanged();
      exportResult.innerHTML = '';
      await markExported();
    });
  }

  const fileInput = container.querySelector('#import-file');
  const resultEl = container.querySelector('#import-result');
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = ''; // 讓同一個檔案可以再選一次
    if (!file) return;

    const replace = segmentedValue(container, 'mode') === 'replace';
    if (replace) {
      const current = await getBackupSummary();
      const ok = confirm(`將刪除現有的 ${current.beans} 支豆子、${current.grinders} 台磨豆機、${current.drippers} 支濾杯、${current.brews} 筆紀錄、${current.photos} 張照片，改用備份檔內容。確定？`);
      if (!ok) return;
    }

    resultEl.innerHTML = '<p class="hint">讀取備份檔中…</p>';
    let result;
    try {
      result = await importData(await file.text(), {
        replace,
        onProgress: (n, total) => { resultEl.innerHTML = `<p class="hint">處理照片中… ${n}／${total}</p>`; },
      });
    } catch (err) {
      // 讀檔或寫入失敗（例如空間不足）：寫入是單一交易，失敗時整個回滾，資料不會只匯入一半
      console.error(err);
      result = { ok: false, errors: [`無法完成匯入：${errorReason(err)}`] };
    }
    if (!result.ok) {
      resultEl.innerHTML = `
        <div class="notice notice-error">
          <strong>沒有匯入任何資料：</strong>
          <ul>${result.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
        </div>`;
      return;
    }
    toast(`已匯入 ${result.beans} 支豆子、${result.grinders} 台磨豆機、${result.drippers} 支濾杯、${result.brews} 筆紀錄、${result.photos} 張照片`);
    notifyBadgesChanged(); // 紀錄變了，該不該備份可能跟著變
    location.hash = '#/';
  });
}
