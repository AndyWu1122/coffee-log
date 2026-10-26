# 國旗（產地地圖用）

- 來源：[flag-icons](https://github.com/lipis/flag-icons) 7.2.3 的 `flags/4x3/<code>.svg`（MIT 授權，全文在下面）
- 只放 `js/origins.js` 的 `COUNTRIES`（32 個產咖啡的國家），檔名＝小寫的國家代碼
- 用 `npx svgo@3.3.2 --multipass -p <0|1>` 壓縮過（原本約 450KB → 約 250KB），**不是 App 的建置步驟**，只有更新國旗時才跑：
  - 每個檔案先試 `-p 0`（座標取整數，國旗的座標系統是 640×480），用 headless Chrome 畫成 160×120 和原檔逐像素比對，
    差超過 32 的像素 ≥ 0.5% 就改用 `-p 1`（緬甸、中國、印度等有星星、法輪的國旗取整數會變形）
  - 壓縮完要把原檔和新檔並排截圖，用眼睛確認一次
- 新增產國時：下載同一版的檔案、照上面壓縮，再加進 `sw.js` 的 `ASSETS`（origins-test 會檢查每個國家都有、都在 ASSETS、總大小 ≤ 300KB）

## 授權

```
The MIT License (MIT)

Copyright (c) 2013 Panayiotis Lipiridis

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
