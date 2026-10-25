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
js/stats.js        # 統計頁的計算（純函式，不 import 任何東西，Node 可直接測），只由 models.js 使用
js/drippers.js     # 舊紀錄的濾杯文字 → drippers 的合併規則（純函式，Node 可直接測）；db.js 的 v6 升級與 models.js 匯入舊備份共用
js/id.js           # newId()（db.js 升級轉換與 models.js 共用；models.js 轉出）
js/changelog.js    # 更新內容（給使用者看的每版說明）與版本比較，由 models.js 轉出給 views
js/image.js        # 照片處理：解碼、縮小、重新編碼 JPEG、base64、JPEG 檔頭驗證、上傳前移除中繼資料（只由 models.js 使用）
js/cardLayout.js   # 分享卡片的純計算：cover 裁切、雷達圖座標、文字換行（含避頭）、檔名；由 models.js 轉出給 views
js/config.js       # Supabase 連線設定（依網址：localhost → 本機、github.io → 正式；null ＝ 沒有社群功能）
js/cloud.js        # 唯一存取 Supabase 的地方（角色和 db.js 一樣）；supabase-js 用到才載入
js/sync.js         # 好友紀錄的同步（本機 friends 紀錄 → shared_brews），只由 models.js 使用
js/vendor/         # 第三方檔案原封不動（supabase-js UMD、qrcode-generator），來源與 SRI 見 js/vendor/README.md
js/views/          # brewList, brewForm, beanList, beanForm, grinderList, grinderForm, dripperList, dripperForm, backup, shareCard（分享卡片頁＋Canvas 繪製）, flavorPicker（風味輪 SVG）, changelog（更新內容）, account（帳號）, friends（好友管理）, feed（社群：全部／我的）, feedDetail（紀錄詳細、編輯連結、檢舉、封鎖）, comments（詳細頁的留言區）, profile（個人檔案）, stats（統計：SVG 圖表）, privacy（隱私說明）, feedback（意見回饋）, admin（開發者後台）, ui（共用 DOM 工具）
icons/
docs/              # social-spec.md（咖啡社群規格，原文不改）、social-open-questions.md（待決事項與決定）、supabase-setup.md（正式專案與 Google 登入設定步驟、部署指令）、overnight-report.md（2026-10-26 通宵工作的報告）
supabase/          # 咖啡社群後端：config.toml、migrations/（SQL）、tests/（pgTAP 權限測試）、functions/delete-account（刪除帳號的 Edge Function）、functions/admin-delete-user（開發者刪別人的帳號）、functions/_shared/account.ts（兩者共用的刪除流程）、functions/feedback（意見回饋：存檔＋寄 Email 給站長；mail.ts 是設定檢查與錯誤說明的純函式）
scripts/           # 只連本機 Supabase 的測試：supabase-local.mjs、chrome.mjs（共用工具）、supabase-api-test.mjs、supabase-storage-test.mjs、supabase-comments-test.mjs、photo-exif-test.mjs、social-ui-test.mjs、social-feed-test.mjs、social-safety-test.mjs、social-feedback-test.mjs、social-comments-test.mjs、supabase-profile-test.mjs、social-profile-test.mjs、admin-api-test.mjs、admin-ui-test.mjs、feedback-mail-test.mjs、menu-alerts-test.mjs、stats-test.mjs、stats-ui-test.mjs、drippers-test.mjs（最後五個不需要 Supabase）
tests/             # photo.html（照片處理測試頁，由 photo-exif-test.mjs 用 headless Chrome 開；不屬於 App、不放進 ASSETS）
```

## 分層規則
views → models → db／cloud，每層只呼叫下一層。views 不可直接碰 IndexedDB 或 Supabase。
- view 的事件監聽器掛在這一頁自己的元素上，**不要掛在 `render` 收到的 container（`#app`）**：`#app` 換頁不會被替換，監聽器會殘留並帶著舊資料處理之後的點擊

