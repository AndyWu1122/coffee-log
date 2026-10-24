# 通宵報告：feature/comments（2026-10-26）

分支 `feature/comments`，5 個 commit，**沒有 push、沒有合併、沒有碰正式 Supabase 和金鑰**。

## 1. 完成了什麼

| 階段 | 內容 | commit |
|---|---|---|
| 1 意見回饋 Email | 寄信流程本身沒有 bug（本機假 Resend 一直收得到）。真正的問題是**設定缺漏時靜默不寄、log 什麼都沒有**，Resend 的錯誤也只印原文。已改成每次沒寄出都有一行 `[feedback] 沒有寄信：<中文原因>`，寄出時記下 Resend 的 email id，金鑰一律遮蔽 | 9347eb5 |
| 2 版本號 x.y.z | `sw.js` 只維護 `APP_VERSION`（`CACHE_NAME` 由它產生）；☰ 顯示「版本 1.1.0」，意見回饋附同一個字串；`feedback.app_version` 改文字（新 migration，舊資料 17 → '17' 已實測）；舊 Service Worker 回整數時新版 App 照常顯示 | a887d75 |
| 3 留言（後端） | `comments` 表＋RLS＋trigger＋通知函式 `comment_activity()`，全部限制在資料庫強制 | 92eb71b |
| 4 社群頁（介面） | 「好友」→「社群 💬」、全部｜我的、「我」標籤、讚數＋留言數、留言區（回覆縮排、@暱稱、收起、刪除、先顯示失敗改回、300 字提示）、數字徽章（99+、看過歸零）、隱私說明 | 8632a52 |
| 收尾 | CLAUDE.md、`docs/supabase-setup.md`（5-2 Email 排查、5-3 部署）、本報告 | 最後一個 commit |

**測試結果**（從 `db reset` 開始全部重跑）：

| 測試 | 結果 |
|---|---|
| pgTAP（`supabase test db`，9 個檔案） | ✅ 365/365 |
| feedback-mail-test（新） | ✅ 21/21 |
| supabase-api-test | ✅ 37/37 |
| supabase-storage-test | ✅ 51/51 |
| supabase-comments-test（新） | ✅ 65/65 |
| photo-exif-test | ✅ 136/136 |
| social-ui-test | ✅ 64/64 |
| social-feed-test | ✅ 63/63 |
| social-safety-test | ✅ 50/50（含社群頁、留言區的 CSP） |
| social-feedback-test | ✅ 39/39（含 function log 不含金鑰） |
| social-comments-test（新） | ✅ 66/66 |

開工前的基準也全部通過（pgTAP 272、既有 7 支 scripts），所以沒有原本就壞掉的東西。另外用 390px 寬的手機尺寸截圖看過深色／淺色的社群頁與留言區。

新增的測試：`supabase/tests/07_feedback_version.test.sql`、`08_comments.test.sql`、`scripts/feedback-mail-test.mjs`、`supabase-comments-test.mjs`、`social-comments-test.mjs`。
既有測試因為「好友」→「社群」、徽章從「!」變數字而跟著改了文字與選擇器，檢查的行為沒有放寬。

## 2. 我替你做的決定

1. **Email 最可能的原因**：commit e0e8e0c 記載 `secrets set` 曾把 config.toml 的本機假值一起上傳，當時只 unset 了 `RESEND_API_URL`；正式的 `RESEND_API_KEY`／`FEEDBACK_TO` 很可能還是 `local-test-key`／`developer@test.local`。我算好了這兩個假值的 digest 讓你比對（見第 4 節）
2. **版本**：階段 2 是 1.0.0；加了留言（新功能）依新規則升到 **1.1.0**。舊版 Service Worker 的整數版本當成字串 `"18"`；Edge Function 兩種都收
3. **留言者的暱稱**：留言者常常不是讀者的好友，profiles 讀不到。我**沒有**擴大 profiles 的讀取範圍（裡面有好友代碼），而是留言當下由 trigger 記下暱稱（比照封鎖名單）。看得到 profile 時用即時暱稱與頭像，否則用快照＋首字頭像
4. **解除好友／封鎖時直接刪掉**雙方在對方貼文的留言（不是隱藏），重新加好友不會恢復。這樣不需要「判斷任意兩人關係」的函式（違反資安規則）
5. **回覆對象（@）只能是貼文作者或這一串留過言的人**：防止有人拿 `reply_to_user` 探測「某帳號是不是貼文作者的好友」
6. 路由改名 `#/social`，舊的 `#/feed` 自動轉址；`feed.js`、`feedDetail.js` 檔名不變，留言區另外放 `js/views/comments.js`
7. 回覆超過 3 則：顯示**前 3 則**，其餘收起；自己剛回覆的那串自動展開
8. 數字歸零的時機：讀社群頁第一頁時。「全部」三種都歸零，「我的」只歸零留言兩種；有新留言的卡片，留言數會用藍底標示一次
9. 自己的紀錄詳細頁：這台裝置有這筆才顯示「編輯」，沒有檢舉／封鎖按鈕；回覆自己的回覆不加 @
10. 留言可以換行，其他控制字元不行；空白（含全形空白、只有換行）不算內容

