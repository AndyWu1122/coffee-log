# 手沖咖啡紀錄 App（coffee-log）

記錄手沖咖啡沖煮參數與風味的 PWA，主要在手機上使用。回覆與註解請用繁體中文。

## 技術規則
- 純 HTML / CSS / JavaScript（ES Modules），**不使用框架、不使用打包工具**
- 儲存：IndexedDB（可用 `idb` 小型 wrapper，或自己包一層）
  - **唯一例外**：外觀偏好（`localStorage['theme']` = auto/light/dark）。它只是這支手機的顯示偏好、不需備份，且必須在 `<head>` 同步讀取才能避免主題閃爍
  - 社群的登入狀態（supabase-js 的 session）也不放 localStorage，存在 IndexedDB 的 meta（key 前綴 `auth:`）
- PWA：manifest.json + Service Worker，需可離線使用
- 部署：GitHub Pages（main 分支根目錄），push 到 main 即自動部署
  - repo：https://github.com/AndyWu1122/coffee-log
  - 網址：https://andywu1122.github.io/coffee-log/（在子路徑下，所有路徑必須用相對路徑）
- 介面以手機直向為主（mobile-first），按鈕要大，方便沖咖啡時單手操作

## 資料夾結構
```
index.html
manifest.json
sw.js
css/style.css
js/app.js          # 進入點 + hash 路由
js/theme.js        # 畫面畫出前套用深色／淺色（<head> 同步載入的一般 script）
js/db.js           # 唯一存取 IndexedDB 的地方
js/models.js       # 驗證、計算（粉水比、養豆天數）
js/flavorWheel.js  # SCA 風味輪靜態資料（三層、中英、大類顏色），由 models.js 轉出給 views
js/image.js        # 照片處理：解碼、縮小、重新編碼 JPEG、base64、JPEG 檔頭驗證、上傳前移除中繼資料（只由 models.js 使用）
js/cardLayout.js   # 分享卡片的純計算：cover 裁切、雷達圖座標、文字換行（含避頭）、檔名；由 models.js 轉出給 views
js/config.js       # Supabase 連線設定（依網址：localhost → 本機、github.io → 正式；null ＝ 沒有社群功能）
js/cloud.js        # 唯一存取 Supabase 的地方（角色和 db.js 一樣）；supabase-js 用到才載入
js/sync.js         # 好友紀錄的同步（本機 friends 紀錄 → shared_brews），只由 models.js 使用
js/vendor/         # 第三方檔案原封不動（supabase-js UMD、qrcode-generator），來源與 SRI 見 js/vendor/README.md
js/views/          # brewList, brewForm, beanList, beanForm, grinderList, grinderForm, backup, shareCard（分享卡片頁＋Canvas 繪製）, flavorPicker（風味輪 SVG）, account（帳號）, friends（好友管理）, feed（好友動態）, feedDetail（好友紀錄詳細、檢舉、封鎖）, privacy（隱私說明）, ui（共用 DOM 工具）
icons/
docs/              # social-spec.md（咖啡社群規格，原文不改）、social-open-questions.md（待決事項與決定）、supabase-setup.md（正式專案與 Google 登入設定步驟）
supabase/          # 咖啡社群後端：config.toml、migrations/（SQL）、tests/（pgTAP 權限測試）、functions/delete-account（刪除帳號的 Edge Function）
scripts/           # 只連本機 Supabase 的測試：supabase-local.mjs、chrome.mjs（共用工具）、supabase-api-test.mjs、supabase-storage-test.mjs、photo-exif-test.mjs、social-ui-test.mjs、social-feed-test.mjs、social-safety-test.mjs
tests/             # photo.html（照片處理測試頁，由 photo-exif-test.mjs 用 headless Chrome 開；不屬於 App、不放進 ASSETS）
```

## 分層規則
views → models → db／cloud，每層只呼叫下一層。views 不可直接碰 IndexedDB 或 Supabase。
- view 的事件監聽器掛在這一頁自己的元素上，**不要掛在 `render` 收到的 container（`#app`）**：`#app` 換頁不會被替換，監聽器會殘留並帶著舊資料處理之後的點擊