## 資料模型（備份 schemaVersion: 4／IndexedDB DB_VERSION: 6）
**beans**：id, name, origin, process(washed/natural/honey/other), roastLevel(light/light-medium/medium-light/medium/dark，即 淺/淺中/中淺/中/深焙), roastDate(YYYY-MM-DD), bagWeightG(整包重量 g，選填), archived(bool), createdAt
**grinders**：id, name(必填), notes(選填，例如刻度說明), archived(bool), createdAt
**drippers**（DB v6 加入）：id, name(必填，≤ 100 字), notes(選填), archived(bool), createdAt
**brews**：id, beanId, grinderId(選填，'' ＝未指定；v1 舊紀錄沒有這個欄位), dripperId(選填，'' ＝未指定), brewedAt, dripper(舊版自由輸入的濾杯文字，轉換後保留作為保險；新紀錄是 ''，畫面一律用 dripperId), grindSetting, coffeeG, waterG, tempC, totalTimeS(手動輸入), rating(1–5), flavor{acidity, sweetness, bitterness, body}(1–5), flavorNotes(風味輪 key 陣列，如 "fruity.berry.blueberry"，任一層皆可；舊資料預設 []), notes, visibility(private/friends，舊資料沒有這個欄位＝private)
**meta**（DB v3 加入）：{ key, value }，App 自己的狀態（lastBackupAt、backupSnoozeUntil、社群登入狀態 `auth:*`、社群通知看到哪 `feedSeenAt`／`commentsSeenAt`／`repliesSeenAt`、看過哪一版的更新內容 `changelogSeen`、濾杯轉換做過了 `dripperMigration`）；**不匯出、匯入取代全部時也不清除**（token 不會進備份檔，匯入也不會被登出）
**photos**（DB v4 加入，keyPath brewId）：brewId, blob(JPEG，最長邊 1600px、品質 0.8，約 200KB), width, height, createdAt；每筆紀錄最多 1 張，跟 brews 分開存
**thumbs**（DB v4 加入，keyPath brewId）：brewId, blob(JPEG，最長邊 300px)；列表只讀這個，不載入原圖；不匯出，匯入時由照片重新產生
**sync**（DB v5 加入，keyPath brewId）：brewId, userId, row(上次同步的 shared_brews 內容 JSON), photoAt(上次同步的照片 createdAt), error(''/rate_limited/invalid/failed/removed), failedRow, failedOn；**不匯出、匯入取代全部時也不清除**
- brews 建索引：beanId、brewedAt、grinderId（v2 加入）、dripperId（v6 加入）
- 有紀錄引用的豆子、磨豆機、濾杯不能刪除，只能封存
- **濾杯轉換（v6）**：在 `onupgradeneeded` 的升級交易裡完成（單一交易，open 成功前畫面讀不到轉換一半的資料）；規則在 `js/drippers.js`：去掉所有空白、忽略大小寫後合併（「V60」「v60」「V 60」同一支），名稱用出現最多次的寫法（同票取最近一杯），空白＝未指定；只加 dripperId、不動其他欄位；meta `dripperMigration` 記著做過就不再做（全新安裝也記）
- **照片一律在前端重新編碼成 JPEG（移除 EXIF）後才儲存**（`models.preparePhoto` → `image.compressPhoto`，經 Canvas 重畫，GPS 等資訊不會留下）
- 只接受 JPEG／PNG／WebP（`image.PHOTO_TYPES`，表單 `accept` 用 `models.PHOTO_ACCEPT`）；iPhone 的 HEIC 由系統在選取時轉成 JPEG
- 紀錄與照片一起寫入、一起刪除（`db.transact` 單一交易涵蓋 brews、photos、thumbs）
- 照片顯示用 `URL.createObjectURL`，view 的 `render` 回傳 cleanup 在離開頁面時 `revokeObjectURL`
- DB 升級：`onupgradeneeded` 每一步都先檢查是否已存在，既有 store 用升級交易取得後再加索引，絕不改動舊資料
- 衍生值不儲存：粉水比 = waterG / coffeeG、養豆天數 = 沖煮日 − roastDate，在 models.js 計算
- 豆子剩餘量（衍生值）= bagWeightG − 該豆子所有紀錄 coffeeG 加總；「約幾杯」用該豆子最近 5 杯平均粉量估算（沒沖過就用全部紀錄最近 5 杯），剩 2 杯以下顯示「快沒了」
- id 用 crypto.randomUUID()

## 路由（hash）
`#/` 紀錄列表（`?bean=<id>` 帶入豆子篩選，統計頁用）｜`#/brew/new`｜`#/brew/new?from=<id>` 複製參數新增｜`#/brew/<id>` 編輯｜`#/brew/<id>/share` 分享卡片｜`#/beans`｜`#/beans/new`｜`#/beans/<id>`｜`#/backup` 匯出匯入｜`#/grinders`｜`#/grinders/new`｜`#/grinders/<id>`｜`#/drippers`｜`#/drippers/new`｜`#/drippers/<id>`｜`#/account` 帳號｜`#/friends` 好友管理｜`#/social` 社群（全部）｜`#/social?mine=1` 社群（我的）｜`#/social/<owner>/<id>` 紀錄詳細（`?comments=1` 捲到留言區）｜`#/user/<id>` 個人檔案｜`#/stats` 統計｜`#/privacy` 隱私說明｜`#/changelog` 更新內容｜`#/feedback` 意見回饋｜`#/friends/add?code=<好友代碼>`（QR code 連到這裡）｜`#/admin?tab=reports|posts|users|feedback|log` 開發者後台｜`#/admin/user/<id>`｜`#/admin/post/<owner>/<id>`
- 1.1.0 以前的 `#/feed`、`#/feed/<owner>/<id>` 由 app.js 轉址到 `#/social…`

