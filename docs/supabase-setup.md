# 正式 Supabase 專案與 Google 登入設定

咖啡社群上線前，要用你自己的帳號完成以下設定。標「你」的步驟需要登入你的 Supabase／Google 帳號；標「Claude」的可以交給 Claude 做。

**金鑰規則**
- **可以進 repo**：Project URL、anon／publishable key（公開的，權限全部由資料庫 RLS 把關）
- **絕對不能進 repo、不能貼到前端、不能貼到聊天裡**：service_role／secret key、資料庫密碼、Google Client Secret
- 資料庫密碼、Google Client Secret 存在密碼管理器；Google Client Secret 只填在 Supabase 後台

---

> **目前的正式專案**：ref `rygsjrzddhhhdqpoayoa`（Tokyo，免費方案），2026-10-24 建立；migration、`delete-account`、前端設定都已完成，Google 登入已實際測試成功。
> 2026-10-25：意見回饋的 migration 與 `feedback` 已部署，`RESEND_API_KEY`、`FEEDBACK_TO` 已設定（見 5-2）；Email 一開始沒收到，原因是 `RESEND_API_KEY` 無效（Resend 回 401），2026-10-26 換新 key 後已正常（排查步驟見 5-2 的「沒收到 Email」）
> 2026-10-26：新版 `feedback`（log 會寫出沒寄信的原因）已先部署；`feature/comments` 的 migration 與前端**尚未部署**，步驟見 5-3
> 2026-10-25：留言、封鎖不解除好友（1.2.0）、更新內容（1.3.0）、開發者後台（1.4.0）與 1.4.1 的修正都已部署上線；`feature/profile`（個人檔案，1.5.0）**尚未部署**，步驟見 5-5
> 2026-10-29：推播通知（1.9.0）已部署：migration、`send-push`（Verify JWT 關閉）、secrets、vault 都已設定，前端公鑰已填；步驟見 5-6
> 按讚、好友新貼文的推播（1.11.0，分支 feature/push-more）：**還沒部署**，步驟見 5-7

## 1. 建立 Supabase 專案（你）

1. 到 <https://supabase.com/dashboard> → **New project**
2. Name：`coffee-log`；Region：**Northeast Asia (Tokyo)**（離台灣最近；Supabase 沒有台灣的機房）
   - ⚠ 建好後確認專案首頁的 Primary Database 是 `ap-northeast-1`，地區之後不能改
   - 「Connect GitHub」跳過：migration 用 CLI 手動套用
3. Database Password：按 **Generate a password**，**存進密碼管理器**（之後套用 migration 要用）
4. 建好後記下 **Project ref**（網址 `https://supabase.com/dashboard/project/<ref>` 裡的那串）

> 免費方案：一週沒有任何活動會自動暫停，要到後台按「Restore」恢復。

## 2. 套用資料庫 migration（你，或讓 Claude 在你登入後執行）

```sh
npx supabase@2.120.0 login                          # 會開瀏覽器登入 Supabase
npx supabase@2.120.0 link --project-ref <ref>       # 會要求輸入資料庫密碼
npx supabase@2.120.0 db push                        # 列出要套用的 migration，確認後輸入 Y
```

- 套用的是 `supabase/migrations/` 裡全部的檔案：資料表、RLS、Storage bucket（brew-photos、avatars）
- ⚠ **套用到正式專案之後，這些 migration 檔案就不能再修改**；之後要改權限一律新增 migration

## 3. Auth 基本設定（你）

Supabase 後台 → **Authentication**：

1. **Sign In / Providers**
   - **Email：關閉**（Enable Email provider 取消勾選）。只用 Google 登入；開著的話任何人都能用 email 註冊或收登入信
   - Phone：關閉
   - Allow anonymous sign-ins：關閉
2. **URL Configuration**
   - Site URL：`https://andywu1122.github.io/coffee-log/`
   - Redirect URLs：只加 `https://andywu1122.github.io/coffee-log/`（結尾要有 `/`，要完全一致）

## 4. Google OAuth 用戶端（你）

到 <https://console.cloud.google.com/>：

1. 上方選單 → **新增專案**，名稱 `coffee-log`
2. 左側 **Google Auth Platform**（或「API 和服務 → OAuth 同意畫面」）→ **開始使用**
   - 應用程式名稱：`手沖紀錄`；使用者支援電子郵件：你的 Gmail
   - 目標對象：**外部**
   - 聯絡資訊：你的 Gmail → 建立