## 資料模型（備份 schemaVersion: 3／IndexedDB DB_VERSION: 5）
**beans**：id, name, origin, process(washed/natural/honey/other), roastLevel(light/light-medium/medium-light/medium/dark，即 淺/淺中/中淺/中/深焙), roastDate(YYYY-MM-DD), bagWeightG(整包重量 g，選填), archived(bool), createdAt
**grinders**：id, name(必填), notes(選填，例如刻度說明), archived(bool), createdAt
**brews**：id, beanId, grinderId(選填，'' ＝未指定；v1 舊紀錄沒有這個欄位), brewedAt, dripper, grindSetting, coffeeG, waterG, tempC, totalTimeS(手動輸入), rating(1–5), flavor{acidity, sweetness, bitterness, body}(1–5), flavorNotes(風味輪 key 陣列，如 "fruity.berry.blueberry"，任一層皆可；舊資料預設 []), notes, visibility(private/friends，舊資料沒有這個欄位＝private)
**meta**（DB v3 加入）：{ key, value }，App 自己的狀態（lastBackupAt、backupSnoozeUntil、社群登入狀態 `auth:*`）；**不匯出、匯入取代全部時也不清除**（token 不會進備份檔，匯入也不會被登出）
**photos**（DB v4 加入，keyPath brewId）：brewId, blob(JPEG，最長邊 1600px、品質 0.8，約 200KB), width, height, createdAt；每筆紀錄最多 1 張，跟 brews 分開存
**thumbs**（DB v4 加入，keyPath brewId）：brewId, blob(JPEG，最長邊 300px)；列表只讀這個，不載入原圖；不匯出，匯入時由照片重新產生
**sync**（DB v5 加入，keyPath brewId）：brewId, userId, row(上次同步的 shared_brews 內容 JSON), photoAt(上次同步的照片 createdAt), error(''/rate_limited/invalid/failed), failedRow, failedOn；**不匯出、匯入取代全部時也不清除**
- brews 建索引：beanId、brewedAt、grinderId（v2 加入）
- 有紀錄引用的豆子、磨豆機不能刪除，只能封存
- **照片一律在前端重新編碼成 JPEG（移除 EXIF）後才儲存**（`models.preparePhoto` → `image.compressPhoto`，經 Canvas 重畫，GPS 等資訊不會留下）
- 只接受 JPEG／PNG／WebP（`image.PHOTO_TYPES`，表單 `accept` 用 `models.PHOTO_ACCEPT`）；iPhone 的 HEIC 由系統在選取時轉成 JPEG
- 紀錄與照片一起寫入、一起刪除（`db.transact` 單一交易涵蓋 brews、photos、thumbs）
- 照片顯示用 `URL.createObjectURL`，view 的 `render` 回傳 cleanup 在離開頁面時 `revokeObjectURL`
- DB 升級：`onupgradeneeded` 每一步都先檢查是否已存在，既有 store 用升級交易取得後再加索引，絕不改動舊資料
- 衍生值不儲存：粉水比 = waterG / coffeeG、養豆天數 = 沖煮日 − roastDate，在 models.js 計算
- 豆子剩餘量（衍生值）= bagWeightG − 該豆子所有紀錄 coffeeG 加總；「約幾杯」用該豆子最近 5 杯平均粉量估算（沒沖過就用全部紀錄最近 5 杯），剩 2 杯以下顯示「快沒了」
- id 用 crypto.randomUUID()

## 路由（hash）
`#/` 紀錄列表｜`#/brew/new`｜`#/brew/new?from=<id>` 複製參數新增｜`#/brew/<id>` 編輯｜`#/brew/<id>/share` 分享卡片｜`#/beans`｜`#/beans/new`｜`#/beans/<id>`｜`#/backup` 匯出匯入｜`#/grinders`｜`#/grinders/new`｜`#/grinders/<id>`｜`#/account` 帳號｜`#/friends` 好友管理｜`#/feed` 好友動態｜`#/feed/<owner>/<id>` 好友紀錄詳細｜`#/privacy` 隱私說明｜`#/friends/add?code=<好友代碼>`（QR code 連到這裡）