## 介面配置
- 底部分頁列：紀錄｜豆子｜社群（只放每天會用的頁面）；「社群 💬」是動態牆，有 `data-social`，`js/config.js` 沒設定時隱藏
- **不常調整的設定放右上角 ☰ 選單，不要加到底部分頁列**（目前有：帳號、好友管理、統計、磨豆機、濾杯、備份、隱私說明、更新內容、意見回饋、開發者後台；帳號、好友管理、意見回饋有 `data-social`，`js/config.js` 沒設定時隱藏；開發者後台有 `data-admin`，只有 `am_i_admin` 為 true 時顯示）
- ☰ 選單裡的頁面不屬於任何分頁，路由設 `tab: null`，底部分頁都不亮
- ☰ 的「!」（`app.js` 的 `setupBadges`）：選單裡需要注意的那一項後面有「!」（`.menu-alert[data-alert]`，`--accent`），☰ 按鈕上的「!」＝其中任何一項；aria-label 寫出是哪幾項
  - 好友管理＝收到好友邀請（社群）；備份＝`getBackupStatus().overdue`（有紀錄且 ≥ 14 天沒備份，首頁按「稍後」也照樣顯示，匯出後消失）；更新內容＝還沒看過這一版
  - 備份、更新內容只看本機，沒有社群功能也顯示
- 更新內容：`js/changelog.js`，**每次升 `APP_VERSION` 都要在最前面加一段**（menu-alerts-test 檢查第一段＝`APP_VERSION`）
  - meta `changelogSeen` 記看過的版本；全新安裝（沒有豆子、紀錄）直接記成目前版本、不提示；已經在用但沒記過的算剛更新
  - 還沒看過時，畫面底部顯示「已更新到 x.y.z・看看改了什麼」（`#updated-banner`，「有新版本可用」出現時先讓它）；打開 `#/changelog` 或按 ✕ 就記成看過
  - ☰ 選單最下面的版本號也連到 `#/changelog`
- 社群提示（`models.getSocialBadges`）：底部「社群」分頁的**數字**（`--badge-new`，和「!」的顏色要能區分）
  - 數字＝好友新貼文＋我貼文的新留言＋回覆我的留言；各自最多算 100，>99 顯示「99+」（`models.badgeText`），0 隱藏
  - 「新」＝雲端 `created_at` 比 meta 記下的 seenAt 新（`feedSeenAt`／`commentsSeenAt`／`repliesSeenAt`，雲端時間、記 userId）；好友修改舊紀錄不算
  - 歸零：讀社群頁第一頁時記下；「全部」三種都記，「我的」只記留言的兩種
  - 檢查時機和同步一樣（啟動、`online`、切回前景），views 操作完用 `notifyBadgesChanged()` 發事件；沒登入不載入 supabase-js；不做即時推播

## 主題（深色／淺色）
- ☰ 選單「外觀」：自動（跟系統）｜淺色｜深色；結果寫在 `<html data-theme="dark|light">`
- `index.html` `<head>` 用一般 `<script src="js/theme.js">`（不是 module、不是 inline，CSP 不允許 inline script）在畫面畫出前套用；`js/app.js` 的 `setupTheme()` 負責切換，兩邊判斷要一致
- 顏色一律用 `css/style.css` 的變數（`--bg`、`--text`…），**不要寫死顏色**；新增顏色時兩個主題都要定義
- 淺色主題對比已驗證：文字 ≥ 14:1、次要文字 ≥ 6.9:1、強調色 ≥ 5.2:1、邊框 ≥ 3:1；改色時要重新驗證
- 風味輪實色格子的字色依底色選白或深（`js/flavorWheel.js` 的 `INK`），淡化格子用 `--text`
- **例外**：分享卡片是一張輸出的圖，不跟主題切換，固定用深色主題的咖啡色系；色碼常數在 `js/views/shareCard.js` 頂端，要和 style.css 的深色變數一致

