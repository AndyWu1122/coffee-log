# 通宵報告（feature/comments）

（進行中，最後會整理成 5 分鐘能看完的格式）

## 決定紀錄
- 階段 1：寄信的程式邏輯本身沒有錯（本機假 Resend 一直都收得到）。真正的 bug 是「設定缺漏時靜默不寄、log 什麼都沒有」，以及 Resend 錯誤只印原文。改成每次沒寄出都有一行 `[feedback] 沒有寄信：<原因>`，成功時記下 Resend 的 email id
- 階段 1：最可疑的原因是正式專案的 secrets 被 config.toml 的假值蓋掉（commit e0e8e0c 記載 `secrets set` 曾一起上傳 `[edge_runtime.secrets]`，當時只 unset 了 `RESEND_API_URL`）
- 本機改 Edge Function 後要 `docker restart supabase_edge_runtime_coffee-log` 才會載入新程式（記進 CLAUDE.md）