## 介面配置
- 底部分頁列：紀錄｜豆子｜好友（只放每天會用的頁面；之後的統計頁也放這裡）；「好友」是動態牆，有 `data-social`，`js/config.js` 沒設定時隱藏
- **不常調整的設定放右上角 ☰ 選單，不要加到底部分頁列**（目前有：帳號、好友管理、磨豆機、備份、隱私說明；帳號、好友管理有 `data-social`，`js/config.js` 沒設定時隱藏）
- ☰ 選單裡的頁面不屬於任何分頁，路由設 `tab: null`，底部分頁都不亮

## 主題（深色／淺色）
- ☰ 選單「外觀」：自動（跟系統）｜淺色｜深色；結果寫在 `<html data-theme="dark|light">`
- `index.html` `<head>` 用一般 `<script src="js/theme.js">`（不是 module、不是 inline，CSP 不允許 inline script）在畫面畫出前套用；`js/app.js` 的 `setupTheme()` 負責切換，兩邊判斷要一致
- 顏色一律用 `css/style.css` 的變數（`--bg`、`--text`…），**不要寫死顏色**；新增顏色時兩個主題都要定義
- 淺色主題對比已驗證：文字 ≥ 14:1、次要文字 ≥ 6.9:1、強調色 ≥ 5.2:1、邊框 ≥ 3:1；改色時要重新驗證
- 風味輪實色格子的字色依底色選白或深（`js/flavorWheel.js` 的 `INK`），淡化格子用 `--text`
- **例外**：分享卡片是一張輸出的圖，不跟主題切換，固定用深色主題的咖啡色系；色碼常數在 `js/views/shareCard.js` 頂端，要和 style.css 的深色變數一致

## 不做計時器
使用者的秤本身有計時功能，App 不做計時器；總時間在表單手動輸入（分、秒兩欄）。

## 備份
- 匯出全部資料為 JSON（含 schemaVersion），可匯入還原
- 匯入分「合併」（依 id 覆蓋）與「取代全部」；整份檔案驗證通過才在單一交易內寫入
- 匯入接受 schemaVersion 1、2、3：v1 沒有 grinders（視為空陣列），brews 沒有 grinderId（補成 ''）；v1、v2 沒有 photos（視為空陣列）
- 照片（v3）：匯出時可選「包含照片」（預設開），`photos: [{ brewId, width, height, createdAt, data(base64 JPEG) }]`，`photosIncluded` 記錄有沒有勾；匯出前顯示預估檔案大小
- 匯入照片的驗證：brewId 對得到紀錄、不重複、base64 正確、≤ 2MB、JPEG 檔頭解析得出尺寸（≤ 4096px），再實際解碼產生縮圖；任一張失敗整份不匯入
- 「取代全部」連照片一起清空
- 按「匯出」就記下 lastBackupAt（瀏覽器無法確認檔案是否存好；匯入不算備份）
- 備份提醒：有紀錄，且距上次備份（沒備份過則從最早一筆紀錄起算）≥ 14 天時，首頁顯示提醒；「立即備份」直接下載，「稍後」3 天內不提醒

## 開發順序
- v0.1：db.js + 豆子 CRUD + 紀錄 CRUD + 列表
- v0.2：複製上一次、篩選、JSON 匯出匯入
- v0.3：PWA（manifest、離線）+ 部署 GitHub Pages
- 一次只做一個版本，做完要能實際使用再進下一版

## PWA / 離線
- `sw.js` 安裝時預先快取 `ASSETS` 清單中的所有檔案，之後一律從快取讀取
- **修改任何前端檔案後，`sw.js` 的 `CACHE_VERSION` 要 +1**，否則使用者不會收到新版本
- **新增前端檔案時，要加進 `sw.js` 的 `ASSETS`**，否則離線時載不到
- 有新版時畫面底部顯示「有新版本可用」，使用者按「更新」才切換（避免填表單時被重新整理）
- 圖示來源是 `icons/icon.svg`（滿版、圖案在中心安全區），PNG 由它用 headless Chrome 轉出