## 統計（`#/stats`，☰ 選單）
- **只用本機 IndexedDB 的紀錄計算**（`models.getStats` → `js/stats.js` 的 `computeStats`），不碰 Supabase、不上傳、離線可用；不加欄位、不存衍生值
- 期間：近 30 天｜近 90 天｜全部；豆子篩選（有紀錄的豆子，含封存）；已封存的豆子、磨豆機、濾杯也算（濾杯依 dripperId 分組）；篩選條件在切頁後保留
- 評分相關（評分變化、每支豆子、器材）只算有評分的杯；有評分 < 3 杯標「樣本少」並排在後面；7 杯移動平均從第 7 杯開始
- 粉水比以 0.5 分組（`ratioBucket`，下限包含、加 1e-9 防浮點誤差）、水溫 floor 到 1°C；每週以週一開始、用本機日期，沒沖的週是 0
- 期間內 < 3 杯：只顯示「多記幾杯就能看到趨勢」，不畫圖；個別圖表沒資料也顯示提示
- 圖表自己畫 SVG（不用外部函式庫）；顏色只用主題變數：資料標記 `--accent`、7 杯平均線 `--text`、格線 `--border`、文字 `--text`／`--text-dim`（已用 dataviz 的驗證腳本確認兩個主題都分得清楚）
- 點擊（不是 hover）才顯示詳細數字（圖下方的 `.chart-detail`）；橫條每列 ≥ 44px；點「每支豆子」的長條跳到 `#/?bean=<id>`
- 橫條：名稱｜長條｜數值三欄（名稱太長截斷），各列長條同寬才能比較；每週超過 14 週改成在自己的框裡橫向捲動（Y 軸固定在框外）
- 測試：`stats-test.mjs`（計算）、`stats-ui-test.mjs`（390px、深淺色、有資料／沒資料的截圖、文字重疊、CSP）

## 不做計時器
使用者的秤本身有計時功能，App 不做計時器；總時間在表單手動輸入（分、秒兩欄）。

## 備份
- 匯出全部資料為 JSON（含 schemaVersion），可匯入還原
- 匯入分「合併」（依 id 覆蓋）與「取代全部」；整份檔案驗證通過才在單一交易內寫入
- 匯入接受 schemaVersion 1、2、3、4：v1 沒有 grinders（視為空陣列），brews 沒有 grinderId（補成 ''）；v1、v2 沒有 photos（視為空陣列）
- v1–v3 沒有 drippers：用和 DB 升級同一套規則（`mergeDripperNames`）從紀錄的濾杯文字建立；「合併」時名稱相同的沿用本機已有的濾杯（含封存），「取代全部」時全部新建；v4 的紀錄指向不存在的濾杯就整份不匯入
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
- **修改任何前端檔案後，`sw.js` 的 `APP_VERSION` 至少第三碼 +1**，否則使用者不會收到新版本（`CACHE_NAME` 由它產生，不另外維護）
  - 版本號（semver `x.y.z`，從 1.0.0 開始）：修 bug → 第三碼 +1；新功能 → 第二碼 +1、第三碼歸零；資料不相容的大改 → 第一碼 +1
  - **同時要在 `js/changelog.js` 最前面加一段更新內容**（寫給使用者看的白話；只修小錯誤也寫一句）
  - 它也是 ☰ 選單最下面顯示的「版本 x.y.z」、意見回饋附的版本：app.js 用 `'version'` 訊息問目前接管頁面的 Service Worker（沒有 Service Worker 時不顯示）
  - 1.0.0 以前的舊版 Service Worker 回的是整數（`CACHE_VERSION`）：`ui.normalizeAppVersion` 轉成字串 `'18'`，Edge Function `feedback` 也接受整數
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
目前完成：階段 1（資料庫與權限）、階段 2（照片 Storage）、階段 3（帳號與好友）、階段 4（動態牆與同步）、階段 5（安全與隱私收尾），之後加上留言與回覆、封鎖不解除好友（都已部署），開發者後台（已部署）；個人檔案（`feature/profile`，正式專案尚未部署，步驟見 `docs/supabase-setup.md` 5-5）。正式專案：`rygsjrzddhhhdqpoayoa`（Tokyo，免費方案），migration 與 `delete-account` 已部署；建立與設定步驟見 `docs/supabase-setup.md`。

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
- **開發者身分只在 `private.admins`**（沒有任何 grant；不能放 profiles、user_metadata 這些使用者改得到的地方），判斷一律用 `private.is_admin()`；App 裡沒有任何方法新增開發者
- 「不是好友」和「被封鎖」對被封鎖者要看起來一樣，不透露封鎖

