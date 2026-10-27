# 使用者回饋紀錄

收到的回饋、當時的判斷與決定。決定要做的另外寫進 `roadmap.md`。

## 2026-10-27（版本 1.21.0）

### 1. Google 登入頁按上一頁回來，「用 Google 登入」按了沒反應
- 狀況：手機 Safari 按「用 Google 登入」→ 到 Google 頁面按上一頁取消 → 回到 App，按鈕看起來正常但按了沒反應；切到別的分頁再回帳號頁才恢復
- 原因：`js/views/account.js` 按下時先 `btn.disabled = true` 再換頁；Safari 上一頁從 bfcache 原樣還原整頁，按鈕停在停用狀態
- 可能的修法：`app.js` 監聽 `pageshow`，`event.persisted` 時重畫目前頁面
- 決定：**先不改**（換分頁就能恢復）

### 2. 在 LINE 裡新增的豆子，到 Safari 不見了；LINE 裡匯出顯示「已匯出」但沒有檔案
- 豆子不見：LINE 內建瀏覽器的資料和 Safari 分開存，瀏覽器的限制，App 改不了
- 匯出：LINE 內建瀏覽器忽略 `<a download>`，但 App 照樣顯示「已匯出」並記下 `lastBackupAt`，**備份提醒會被清掉、使用者以為有備份**
- 可能的修法：內建瀏覽器（`isInAppBrowser()`）裡先試 `navigator.share({ files })`，不行就提示用 Safari 開啟、不記成已備份；首頁加「你在 LINE 裡，資料和 Safari 分開」的提示卡片（同 1.20.0 的 iPhone Safari 提示）
- 決定：**先不改**

### 3. 沒有任何資料時還能匯出（全部空陣列的檔案）
- 希望沒有資料時提示「沒有東西可以匯出」
- 可能的修法：豆子、磨豆機、濾杯、紀錄、想買清單都是 0 時停用「匯出 JSON」並寫出原因
- 決定：**先不改**