3. **品牌（Branding）**（沒填完整的話，「目標對象」的「發布應用程式」按鈕會是灰的）
   - 應用程式首頁：`https://andywu1122.github.io/coffee-log/`
   - 隱私權政策連結：`https://andywu1122.github.io/coffee-log/#/privacy`
   - 已授權網域：加入 `andywu1122.github.io` 和 `<ref>.supabase.co`
   - **不要上傳標誌**（上傳標誌就要送 Google 審核）
4. **資料存取（Data Access）**→ 新增範圍：只勾 `openid`、`.../auth/userinfo.email`、`.../auth/userinfo.profile`
5. **目標對象（Audience）**→ 發布狀態按 **發布應用程式**
   - 只用基本範圍不需要審核；如果一直停在「測試中」，只有加進「測試使用者」的帳號能登入（最多 100 個）
6. **用戶端（Clients）**→ **建立用戶端**
   - 應用程式類型：**網頁應用程式**；名稱：`coffee-log`
   - 已授權的 JavaScript 來源：`https://andywu1122.github.io`
   - 已授權的重新導向 URI：`https://<ref>.supabase.co/auth/v1/callback`
     （Supabase 後台 Authentication → Providers → Google 頁面上有這個網址可以直接複製）
   - 建立後會顯示 **Client ID** 和 **Client Secret**
7. 回到 Supabase 後台 → **Authentication → Sign In / Providers → Google**
   - Enable：開啟
   - 貼上 Client ID、Client Secret → Save
   - Client Secret 只存在這裡和你的密碼管理器，**不要貼到任何其他地方**
   - ⚠ 登入後回到 App 顯示「登入沒有完成」、而且 Authentication → Users 沒有新使用者：通常是 Client Secret 貼錯。
     Google 只在建立時顯示一次密鑰，看不到就在用戶端頁按 **Add secret** 新增一組貼上，成功後停用並刪除舊的

## 5. 前端連到正式專案（Claude）

Supabase 後台 → **Project Settings → API Keys**，把這兩個值告訴 Claude：
- Project URL：`https://<ref>.supabase.co`
- **publishable key**（`sb_publishable_...`），或舊版的 **anon public** key
  - ⚠ 不是 secret／service_role key

Claude 會：
1. 填進 `js/config.js` 的 `PRODUCTION`
2. 把 Project URL 加進 `index.html` CSP 的 `connect-src`、`img-src`（不加的話 App 連不到 Supabase）
3. `sw.js` 的 `APP_VERSION` 升版（規則見 CLAUDE.md）、commit、push（push 到 main 就會部署）

## 5-1. 部署「刪除帳號」的 Edge Function（你，或讓 Claude 在你登入後執行）

```sh
npx supabase@2.120.0 functions deploy delete-account   # 需要先完成第 2 步的 login、link
```

- 函式用到的 service_role key 由 Supabase 自動提供，**不用、也不要**自己設定任何金鑰
- Supabase 後台 → Edge Functions → delete-account：確認 **Verify JWT** 是開著的

## 5-2. 意見回饋：資料表、Edge Function、Email 通知