### 資料表（階段 1）
profiles、friendships、blocks、shared_brews、likes、reports（public，API 公開、RLS 保護）；rate_events（private，每日／每小時上限的計數）
- 加好友只能透過 `send_friend_request(code)`，不能直接新增 friendships；沒有「搜尋所有使用者」
- shared_brews 主鍵 `(owner, id)`，id 沿用本機紀錄 id；雲端只放 friends 紀錄，所以不存可見度
- 上限：每天 20 個好友邀請、30 筆上傳、10 次檢舉、5 則意見回饋、100 則留言（台灣時間日曆日，只算新增，刪掉不還）；每小時打錯代碼 10 次

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
- **封鎖不解除好友**（`20261025150000_block_keeps_friends.sql`）：只刪雙方之間待處理的邀請；好友關係、讚、留言都保留，雙方互相看不到對方的貼文、照片、留言（含共同好友的貼文）、讚，解除封鎖後恢復
  - 好友之間不管封鎖都看得到 profile（被封鎖者的好友名單照樣有封鎖者，不透露封鎖）；被封鎖的好友輸入代碼得到 `already_friends`
  - 好友管理頁：封鎖的好友留在好友名單、標「已封鎖」，按鈕換成「解除封鎖」
- 不是好友時封鎖後雙方看不到 profile，所以 `blocks.blocked_nickname` 在封鎖當下由 trigger 記下對方暱稱（前端不能指定）
- QR code 內容是 `#/friends/add?code=...` 的網址，用手機相機掃；iPhone 主畫面 App 和 Safari 登入狀態分開，沒登入時頁面顯示代碼讓使用者複製
- 暱稱上限 20 字，XSS 測試用 20 字以內的攻擊字串（`"><svg onload=pwn()>`）

### 動態牆與同步（階段 4）
- 紀錄表單「誰看得到」：🔒 只有我（預設，「再沖一杯」也一律回到只有我）｜👥 好友；選好友時筆記 ≤ 500 字、風味輪 ≤ 30 個等雲端限制在表單就擋下（`sharedLimitErrors`）
  - 豆子名稱、產地、磨豆機名稱、濾杯名稱跟著紀錄上傳（雲端 ≤ 100 字；濾杯名稱放進 shared_brews.dripper，雲端結構不變）：豆子、磨豆機、濾杯表單存檔時就限制；匯入舊備份不擋，分享時由 `saveBrew` 再檢查
- 同步不記動作佇列：每次比對「本機應該長怎樣」（`toSharedRow`，豆子、磨豆機、濾杯轉成名稱）和 sync store 記的上次內容，有差異就補送；衝突一律以本機為準
  - 存檔、刪除、改豆子／磨豆機／濾杯、匯入後由 models 觸發；app.js 在啟動、`online`、切回前景時觸發；沒登入（meta 沒有 session）或沒有要同步的就不載入 supabase-js
  - 雲端已有就 update、沒有才 insert（不用 upsert：欄位權限不能 update id、owner）
  - 改回只有我或刪除：先刪紀錄、再用 Storage API 刪照片；**只刪這台裝置認得的**（sync store 有、或本機有這筆），別台裝置上傳的不刪
  - 撞到每天 30 筆上限：記下台灣時間的日期，同一天不再重送；被 check 拒絕的內容沒改就不重送
  - **同一支手機換帳號**：sync store 的 `userId` 就是這筆屬於哪個帳號；別的帳號的紀錄不上傳、不刪（狀態 `other-account`），換回那個帳號照常同步；從來沒同步過的算目前帳號的；刪除帳號只動自己帳號的紀錄
  - 每日上限的計數（`private.count_today`）和 `send_friend_request` 先拿 advisory lock，同時送出的請求不能超過上限（`20261027100000_rate_limit_locks.sql`）
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
  - index.html 只放正式專案的網址；本機 Supabase（config.js 的 `LOCAL`）由測試用的靜態伺服器（`chrome.mjs` 的 `localCsp`）送出時才加上，所以 `python -m http.server` 開的頁面連不到本機 Supabase（本來就無法真的登入，社群功能一律用測試腳本測）
- Service Worker 只攔截同網域的 GET，不會快取 API 或 signed URL（social-safety-test 會檢查快取內容）
- **防點擊劫持**：meta 的 CSP 不能設 `frame-ancestors`、GitHub Pages 也不送 `X-Frame-Options`，所以 `js/theme.js` 開頭發現被 iframe 嵌入就整頁不顯示並把最上層換成 App（menu-alerts-test 會檢查）；App 自己不要用 iframe 嵌入自己

