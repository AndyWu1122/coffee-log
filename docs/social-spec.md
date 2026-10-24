新增「咖啡社群」功能：登入帳號、加好友、看好友的沖煮紀錄、可以上傳照片。
後端用 Supabase（Auth、Postgres、Storage）。先讀 CLAUDE.md。
這是有資安風險的功能，請分階段做，每階段通過測試、我確認後才進下一階段。先給我完整計畫。

## 核心原則
- 本機優先：紀錄照樣先存 IndexedDB，沒登入、沒網路都能用
- 每筆紀錄有可見度：private（只有我，預設）/ friends（好友可見）
- 只有 friends 的紀錄會同步到雲端；改回 private 或刪除時，雲端的紀錄和照片一起刪除
- 好友需要雙方同意，不做公開追蹤，也沒有任何對陌生人公開的內容
- 只收暱稱和頭像，不收真名、學號

## 階段 1：資料庫與權限（還不寫介面）
- SQL 放 supabase/migrations/
- 資料表：profiles(暱稱、好友代碼)、friendships(申請者、接收者、狀態 pending/accepted)、
  blocks(封鎖)、shared_brews(擁有者、豆子資訊、參數、風味、評分、筆記、照片路徑、建立時間)、
  likes、reports
- 每張表開 RLS，預設拒絕：
  - shared_brews：本人可以新增、修改、刪除；只有 accepted 好友可以讀；有封鎖關係時雙方都讀不到
  - friendships：只有當事雙方可以看；只有接收者可以接受；任一方可以刪除（解除好友）
  - 一律用 auth.uid()，不信任前端傳來的 user_id
- check 約束：暱稱 ≤ 20 字、筆記 ≤ 500 字、評分和風味 1–5、數值合理範圍
- 加好友用隨機好友代碼或 QR code，不提供「搜尋所有使用者」
- 限制：每人每天最多送 20 個好友邀請、上傳 30 筆紀錄
- 自動化測試（三個測試帳號 A、B、C；A 和 B 是好友，C 不是）：
  - C 讀不到 A 的任何紀錄和照片
  - B 讀得到 A 的 friends 紀錄，讀不到 A 的 private 紀錄（private 根本不該上傳）
  - B 不能修改或刪除 A 的紀錄
  - A 封鎖 B 之後，B 讀不到 A 的任何東西
  - 未登入者什麼都讀不到
  - C 不能自己把好友申請改成 accepted
  - 超長字串、評分 99 都會被資料庫拒絕

## 階段 2：照片（Storage）
- 私有 bucket，路徑 <user_id>/<brew_id>.jpg；Storage RLS：只有本人能上傳和刪除，只有好友能讀
- 顯示時用 signed URL（有效期 1 小時），不用公開網址
- 上傳前在前端處理：只接受 image/jpeg、png、webp；用 Canvas 縮到最長邊 1600px，
  重新編碼成 JPEG（品質 0.8），這樣會移除 EXIF（包含 GPS）
- 寫測試確認上傳後的檔案沒有 EXIF
- bucket 設定單檔上限 1MB、只允許 image/jpeg

## 階段 3：帳號與好友
- Google 登入、設定暱稱和頭像（頭像一樣要壓縮並移除 EXIF）
- 我的好友代碼和 QR code、輸入代碼送出邀請、接受或拒絕、解除好友、封鎖
- Supabase URL 和 anon key 放 js/config.js；service_role key 絕對不能進前端或 repo；.gitignore 加 .env

## 階段 4：動態牆與同步
- 紀錄表單加可見度切換（預設只有我）和拍照或選照片
- 新分頁「好友」：好友動態牆，依時間排序，可以按讚，點進去看詳細參數
- 同步：friends 紀錄上傳；離線時排隊，上線後再送；衝突以本機為準
- 別人寫的所有內容一律用 esc() 或 textContent 顯示，禁止未跳脫的 innerHTML
- 測試：暱稱和筆記放 <script>alert(1)</script>，畫面只能顯示成文字

## 階段 5：安全與隱私收尾
- 檢舉紀錄、封鎖使用者
- 「刪除我的帳號」：刪除雲端所有資料和照片（本機資料保留，並提示先匯出備份）
- 隱私說明頁：收集什麼、誰看得到、照片怎麼處理、怎麼刪除
- CSP meta：只允許自己的網域和 Supabase 網域；supabase-js 固定版本並加 SRI
- Service Worker 不能快取 API 請求和照片的 signed URL

## 每階段收尾
- sw.js：CACHE_VERSION +1、ASSETS 更新
- 更新 CLAUDE.md，加入以下規則：
  - 每張表和 Storage bucket 都必須開 RLS，預設拒絕
  - 判斷身分一律用 auth.uid()
  - service_role key 不可出現在前端或 repo
  - 他人內容一律跳脫後才顯示
  - 照片一律在前端重新編碼並移除 EXIF 才上傳
  - 修改權限時必須同時新增「跨帳號存取必須失敗」的測試
- 每階段完成就 git commit
