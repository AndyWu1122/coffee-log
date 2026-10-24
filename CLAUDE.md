# 手沖咖啡紀錄 App（coffee-log）

記錄手沖咖啡沖煮參數與風味的 PWA，主要在手機上使用。回覆與註解請用繁體中文。

## 技術規則
- 純 HTML / CSS / JavaScript（ES Modules），**不使用框架、不使用打包工具**
- 儲存：IndexedDB（可用 `idb` 小型 wrapper，或自己包一層）
- PWA：manifest.json + Service Worker，需可離線使用
- 部署：GitHub Pages
- 介面以手機直向為主（mobile-first），按鈕要大，方便沖咖啡時單手操作

## 資料夾結構
```
index.html
manifest.json
sw.js
css/style.css
js/app.js          # 進入點 + hash 路由
js/db.js           # 唯一存取 IndexedDB 的地方
js/models.js       # 驗證、計算（粉水比、養豆天數）
js/timer.js        # 計時器狀態機（不含 DOM）
js/views/          # brewList, brewForm, beanList, beanForm, timerView
icons/
```

## 分層規則
views → models → db，每層只呼叫下一層。views 不可直接碰 IndexedDB。

## 資料模型（schemaVersion: 1）
**beans**：id, name, origin, process(washed/natural/honey/other), roastLevel(light/medium/dark), roastDate(YYYY-MM-DD), archived(bool), createdAt
**brews**：id, beanId, brewedAt, dripper, grindSetting, coffeeG, waterG, tempC, pours[{t(秒), waterG(累計)}], totalTimeS, rating(1–5), flavor{acidity, sweetness, bitterness, body}(1–5), notes
- brews 建索引：beanId、brewedAt
- 衍生值不儲存：粉水比 = waterG / coffeeG、養豆天數 = 沖煮日 − roastDate，在 models.js 計算
- id 用 crypto.randomUUID()

## 路由（hash）
`#/` 紀錄列表｜`#/brew/new`｜`#/brew/new?from=<id>` 複製參數新增｜`#/brew/<id>` 編輯｜`#/beans`｜`#/timer`

## 計時器
- 狀態：idle → running ⇄ paused → done
- 時間用 Date.now() 與開始時間的差值計算，**不可用 setInterval 累加**（手機背景會不準）
- 每次注水記錄 {t, waterG}；完成後導向 `#/brew/new` 並帶入 pours、totalTimeS

## 備份
- 匯出全部資料為 JSON（含 schemaVersion），可匯入還原

## 開發順序
- v0.1：db.js + 豆子 CRUD + 紀錄 CRUD + 列表
- v0.2：計時器，完成後自動帶入表單
- v0.3：複製上一次、篩選、JSON 匯出匯入
- v0.4：PWA（manifest、離線）+ 部署 GitHub Pages
- 一次只做一個版本，做完要能實際使用再進下一版

## 開發習慣
- 本地測試用 `python -m http.server`（ES Modules 不能用 file:// 開）
- 每完成一個功能就 git commit