### 留言與回覆
- `comments`：id, brew_owner, brew_id, author, parent_id, reply_to_user, author_nickname, reply_to_nickname, body, created_at
- **只有兩層**：回覆只能掛在同一篇貼文的主留言下（複合外鍵 `(brew_owner, brew_id, parent_id)`＋trigger）；回覆別人的回覆也掛在主留言下，`reply_to_user` 記對象，畫面顯示「@暱稱」
- `reply_to_user` 只能是貼文作者或在這一串留過言的人（必定讀得到貼文，也不能拿來探測好友關係），且和自己沒有封鎖
- 1–300 字（除了換行不可有控制字元）、每天 100 則、**不能修改**（沒有 update 權限）
- 讀取：讀得到貼文、且和留言者之間沒有封鎖（`private.blocked_with`）；封鎖的雙方在共同好友的貼文上也互相看不到；對被封鎖者的錯誤碼和「不是好友」相同（讚也一樣：和按讚的人有封鎖就看不到、不算讚數）
- 刪除：留言作者或貼文作者；刪主留言時回覆一起刪（外鍵 cascade）；貼文刪除／改回只有我、刪除帳號時 cascade；**解除好友時刪掉雙方在對方貼文的留言**（`friendships_after_delete`，重新加好友不會恢復；封鎖只隱藏、不刪）
- 暱稱：留言者常常不是讀者的好友（profiles 讀不到），所以留言當下由 trigger 記下 `author_nickname`／`reply_to_nickname`（前端不能指定），不擴大 profiles 的讀取範圍（裡面有好友代碼）；畫面上看得到 profile 就用即時暱稱與頭像，否則用快照＋首字頭像；回覆對象刪除帳號時快照一起清掉
- 通知：`public.comment_activity(post_since, reply_since)`（security invoker，只看 auth.uid()）回傳我貼文的新留言、別人貼文上回覆我的（不重複計算）、最新時間、有新留言的貼文
- 畫面（`js/views/comments.js`）：主留言舊→新、回覆縮排；回覆 >3 則先收起「查看其他 N 則回覆」；送出時按鈕停用、先顯示「傳送中」，失敗移除並把文字放回輸入框；刪除前 `confirm`；字數「n／300」接近上限變色、超過擋下
- 社群頁「全部｜我的」：全部包含自己的紀錄，自己的卡片標「我」；自己的紀錄詳細頁有「編輯」（這台裝置有這筆才顯示）、沒有檢舉／封鎖；卡片顯示讚數、留言數

### 開發者後台
- ☰ →「🛠️ 開發者後台」（`#/admin`，`js/views/admin.js`）：檢舉｜貼文｜用戶｜回饋｜紀錄；用戶詳細（他所有雲端貼文、留言）、貼文詳細（全部留言、檢舉）
- 前端只負責隱藏入口；**後台讀資料一律走 security definer 的 `public.admin_*`**（開頭 `private.require_admin()`，不是開發者 42501），**不要在 shared_brews、comments、profiles 加「開發者可讀」的 RLS**（permissive 政策是 OR，開發者自己的動態牆、通知數字會混進所有人的貼文）；Storage 例外：開發者可讀 brew-photos、avatars，可刪 brew-photos
- 刪除：原因必填（1–200 字，`private.check_reason`）→ `confirm` → 送出；每次都先寫 `public.admin_audit_log` 再刪
  - 留言：`admin_delete_comment`（回覆 cascade）
  - 貼文：`admin_delete_post`（留言、讚、檢舉 cascade）回傳照片路徑，前端用 Storage API 刪；同時記進 `private.removed_brews`，作者不能再 insert 同一筆（23514、hint `removed`），同步記成 `removed`、不再重送，紀錄頁顯示「已被開發者移除」
  - 帳號：Edge Function `admin-delete-user` 用**呼叫者的 JWT** 呼叫 `admin_begin_delete_user`（擋自己、擋其他開發者、寫紀錄），通過後才用 service_role 走 `_shared/account.ts` 的刪除流程
- `admin_audit_log`：只有開發者可讀；trigger 擋下 update、delete、truncate（連 service_role、資料庫擁有者都不行）；沒有外鍵（對象刪除帳號後紀錄仍在）；不存被刪的內容本身。本機測試留下的紀錄刪不掉，`db reset` 才會清空
- 這次不做停權：刪掉的帳號可以用同一個 Google 帳號重新註冊