## 開發習慣
- 本地測試用 `python -m http.server`（ES Modules 不能用 file:// 開）
- 本地開發時 Service Worker 會快取檔案：在 DevTools → Application → Service Workers 勾選「Update on reload」
- 手機用區網 http 測試時不是 secure context，Service Worker 不會啟用（其他功能正常）
- 每完成一個功能就 git commit

## 分享卡片
- 編輯頁的「分享」、新增頁的「儲存並分享」都會**先存檔**（含剛選的照片）再到 `#/brew/<id>/share`；驗證失敗就留在表單顯示錯誤
- 尺寸 IG 貼文 1080×1350／限時動態 1080×1920
- 開關：包含照片（有照片才出現，預設開）、包含筆記（有筆記才出現，預設關，避免分享私人內容）
- 風味輪選的風味一律顯示成標籤（大類顏色圓點＋選到那一層的名稱），行數有上限（貼文有照片 1 行、限時動態 2 行，沒照片各 +1），放不下收成「+N」
- 繪製前 `await document.fonts.ready`；版面先量文字區塊高度，照片高度＝剩餘空間，筆記用剩下的行數截斷，保證不跑版
- 每次選項改變就先 `toBlob` 成 PNG（iOS Safari 的 `navigator.share` 必須在點擊當下呼叫）；`navigator.canShare({ files })` 不支援就改下載
- 檔名 `coffee-<豆子名稱>-<YYYY-MM-DD>.png`，名稱只留文字、數字、`_`、`-`
- 不上傳任何資料，離線可用

## 咖啡社群（後端：Supabase）
規格見 `docs/social-spec.md`（分 5 階段，每階段通過測試、使用者確認後才進下一階段）；待決事項與決定見 `docs/social-open-questions.md`。
目前完成：階段 1（資料庫與權限）、階段 2（照片 Storage）、階段 3（帳號與好友）、階段 4（動態牆與同步）、階段 5（安全與隱私收尾）。正式專案：`rygsjrzddhhhdqpoayoa`（Tokyo，免費方案），migration 與 `delete-account` 已部署；建立與設定步驟見 `docs/supabase-setup.md`。

### 資安規則（每個階段都必須遵守）
- 每張表和 Storage bucket 都必須開 RLS，預設拒絕
- 判斷身分一律用 `auth.uid()`，不信任前端傳來的 user_id
- service_role key 不可出現在前端或 repo（`.env` 已在 .gitignore）
- 他人內容一律跳脫後才顯示（`esc()` 或 `textContent`）
- 照片一律在前端重新編碼並移除 EXIF 才上傳
- 修改權限時必須同時新增「跨帳號存取必須失敗」的測試
- anon key 是公開的，任何人都能繞過 App 直接打 API：所有限制（長度、範圍、次數）都要在資料庫強制
- 不從 API 公開的函式與表放 `private` schema；新函式預設不給執行權限，需要的才在 migration 最後統一 grant
- security definer 函式一律 `set search_path = ''`，名稱寫完整 schema
- 判斷函式只回答「目前登入的人」與某人的關係，不接受任意兩個 id
- 「不是好友」和「被封鎖」對被封鎖者要看起來一樣，不透露封鎖

### 資料表（階段 1）
profiles、friendships、blocks、shared_brews、likes、reports（public，API 公開、RLS 保護）；rate_events（private，每日／每小時上限的計數）
- 加好友只能透過 `send_friend_request(code)`，不能直接新增 friendships；沒有「搜尋所有使用者」
- shared_brews 主鍵 `(owner, id)`，id 沿用本機紀錄 id；雲端只放 friends 紀錄，所以不存可見度
- 上限：每天 20 個好友邀請、30 筆上傳、10 次檢舉（台灣時間日曆日，只算新增，刪掉不還）；每小時打錯代碼 10 次