回饋存在 `feedback` 表（只能新增，誰都讀不到；你在後台 Table Editor → feedback 看全部），
送出後由 Edge Function `feedback` 透過 [Resend](https://resend.com) 寄 Email 到你的信箱。

1. **Resend（你）**：用你要收通知的 Gmail 註冊 resend.com → API Keys → Create API Key（權限選 Sending access）→ 複製
   - 不用設定網域：免費方案從 `onboarding@resend.dev` 只能寄給「註冊 Resend 的那個 email」，剛好就是你自己
   - 免費方案每天 100 封，回饋每人每天最多 5 則，一般不會超過
2. **設定金鑰（你，或把 key 給 Claude 執行）**：
   ```sh
   npx supabase@2.120.0 secrets set RESEND_API_KEY=re_xxx FEEDBACK_TO=你的Gmail
   ```
   - 金鑰只存在 Supabase 的 secrets，**不要**寫進 repo 或 `config.toml`
   - ⚠ `config.toml` 的 `[edge_runtime.secrets]` 會被 `secrets set` 一起上傳到正式專案，所以那裡什麼都不放（本機測試的假 Resend 寫在 function 裡，依網址判斷）
   - 沒設定時回饋照樣存下來，只是不寄信
3. **部署（Claude，你確認後）**：
   ```sh
   npx supabase@2.120.0 db push                       # 套用 *_feedback.sql migration
   npx supabase@2.120.0 functions deploy feedback
   ```
   - Supabase 後台 → Edge Functions → feedback：確認 **Verify JWT** 是開著的
4. **實際送一則（你）**：App 登入後 ☰ →「意見回饋」送出 → Gmail 收得到信（第一次可能在垃圾郵件匣，標成「不是垃圾郵件」）、Table Editor 看得到這一則

### 沒收到 Email（照順序檢查）
1. **Table Editor → feedback**：有沒有剛送的那一則？沒有 → 問題在 App 或資料表（App 會顯示錯誤），不是寄信
2. **Edge Functions → feedback → Logs**：找 `[feedback]` 開頭的那一行（新版 function 才有，舊版只有 `feedback email failed`）
   - `已交給 Resend 寄出（id …）`：Resend 收下了 → 看第 5 步
   - `沒有寄信：沒有設定 …`／`…是本機測試用的假值…`／`…格式不對…` → 第 3 步重設 secrets
   - `沒有寄信：Resend 回傳 403（validation_error）…一字不差` → `FEEDBACK_TO` 和 Resend 帳號的 email 不一樣
   - `沒有寄信：Resend 回傳 403（invalid_api_key）` → 到 Resend 重新建立 API key
3. **secrets 是不是假值**：`npx supabase@2.120.0 secrets list` 只顯示 digest（SHA-256）。如果是下面這兩個，就是被以前 config.toml 的本機假值蓋掉了：
   - `RESEND_API_KEY` = `ed80667ec3d95b40e0d38f0ca5661b5c2765c1dd62682640d0976f20bbd8254a`（`local-test-key`）
   - `FEEDBACK_TO` = `0b5a059eb0b290fcf38eafebb2c5658edd76990577bf65b9b9a46cea0e2c72ad`（`developer@test.local`）
   - 不確定就直接重設一次：`npx supabase@2.120.0 secrets set RESEND_API_KEY=re_xxx FEEDBACK_TO=你的Gmail`（不用重新部署）
4. **FEEDBACK_TO 要和 Resend 帳號的 email 一字不差**：Resend 後台右上角 → Settings／Account 看註冊的 email（免費方案只能寄給它）
5. **Resend 後台 → Emails（或 Logs）**：有沒有這封、狀態是 Delivered／Bounced
6. **Gmail 的垃圾郵件匣**、「促銷內容」分頁；搜尋 `onboarding@resend.dev`

## 5-3. 部署 feature/comments（版本號 x.y.z、留言與回覆）

先合併到 main 前，**後端先上**（舊版 App 不會用到新的表，先部署不影響使用中的人）：

```sh
npx supabase@2.120.0 login                 # 已登入可略過
npx supabase@2.120.0 link --project-ref rygsjrzddhhhdqpoayoa
npx supabase@2.120.0 db push --dry-run      # 應該只列出下面三個 migration
npx supabase@2.120.0 db push                # 套用（確認後輸入 Y）
npx supabase@2.120.0 functions deploy feedback
```

- 套用的 migration：
  - `20261025130000_feedback_app_version_text.sql`：`feedback.app_version` 改文字（舊資料 18 → '18'）
  - `20261025140000_comments.sql`：留言表、權限、通知函式、解除好友時刪留言的 trigger
  - `20261025150000_block_keeps_friends.sql`：封鎖不再解除好友，只隱藏（用到上一個的 `private.blocked_with`，一定要一起套用）
- `feedback` 一定要重新部署：新版 App 送的是 `"1.1.0"` 字串，舊版 function 只收整數（會記成「不明」，不會壞）；新版也會在 log 寫出沒寄信的原因
- 部署後確認：Supabase 後台 → Edge Functions → feedback 的 **Verify JWT** 開著；Table Editor 有 `comments`，RLS enabled
- 最後才把分支合併到 main 並 push（前端部署）。順序反過來的話，新版 App 會在留言區顯示錯誤，直到後端部署完成

## 5-4. 部署 feature/admin（開發者後台，1.4.0）

和之前一樣，**後端先上、前端最後**（舊版 App 不會用到新的函式，先部署不影響使用中的人）：

```sh
npx supabase@2.120.0 link --project-ref rygsjrzddhhhdqpoayoa
npx supabase@2.120.0 db push --dry-run                     # 應該只列出 20261026100000_admin.sql、20261027100000_rate_limit_locks.sql
npx supabase@2.120.0 db push                               # 套用（確認後輸入 Y）
npx supabase@2.120.0 functions deploy admin-delete-user
npx supabase@2.120.0 functions deploy delete-account       # 刪除流程搬到 _shared/account.ts，要重新部署
```

- migration：`private.admins`、`public.admin_audit_log`（不能修改、刪除）、`private.removed_brews`、後台函式 `public.admin_*`、Storage 的開發者政策
- migration `*_rate_limit_locks.sql`（1.4.1）：每日上限的計數先上鎖（同時送出的請求不能超過上限）、互加好友同時送出不會出錯；只換函式內容，不動資料
- 部署後確認：Supabase 後台 → Edge Functions → `admin-delete-user` 的 **Verify JWT** 開著

### 設定第一個開發者（你，在 Supabase 後台 → SQL Editor）

App 裡**沒有任何方法**新增開發者（`private.admins` 沒有開放給 API），只能由你在 SQL Editor 執行。先用那個 Google 帳號在 App 登入過一次、設好暱稱，再執行：

```sql
-- 把 <你的 Gmail> 換成開發者的 Google 帳號
insert into private.admins (user_id)
select id from auth.users where email = '<你的 Gmail>';

-- 確認（應該列出 1 筆）
select a.user_id, u.email, a.created_at
from private.admins a join auth.users u on u.id = a.user_id;
```

- 拿掉開發者：`delete from private.admins where user_id = '<user id>';`
- 開發者不能從後台刪除自己或其他開發者；要刪就先從 `private.admins` 移除
- 操作紀錄 `public.admin_audit_log` 連 SQL Editor 都不能修改或刪除（trigger 擋下）

最後才把分支合併到 main 並 push（前端 1.4.0）。手機按「更新」後，開發者的 ☰ 會出現「🛠️ 開發者後台」。

## 5-5. 部署 feature/profile（個人檔案，1.5.0）

一樣**後端先上、前端最後**。舊版 App 讀 profiles 只用 `id, nickname, friend_code, avatar_path`，改成欄位層級權限後照常運作：

```sh
npx supabase@2.120.0 link --project-ref rygsjrzddhhhdqpoayoa
npx supabase@2.120.0 db push --dry-run      # 應該只列出 20261028100000_profile_fields.sql
npx supabase@2.120.0 db push                # 套用（確認後輸入 Y）
git push                                    # 合併到 main 之後；GitHub Pages 部署成 1.5.0
```

- migration：profiles 新增 `bio`、`favorite_gear`、`favorite_beans`（check 限制長度、行數、控制字元）；profiles 改成欄位層級的讀取權限；新函式 `public.profile_detail`
- 沒有新的 Edge Function、沒有新的 secret
- ⚠ Supabase 後台的 Table Editor 用的是管理者權限，照樣看得到全部欄位；SQL Editor 也是

## 5-6. 部署 feature/push（推播通知，1.9.0）

有人留言我的貼文、回覆我的留言時，手機跳出通知（標準 Web Push＋VAPID，不用 Firebase 等第三方服務）。
流程：留言寫入 → 資料庫 trigger（判斷通知誰）→ pg_net 呼叫 Edge Function `send-push` → Apple／Google 的推播服務 → 手機

**要設定的金鑰**（全部由你在自己的電腦產生、自己設定；**私鑰和密鑰不要貼給任何人，包括 Claude**）：

| 名稱 | 放在哪 | 公開？ |
|---|---|---|
| `VAPID_PUBLIC_KEY` | Supabase secrets＋`js/config.js` 的 `PRODUCTION.vapidPublicKey` | 公開（瀏覽器訂閱時要用） |
| `VAPID_PRIVATE_KEY` | Supabase secrets | **不公開** |
| `VAPID_SUBJECT` | Supabase secrets（`mailto:你的信箱`，推播服務有問題時聯絡你） | — |
| `PUSH_WEBHOOK_SECRET` | Supabase secrets＋vault 的 `push_webhook_secret`（兩邊一樣） | **不公開** |
| `send_push_url` | vault | 公開（function 的網址） |

- 資料庫和 function 之間用 `PUSH_WEBHOOK_SECRET` 驗證：trigger 對內容做 HMAC 簽章，密鑰本身不會被送出；沒有正確簽章的請求一律 401，一般使用者呼叫不了
- vault 是 Supabase 內建的加密儲存，只有資料庫管理者讀得到

### 1. 產生金鑰（你）

```sh
node scripts/vapid-keys.mjs 你的信箱@gmail.com
```

- 產生兩個檔案（都在 repo 根目錄，已被 `.gitignore` 排除，不會被 commit）：
  - `.env.push`：四個 secrets
  - `.env.push.sql`：vault 的設定（SQL）
- 畫面上只印出 **VAPID 公鑰**，這個可以貼給 Claude

### 2. 設定 secrets 與 vault（你）

```sh
npx supabase@2.120.0 link --project-ref rygsjrzddhhhdqpoayoa    # 已 link 可略過
npx supabase@2.120.0 secrets set --env-file .env.push
npx supabase@2.120.0 secrets list                                 # 確認有 VAPID_PUBLIC_KEY、VAPID_PRIVATE_KEY、VAPID_SUBJECT、PUSH_WEBHOOK_SECRET
```

- Supabase 後台 → **SQL Editor** → 打開 `.env.push.sql`，把內容整段貼上執行（建立 vault 的 `send_push_url`、`push_webhook_secret`）
- 兩個都設定好之後，**刪掉 `.env.push` 和 `.env.push.sql`**（金鑰只留在 Supabase；要換金鑰就重新執行第 1 步）
- 不要把它們寫進 `config.toml`（`[edge_runtime.secrets]` 會被 `secrets set` 一起上傳，見 5-2）

### 3. 前端的公鑰（Claude）

把第 1 步印出的 **VAPID 公鑰** 告訴 Claude，填進 `js/config.js` 的 `PRODUCTION.vapidPublicKey`（空字串時通知設定頁顯示「還沒開放」）。

### 4. 部署（Claude，你確認後；後端先上、前端最後）

```sh
npx supabase@2.120.0 db push --dry-run      # 應該只列出 20261029100000_push.sql
npx supabase@2.120.0 db push                # 套用（確認後輸入 Y）
npx supabase@2.120.0 functions deploy send-push --no-verify-jwt
git push                                    # 合併到 main 之後；GitHub Pages 部署成 1.9.0
```

- migration：pg_net、`push_subscriptions`（每人最多 10 台、endpoint 只能是 Apple／Google／Mozilla／Microsoft 的推播服務）、`notification_prefs`、`private.push_throttle`（5 分鐘合併）、留言後的 trigger `private.comments_push`
- Supabase 後台 → Edge Functions → send-push：確認 **Verify JWT 是關的**（呼叫者是資料庫，沒有使用者的 JWT；身分由簽章確認）
- Database → Extensions：`pg_net` 已啟用

### 5. 實機確認（你）

1. **iPhone**（iOS 16.4 以上）：Safari 開 App →「分享」→「加入主畫面」→ 從主畫面開啟 → ☰ →「🔔 通知設定」→「在這台裝置啟用通知」→ 允許
2. **Android**：Chrome 開 App → ☰ →「🔔 通知設定」→「在這台裝置啟用通知」→ 允許
3. 請一位好友在你分享的紀錄留言 → 手機跳出「<暱稱> 留言了你的貼文」→ 點通知打開那篇紀錄的留言
4. App 開著時點通知：應該在同一個視窗換頁，不會開新視窗

### 沒收到通知（照順序檢查）

1. **Table Editor → push_subscriptions**：有沒有你的裝置？沒有 → 在通知設定頁重新啟用
2. **Edge Functions → send-push → Logs**：找 `[send-push]` 開頭的行
   - 沒有任何紀錄：trigger 沒有呼叫 → 檢查 vault（SQL Editor：`select name from vault.decrypted_secrets;` 應該有 `send_push_url`、`push_webhook_secret`）；5 分鐘內同一篇貼文只通知一次
   - 只有 401（Invocations 頁）：vault 的 `push_webhook_secret` 和 secrets 的 `PUSH_WEBHOOK_SECRET` 不一樣 → 重做第 1、2 步
   - `沒有送出：…VAPID…`：secrets 沒設定或格式不對（log 會寫原因）
   - `推播服務回傳 403`：`js/config.js` 的公鑰和 secrets 的 `VAPID_PUBLIC_KEY` 不是同一組 → 公鑰改對後，每台裝置停用再啟用一次
   - `送出 1、過期刪除 0、失敗 0`：已經交給 Apple／Google → 檢查手機的系統設定是否允許這個 App 的通知、專注模式
3. **Database → `net._http_response`**（SQL Editor：`select status_code, created from net._http_response order by created desc limit 5;`）：trigger 呼叫 function 的結果

## 5-7. 部署 feature/push-more（按讚、好友新貼文的推播，1.11.0）

沿用 5-6 的金鑰、secrets、vault，**不需要設定任何新的金鑰**。

### 1. 部署（Claude，你確認後；後端先上、前端最後）

```sh
npx supabase@2.120.0 db push --dry-run      # 應該只列出 20261030100000_push_posts_likes.sql
npx supabase@2.120.0 db push                # 套用（確認後輸入 Y）
npx supabase@2.120.0 functions deploy send-push --no-verify-jwt
git push                                    # 合併到 main 之後；GitHub Pages 部署成 1.11.0
```

- migration：`notification_prefs` 加 `new_posts`（預設關）、`likes`（預設開）；`private.push_notified_posts`、`private.push_notified_likes`（記下通知過的，不重複通知）、`private.push_windows`（30 分鐘合併）；trigger `private.shared_brews_push`、`private.likes_push`
- **順序很重要**：migration 先上、send-push 緊接著部署。migration 上了但 send-push 還是舊版時，新的兩種通知會被舊版回 400（不會送出、也不影響上傳和按讚），部署完就正常
- 舊版 App（1.10.0 以前）照常運作：通知設定只有兩個開關，存檔時不會改到新的兩個
- send-push 確認 **Verify JWT 仍然是關的**

### 2. 實機確認（你）

1. 已經啟用通知的手機不用重新啟用；等 App 更新到 1.11.0（底部「有新版本可用」→ 更新）
2. ☰ →「🔧 設定與關於」→「通知設定」：有四個開關，「按讚」開、「好友新貼文」關
3. 請一位好友按讚你的紀錄 → 「<暱稱> 說你的貼文讚」→ 點通知打開那篇紀錄；30 分鐘內再有人按讚，通知改成「<暱稱> 和其他 1 人…」（Android 不會再響；iPhone 可能會）
4. 打開「好友新貼文」，請好友分享一杯 → 「<暱稱> 分享了一杯 <豆子名稱>」

### 沒收到通知

同 5-6 的檢查順序，另外：
- 按讚：同一個人對同一篇只通知一次（收回再按不會再通知）；自己按自己的不通知
- 好友新貼文：只在紀錄**第一次**分享時通知（修改、改回只有我再分享都不算）；確認你的「好友新貼文」開關是開的
- 合併中的通知沒有響是正常的（看通知中心的內容有沒有更新）

## 6. 實際登入一次（你）

1. 手機用 Safari／Chrome 開 <https://andywu1122.github.io/coffee-log/> → ☰ →「帳號」→「用 Google 登入」→ 設定暱稱
2. **iPhone 主畫面的 App 也要試一次**：登入完是否回到 App 本身，iOS 的行為要實機才知道。如果回到 Safari 而不是 App，告訴 Claude
3. Supabase 後台 → Authentication → Users 應該看得到你的帳號

## 7. 上線前檢查（你，看一眼就好）

- [ ] Table Editor：每張表都顯示 RLS enabled
- [ ] Storage：`brew-photos`、`avatars` 都是 Private
- [ ] Authentication → Providers：只有 Google 開著，Email 關閉
- [ ] Project Settings → Data API → Exposed schemas：只有 `public`、`graphql_public`（**不能有 `private`**）
- [ ] Edge Functions：`delete-account`、`feedback` 已部署，Verify JWT 開著
- [ ] Table Editor：`comments` 存在、RLS enabled
- [ ] Edge Functions → Secrets：有 `RESEND_API_KEY`、`FEEDBACK_TO`
- [ ] Edge Functions：`send-push` 已部署，**Verify JWT 關閉**；Secrets 有 `VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY`、`VAPID_SUBJECT`、`PUSH_WEBHOOK_SECRET`
- [ ] repo 根目錄沒有 `.env.push`、`.env.push.sql`（設定完就刪掉）
- [ ] repo 裡沒有 secret／service_role key、資料庫密碼、Google Client Secret、VAPID 私鑰