### 個人檔案（`#/user/<id>`，`js/views/profile.js`）
- profiles 的 `bio`（≤ 150 字、≤ 5 行，除了 
 不可有控制字元）、`favorite_gear`、`favorite_beans`（≤ 50 字、單行），都是 `not null default ''`，check 強制（`20261028100000_profile_fields.sql`）
- **profiles 是欄位層級的讀取權限**：只開放 `id, nickname, friend_code, avatar_path`；新欄位和 `created_at` 不能直接讀（`select *` 也會 42501），**PostgREST 讀 profiles 一律列出欄位**（`return=representation` 要加 `select=`）
  - 完整檔案只能走 `public.profile_detail(target)`（security definer）：本人或 `private.can_view`（已接受、雙方沒有封鎖）才回傳，含貼文數、加入日期；其他一律 null
  - 新增要給別人看的 profile 欄位時：不要 grant select，放進 `profile_detail`
- 頁面的判斷（`models.getUserProfile`）：完整檔案 → 全部；我封鎖了他、或好友卻拿不到（有封鎖）→「找不到這個用戶」；待處理邀請、或在讀得到的留言裡有他的暱稱快照 →「你們還不是好友」＋暱稱＋首字頭像；其他（含帳號已刪除）→ 找不到
- 完整檔案下面是他分享的貼文（`models.listUserPosts` → `cloud.listFeed({ owner })`，沿用 `toFeedItems`、`feedCardHtml(item, { linkPerson: false })`、`bindLikes`）：每次 20 筆、「載入更多」；權限就是 shared_brews 的 RLS，不另外判斷；不記「看過了」
- 自我介紹用 `esc()`＋CSS `white-space: pre-line`，不要把 
 換成 `<br>`
- 頭像、暱稱點過去（`ui.profileHref`）：社群卡片與詳細頁（`feedCardHtml` 的 `.person-link`）、留言的頭像／暱稱／@暱稱（`.comment-avatar`、`.hit-area`）、好友管理名單（封鎖名單不連）；點擊範圍 ≥ 44px，不和按讚、回覆、刪除重疊（social-profile-test 會量）
- 編輯：自己的檔案頁「編輯個人檔案」（頭像、暱稱、自我介紹、器材、豆子，輸入框顯示「n／上限」）；☰ →「帳號」有「我的個人檔案」入口

### 意見回饋
- ☰ →「意見回饋」（`#/feedback`），要登入才能送（防灌送）；類型（bug/idea/other）、內容 ≤ 1000 字，附暱稱（author）與 App 版本號（`feedback.app_version` 是文字：`x.y.z` 或舊版的整數字串），不附 email
- `feedback` 表和檢舉一樣：只能以自己的名義新增，誰都讀不到（連作者自己），站長在 Supabase 後台看；刪除帳號時 cascade 刪除
- App 呼叫 Edge Function `feedback`：用**呼叫者的 JWT** 寫入（RLS、每日上限照常生效）→ 透過 Resend 寄**純文字** Email 給站長；先存檔再寄信，寄信失敗不影響回饋
- 沒寄出信時 function log 一定有一行 `[feedback] 沒有寄信：<原因>`（設定缺漏、假值、Resend 的錯誤翻成中文，`mail.ts`）；寄出時記 Resend 的 email id；log 不可含金鑰
- 金鑰 `RESEND_API_KEY`、`FEEDBACK_TO` 只用 `supabase secrets set` 設定；本機不讀設定，function 依 `SUPABASE_URL`（不是 `*.supabase.co`）判斷，一律寄到 social-feedback-test 開的假 Resend（port 54399）
- **`config.toml` 不要設定 `[edge_runtime.secrets]`**：`supabase secrets set` 會把它一起上傳到正式專案、蓋掉真的金鑰（曾經發生過）
- 正式專案要另外部署：`npx supabase@2.120.0 functions deploy feedback`（步驟見 `docs/supabase-setup.md` 5-2）

