<p align="center"><img src="icons/icon-192.png" width="96" alt=""></p>

# 咖啡紀錄（coffee-log）

記錄手沖咖啡沖煮參數與風味的 PWA，主要在手機上使用。可以加到主畫面、離線使用，資料預設只存在自己的手機裡。

**👉 打開 App：<https://andywu1122.github.io/coffee-log/>**

## 功能

- **沖煮紀錄**：豆子、濾杯、磨豆機與研磨度、粉量／水量（自動算粉水比）、水溫、總時間、評分、酸甜苦醇、筆記、照片；可以「用這次參數再沖一杯」
- **SCA 風味輪**：三層、可放大的風味輪，點選喝到的風味
- **豆子管理**：產地、處理法、焙度、烘焙日（自動算養豆天數），剩餘量與「約還能沖幾杯」
- **統計**：評分變化、每支豆子與器材的比較、粉水比與水溫分布，以及 GitHub 風格的沖煮熱度圖
- **產地地圖**：在世界地圖上看自己喝過哪些產區；「認識產區」介紹各國與主要產區的海拔、處理法、常見風味，還有想買清單
- **分享卡片**：產生 IG 貼文／限時動態尺寸的圖片
- **備份**：整份資料（含照片）匯出成 JSON，可以合併或取代全部匯入
- **咖啡社群**（選用，要用 Google 登入）：加好友、分享紀錄給好友、按讚、留言與回覆、個人檔案、推播通知
- 深色／淺色主題、新手教學

## 隱私

- 沒有登入時，所有資料只存在瀏覽器的 IndexedDB，不會上傳
- 每一筆紀錄預設「只有我」看得到，選「好友」才會上傳，而且只有互相加好友的人看得到
- 照片在手機上重新編碼成 JPEG，GPS 等 EXIF 資訊不會留下；豆子的照片不上傳
- 詳細內容見 App 裡的「設定與關於 → 隱私說明」

## 技術

- 純 HTML／CSS／JavaScript（ES Modules），不用框架、不用打包工具
- 儲存用 IndexedDB；Service Worker 預先快取所有檔案，可以離線使用
- 社群後端用 [Supabase](https://supabase.com/)（Postgres + RLS、Storage、Edge Functions），推播用標準 Web Push（VAPID）
- 部署在 GitHub Pages（main 分支根目錄）

## 本機執行

```bash
python -m http.server 8000
# 打開 http://localhost:8000/
```

ES Modules 不能用 `file://` 打開，要透過本機伺服器。開發時 Service Worker 會快取檔案，建議在 DevTools → Application → Service Workers 勾選「Update on reload」。

社群功能需要 Docker Desktop 和本機的 Supabase：

```bash
npx supabase@2.120.0 start
npx supabase@2.120.0 test db   # pgTAP 權限測試
```

## 測試

測試在 `scripts/`，用 Node 和 headless Chrome 執行（找不到 Chrome 時設 `CHROME_PATH`）。有些不需要 Supabase，例如：

```bash
node scripts/brew-ui-test.mjs
node scripts/stats-ui-test.mjs
node scripts/origin-map-ui-test.mjs
```

名稱以 `supabase-`、`social-` 開頭的測試需要先啟動本機 Supabase，而且只會連本機。

## 專案結構

```
index.html, sw.js, manifest.json
css/style.css
js/app.js        進入點與 hash 路由
js/db.js         唯一存取 IndexedDB 的地方
js/models.js     驗證、計算
js/cloud.js      唯一存取 Supabase 的地方
js/views/        各頁畫面
supabase/        migrations、pgTAP 測試、Edge Functions
scripts/         自動化測試
docs/            社群功能規格、Supabase 設定步驟、roadmap
```

分層規則是 views → models → db／cloud，畫面不直接碰資料庫。更完整的開發規則（資料模型、資安規則、版本號）寫在 [CLAUDE.md](CLAUDE.md)。

## 第三方內容

- 風味輪改編自 SCA／World Coffee Research 的〈Coffee Taster's Flavor Wheel〉（CC BY-NC-ND 4.0），App 裡的是自己翻譯、重新排列的個人使用版本
- 國界資料：[Natural Earth](https://www.naturalearthdata.com/)（公有領域）
- `js/vendor/`：supabase-js、qrcode-generator，來源與授權見 [js/vendor/README.md](js/vendor/README.md)
