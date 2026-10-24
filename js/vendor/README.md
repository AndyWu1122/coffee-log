# 第三方程式庫（原封不動，不要修改）

| 檔案 | 來源 | 授權 | SHA-384（SRI） |
|---|---|---|---|
| `supabase-js-2.117.3.js` | npm `@supabase/supabase-js@2.117.3` 的 `dist/umd/supabase.js` | MIT（Copyright (c) 2020 Supabase） | `sha384-BWcjm9OdFth9TbhCxZPdm+gAOUMAzQy9nmTs12ioXdCcbVnJaPMn+fMUoQCLt60R` |
| `qrcode-generator-2.0.4.js` | npm `qrcode-generator@2.0.4` 的 `dist/qrcode.mjs` | MIT（Copyright (c) 2009 Kazuhiko Arase，授權寫在檔案開頭） | `sha384-xHtsZTi0cOhTiha4kloGDUR5e5A8ixkKsF1Mmpqq3tkDpAhkA4YOKIDua/Tc0Ecd` |

- 從 npm 下載（`npm pack <套件>@<版本>`，npm 會比對 registry 的 integrity），不從 CDN 載入：離線也能用，也不受 CDN 被竄改影響
- supabase-js 由 `js/cloud.js` 以 `<script integrity>` 載入，SRI 寫在 `js/cloud.js` 的 `SUPABASE_JS`
- 升級：換新檔名（含版本號）→ 重新計算 `openssl dgst -sha384 -binary <檔案> | openssl base64 -A` → 更新這張表、`js/cloud.js`、`sw.js` 的 ASSETS
- `.gitattributes` 設定這個資料夾不轉換換行（Windows 的 autocrlf 會改變檔案內容，SRI 就對不上）

## supabase-js 授權全文

MIT License

Copyright (c) 2020 Supabase

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