### 本機開發（不連正式專案）
- 需要 Docker Desktop 執行中；CLI 用 `npx supabase@2.120.0`（固定版本，不全域安裝）
- `npx supabase@2.120.0 start`／`stop`；`db reset` 重建資料庫並套用所有 migration
- `npx supabase@2.120.0 test db`：跑 `supabase/tests/` 的 pgTAP 測試（每個檔案在交易中執行，結束 rollback）
- `node scripts/supabase-api-test.mjs`：用真的 JWT 從 API 層測權限；金鑰執行時從 `supabase status` 讀，只允許連本機
- `node scripts/supabase-storage-test.mjs`：從 Storage API 測照片權限、1MB 與 MIME 限制
- `node scripts/photo-exif-test.mjs`：headless Chrome（找不到時設 `CHROME_PATH`）跑 `tests/photo.html`，把處理後的照片上傳再下載，確認沒有 EXIF
- `node scripts/social-feed-test.mjs`：兩個 headless Chrome（A、B）測分享、同步（含模擬離線）、社群頁、按讚、改回只有我、封鎖、每日上限，豆名／筆記／暱稱的 XSS
- `node scripts/social-safety-test.mjs`：檢舉、從詳細頁封鎖、刪除帳號（用 admin 確認雲端全部刪除、本機保留）、Edge Function 的權限、CSP（每一頁沒有違規、注入的 inline script 被擋）、SW 快取
- `node scripts/social-feedback-test.mjs`：意見回饋的畫面、Edge Function 權限、寄給站長的 Email（假 Resend）、寄信失敗仍存檔、function log 寫出看得懂的原因且不含金鑰（讀 `docker logs`）、每天 5 則、誰都讀不到
- `node scripts/feedback-mail-test.mjs`：不需要 Supabase；Node 直接載入 `functions/feedback/mail.ts` 測設定檢查與 Resend 錯誤說明
- `node scripts/drippers-test.mjs`：不需要 Supabase；Node 測 `js/drippers.js`，headless Chrome 用 1.7.0 的舊版 db.js（`git show 9b2c4c8:js/db.js`）建出 v5 的資料再開新版：升級轉換、重新整理不重複、表單預設與「再沖一杯」、封存與刪除、卡片／分享卡片／統計／上傳的列用濾杯名稱、v1／v3／v4 備份匯入
- `node scripts/menu-alerts-test.mjs`：不需要 Supabase；headless Chrome 測 ☰ 的「!」（該備份了、更新內容）、「已更新」提示、更新內容頁，並檢查 `js/changelog.js` 第一段＝`APP_VERSION`
- **改了 Edge Function 之後要 `docker restart supabase_edge_runtime_coffee-log`**，本機才會載入新程式
- `node scripts/supabase-comments-test.mjs`：留言的權限從 API 層測（A、B 好友，C 非好友，D 被封鎖）：兩層、回覆對象、內容、每日上限、封鎖、解除好友、改回只有我、刪除帳號（delete-account）
- `node scripts/social-comments-test.mjs`：三個 headless Chrome（A、B、D）測留言畫面：回覆位置、@暱稱、收起、刪除權限與確認、送出失敗改回、300 字、數字徽章與 99+、全部／我的、封鎖、XSS、CSP
- `node scripts/admin-api-test.mjs`：開發者後台的權限從 API 層測（一般使用者改 user_metadata、把自己加進 admins 都拿不到權限；開發者刪留言、貼文、帳號；操作紀錄連 service_role 都改不了）；用 `docker exec supabase_db_coffee-log psql` 加測試用的開發者
- `node scripts/supabase-profile-test.mjs`：個人檔案的權限從 API 層測（A、B 好友，C 非好友，D 被封鎖的好友，E 邀請中）：新欄位誰都不能直接讀、`profile_detail` 只給本人和沒有封鎖的好友、不能改別人的、長度與控制字元被拒絕
- `node scripts/social-profile-test.mjs`：headless Chrome 測個人檔案頁（好友看到全部、非好友只有暱稱快照、封鎖找不到、XSS、從卡片／詳細頁／留言／@暱稱／好友名單跳轉、點擊範圍 44px、編輯）
- `node scripts/admin-ui-test.mjs`：headless Chrome 測後台畫面（入口只有開發者看得到、原因必填與確認、刪完畫面更新、作者看到「已被移除」、XSS、CSP）
- 新增 Edge Function 後本機要 `npx supabase@2.120.0 stop` 再 `start` 才會載入（只改程式的話 `docker restart supabase_edge_runtime_coffee-log` 就好）
- `node scripts/social-ui-test.mjs`：兩個隔離的 headless Chrome 環境（A、B）操作真的畫面：加好友、封鎖、XSS、頭像 EXIF、登出；登入用 admin API 拿真的 session（Google 登入無法自動化）
- 本機頁面用 `python -m http.server 8000` 開 `http://localhost:8000/`（`config.toml` 的 site_url／redirect URL 是這個；本機沒有設定 Google，無法真的登入）
- 本機 Studio：http://127.0.0.1:54323
- migration 已套用到正式專案後就不能改，要改權限請新增一個 migration