### 照片 Storage（階段 2）
- 私有 bucket `brew-photos`：單檔 ≤ 1MB（`image.CLOUD_PHOTO_MAX_BYTES` 要一致）、只收 `image/jpeg`；路徑 `<user_id>/<brew_id>.jpg`（`models.cloudPhotoPath`，一律小寫）
- **照片權限跟著 shared_brews 走**：
  - 上傳／覆蓋：自己的紀錄 `photo_path` 已指向這個路徑 → 同步順序是「先寫紀錄、再傳照片」
  - 讀取：本人資料夾，或讀得到那筆紀錄且 `photo_path` 指向它 → 紀錄刪除、改回 private、`photo_path = null` 時好友立刻讀不到
  - 刪除：自己資料夾裡的都能刪（清掉殘留檔案用）
- SQL 不能直接刪 `storage.objects`（Supabase 的 protect_delete trigger），照片一律用 Storage API 刪除；pgTAP 測刪除時要 `set_config('storage.allow_delete_query', 'true', true)`
- 上傳前一律經過 `models.photoForUpload`：確認 ≤ 1600px、≤ 1MB 的 JPEG，移除 JFIF 以外所有中繼資料段（EXIF、XMP、ICC、註解），不符合就重新編碼
- 顯示用 signed URL（`expiresIn: 3600`），不用公開網址；sw.js 不攔截其他網域的請求，所以不會快取 signed URL
- 已知限制（伺服器做不到）：Storage 不檢查檔案內容；signed URL 效期由前端決定，發出後不再檢查 RLS（解除好友後舊網址到期前仍可用）

### 帳號與好友（階段 3）
- Google 登入用 PKCE（`flowType: 'pkce'`）：回到 `<App>/?code=...`，不會和 hash 路由衝突；`app.js` 的 `start()` 處理完把網址清掉、改到 `#/account`
- 登入狀態存在 IndexedDB meta（`auth:supabase-auth`），不放 localStorage、不進備份檔；登出用 `scope: 'local'`，網路失敗也會清掉本機 session
- supabase-js 從 `js/vendor/` 以 `<script integrity>` 載入（不用 CDN）；只在社群頁面用到時才載入；升級步驟見 `js/vendor/README.md`
- 頭像：私有 bucket `avatars`（≤ 100KB、只收 JPEG），路徑 `<user_id>/avatar.jpg`；前端 `image.compressAvatar` 裁成 256×256 並移除中繼資料；讀取權限跟著 profiles 走（`avatar_path` 指向它才讀得到）；不用 Google 大頭貼
- 封鎖後雙方互相看不到 profile，所以 `blocks.blocked_nickname` 在封鎖當下由 trigger 記下對方暱稱（前端不能指定）
- QR code 內容是 `#/friends/add?code=...` 的網址，用手機相機掃；iPhone 主畫面 App 和 Safari 登入狀態分開，沒登入時頁面顯示代碼讓使用者複製
- 暱稱上限 20 字，XSS 測試用 20 字以內的攻擊字串（`"><svg onload=pwn()>`）

### 動態牆與同步（階段 4）
- 紀錄表單「誰看得到」：🔒 只有我（預設，「再沖一杯」也一律回到只有我）｜👥 好友；選好友時筆記 ≤ 500 字、風味輪 ≤ 30 個等雲端限制在表單就擋下（`sharedLimitErrors`）
  - 豆子名稱、產地、磨豆機名稱跟著紀錄上傳（雲端 ≤ 100 字）：豆子、磨豆機表單存檔時就限制；匯入舊備份不擋，分享時由 `saveBrew` 再檢查
- 同步不記動作佇列：每次比對「本機應該長怎樣」（`toSharedRow`，豆子、磨豆機轉成名稱）和 sync store 記的上次內容，有差異就補送；衝突一律以本機為準
  - 存檔、刪除、改豆子／磨豆機、匯入後由 models 觸發；app.js 在啟動、`online`、切回前景時觸發；沒登入（meta 沒有 session）或沒有要同步的就不載入 supabase-js
  - 雲端已有就 update、沒有才 insert（不用 upsert：欄位權限不能 update id、owner）
  - 改回只有我或刪除：先刪紀錄、再用 Storage API 刪照片；**只刪這台裝置認得的**（sync store 有、或本機有這筆），別台裝置上傳的不刪
  - 撞到每天 30 筆上限：記下台灣時間的日期，同一天不再重送；被 check 拒絕的內容沒改就不重送
