# 正式 Supabase 專案與 Google 登入設定

咖啡社群上線前，要用你自己的帳號完成以下設定。標「你」的步驟需要登入你的 Supabase／Google 帳號；標「Claude」的可以交給 Claude 做。

**金鑰規則**
- **可以進 repo**：Project URL、anon／publishable key（公開的，權限全部由資料庫 RLS 把關）
- **絕對不能進 repo、不能貼到前端、不能貼到聊天裡**：service_role／secret key、資料庫密碼、Google Client Secret
- 資料庫密碼、Google Client Secret 存在密碼管理器；Google Client Secret 只填在 Supabase 後台

---

> **目前的正式專案**：ref `rygsjrzddhhhdqpoayoa`（Tokyo，免費方案），2026-10-24 建立；migration、`delete-account`、前端設定都已完成，Google 登入已實際測試成功。
> 2026-10-25：意見回饋的 migration 與 `feedback` 已部署，`RESEND_API_KEY`、`FEEDBACK_TO` 已設定（見 5-2）；但 Email 沒收到，排查見 5-2 的「沒收到 Email」
> 2026-10-26：`feature/comments` 分支（版本號 x.y.z、留言與回覆）**尚未部署**，步驟見 5-3

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
npx supabase@2.120.0 db push --dry-run      # 應該只列出下面兩個 migration
npx supabase@2.120.0 db push                # 套用（確認後輸入 Y）
npx supabase@2.120.0 functions deploy feedback
```

- 套用的 migration：
  - `20261025130000_feedback_app_version_text.sql`：`feedback.app_version` 改文字（舊資料 18 → '18'）
  - `20261025140000_comments.sql`：留言表、權限、通知函式、解除好友時刪留言的 trigger
- `feedback` 一定要重新部署：新版 App 送的是 `"1.1.0"` 字串，舊版 function 只收整數（會記成「不明」，不會壞）；新版也會在 log 寫出沒寄信的原因
- 部署後確認：Supabase 後台 → Edge Functions → feedback 的 **Verify JWT** 開著；Table Editor 有 `comments`，RLS enabled
- 最後才把分支合併到 main 並 push（前端部署）。順序反過來的話，新版 App 會在留言區顯示錯誤，直到後端部署完成

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
- [ ] repo 裡沒有 secret／service_role key、資料庫密碼、Google Client Secret