## 3. 沒完成或有疑慮的地方

- **正式環境的 Email 我碰不到**，只能補 log 和檢查清單；要你早上看 log 才能確定原因
- **解除好友會永久刪留言**：如果你比較想要「隱藏、重新加好友後恢復」，要改成用 RLS 判斷，但那需要一個回答「任意兩人是不是好友」的函式，和現在的資安規則衝突，我沒有這樣做
- 解除好友時**讚不會刪**，留言會刪（讚是原本的行為，我沒動）
- 暱稱快照：非好友看到的是留言當下的暱稱，對方改名後不會更新
- 沒做：留言的檢舉、編輯（規格要求不能修改）、即時推播
- `service_role` 不能直接新增留言（沒有 `private.single_line` 的執行權限，和 shared_brews 一樣）；後台 Table Editor 用的是 postgres，不受影響。測試灌 100 則改用 psql
- 本機改了 Edge Function 要 `docker restart supabase_edge_runtime_coffee-log` 才會生效（已寫進 CLAUDE.md）
- 部署順序要注意：**先後端、再前端**（見第 4 節）。如果先 push 前端，留言區會顯示錯誤直到 migration 套用

## 4. 你要做的事（照順序）

### A. 意見回饋 Email（約 5 分鐘）
1. Supabase 後台 → Table Editor → `feedback`：有沒有你之前送的那幾則？（有 → 存檔正常，問題在寄信）
2. `npx supabase@2.120.0 secrets list`，看 digest：
   - `RESEND_API_KEY` 是 `ed80667ec3d95b40e0d38f0ca5661b5c2765c1dd62682640d0976f20bbd8254a` → 是假值 `local-test-key`
   - `FEEDBACK_TO` 是 `0b5a059eb0b290fcf38eafebb2c5658edd76990577bf65b9b9a46cea0e2c72ad` → 是假值 `developer@test.local`
3. Resend 後台確認註冊的 email，然後重設（**FEEDBACK_TO 要和它一字不差**）：
   `npx supabase@2.120.0 secrets set RESEND_API_KEY=re_xxx FEEDBACK_TO=你的Gmail`
4. Edge Functions → feedback → Logs：看舊的 `feedback email failed` 有沒有寫 403／401（新版 log 要部署後才有，見 B）
5. Resend 後台 → Emails：有沒有寄送紀錄、狀態
6. Gmail 垃圾郵件匣、「促銷內容」，搜尋 `onboarding@resend.dev`
7. 部署完 B 之後再送一則回饋；沒收到就看 log 裡 `[feedback]` 那一行，對照 `docs/supabase-setup.md` 5-2

### B. 看過、確認後部署（`docs/supabase-setup.md` 5-3）
```sh
git log --oneline main..feature/comments      # 看一下這 5 個 commit
npx supabase@2.120.0 link --project-ref rygsjrzddhhhdqpoayoa
npx supabase@2.120.0 db push --dry-run         # 應該只有 *_feedback_app_version_text.sql、*_comments.sql
npx supabase@2.120.0 db push
npx supabase@2.120.0 functions deploy feedback
```
然後 Supabase 後台確認：Edge Functions → feedback 的 Verify JWT 開著；Table Editor 有 `comments`、RLS enabled。

### C. 前端上線
```sh
git checkout main && git merge --ff-only feature/comments && git push
```
手機打開 App 會出現「有新版本可用」→ 更新 → ☰ 最下面是「版本 1.1.0」。找一位好友互相留言、回覆，看「社群」分頁的數字。