- 動態牆依沖煮時間新→舊，每次 20 筆；照片沒有縮圖（每張約 200KB，`loading="lazy"`）；按讚先更新畫面、失敗改回來
- 讀不到的紀錄（不是好友、封鎖、已刪除、改回只有我）一律顯示同一個「找不到」

### 安全與隱私收尾（階段 5）
- 檢舉、封鎖都在好友紀錄的詳細頁；檢舉只能新增，誰都讀不到（站長在 Supabase 後台看），每天 10 次
- 刪除帳號：Edge Function `delete-account`（立即刪除，沒有緩衝期）
  - 身分只從呼叫者的 JWT 向 Auth 確認，不接受任何 user id；先用 Storage API 刪 `brew-photos/<uid>/`、`avatars/<uid>/`，再刪 auth 使用者（資料表 cascade）
  - service_role key 只在 Supabase 自動提供的環境變數；函式直接打 REST API，不用 supabase-js
  - 前端：輸入暱稱確認；成功後本機的 friends 紀錄全部改回 private、清空 sync store、清掉登入狀態；本機紀錄保留
  - 正式專案要另外部署：`npx supabase@2.120.0 functions deploy delete-account`
- 隱私說明頁（`js/views/privacy.js`）：**修改資料收集、可見範圍、照片處理、刪除流程時要一起改**
- **CSP**（`index.html` 的 meta）：`script-src 'self'`（不能有 inline script 或 inline 事件屬性）、`style-src-attr 'unsafe-inline'`（風味標籤顏色）、`connect-src`／`img-src` 只有 'self' 和 `js/config.js` 的 Supabase 網址
  - **`js/config.js` 新增或改網址時，CSP 要一起改**（social-safety-test 會檢查）；新增外部資源一律先改 CSP
- Service Worker 只攔截同網域的 GET，不會快取 API 或 signed URL（social-safety-test 會檢查快取內容）

### 本機開發（不連正式專案）
- 需要 Docker Desktop 執行中；CLI 用 `npx supabase@2.120.0`（固定版本，不全域安裝）
- `npx supabase@2.120.0 start`／`stop`；`db reset` 重建資料庫並套用所有 migration
- `npx supabase@2.120.0 test db`：跑 `supabase/tests/` 的 pgTAP 測試（每個檔案在交易中執行，結束 rollback）
- `node scripts/supabase-api-test.mjs`：用真的 JWT 從 API 層測權限；金鑰執行時從 `supabase status` 讀，只允許連本機
- `node scripts/supabase-storage-test.mjs`：從 Storage API 測照片權限、1MB 與 MIME 限制
- `node scripts/photo-exif-test.mjs`：headless Chrome（找不到時設 `CHROME_PATH`）跑 `tests/photo.html`，把處理後的照片上傳再下載，確認沒有 EXIF
- `node scripts/social-feed-test.mjs`：兩個 headless Chrome（A、B）測分享、同步（含模擬離線）、動態牆、按讚、改回只有我、封鎖、每日上限，豆名／筆記／暱稱的 XSS
- `node scripts/social-safety-test.mjs`：檢舉、從詳細頁封鎖、刪除帳號（用 admin 確認雲端全部刪除、本機保留）、Edge Function 的權限、CSP（每一頁沒有違規、注入的 inline script 被擋）、SW 快取
- `node scripts/social-ui-test.mjs`：兩個隔離的 headless Chrome 環境（A、B）操作真的畫面：加好友、封鎖、XSS、頭像 EXIF、登出；登入用 admin API 拿真的 session（Google 登入無法自動化）
- 本機頁面用 `python -m http.server 8000` 開 `http://localhost:8000/`（`config.toml` 的 site_url／redirect URL 是這個；本機沒有設定 Google，無法真的登入）
- 本機 Studio：http://127.0.0.1:54323
- migration 已套用到正式專案後就不能改，要改權限請新增一個 migration
