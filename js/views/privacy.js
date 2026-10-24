// #/privacy 隱私說明（從 ☰ 選單、帳號頁進入）：收集什麼、誰看得到、照片怎麼處理、怎麼刪除
// 靜態內容，離線也能看；沒有社群功能的網址也顯示（說明資料只存在這支手機）
// ⚠ 內容要和實際行為一致：修改資料收集、可見範圍、照片處理、刪除流程時，這頁要一起改
import { socialAvailable } from '../models.js';
import { setTitle } from './ui.js';

const UPDATED = '2026-10-24';

export function render(container) {
  setTitle('隱私說明');
  container.innerHTML = `
    <article class="privacy">
      <p class="hint">最後更新：${UPDATED}</p>

      <section class="section">
        <h2>不登入時</h2>
        <ul class="plain-list">
          <li>沖煮紀錄、豆子、磨豆機、照片都只存在這支手機的瀏覽器裡，不會上傳到任何地方</li>
          <li>外觀設定（深色／淺色）也只存在這支手機</li>
          <li>沒有廣告、沒有分析或追蹤工具</li>
          <li>清除瀏覽器的網站資料或刪除主畫面的 App，資料就會消失，請定期到 ☰ →「備份」匯出</li>
        </ul>
      </section>

      ${socialAvailable ? '' : '<p class="notice">這個網址沒有開放咖啡社群功能，以下內容只適用於有開放的網址。</p>'}

      <section class="section">
        <h2>登入「咖啡社群」後會存到伺服器的資料</h2>
        <ul class="plain-list">
          <li><strong>Google 帳號的 email</strong>：只用來登入，其他使用者看不到</li>
          <li><strong>暱稱、頭像</strong>：你自己設定的（不使用 Google 的名字和大頭貼）</li>
          <li><strong>好友代碼、好友關係、封鎖名單</strong>（封鎖時會記下對方當下的暱稱，好讓你之後能解除封鎖）</li>
          <li><strong>你選擇「👥 好友」的沖煮紀錄</strong>：豆子名稱、產地、處理法、烘焙度與烘焙日、沖煮參數、評分、風味、筆記和照片。
            選「🔒 只有我」（預設）的紀錄不會上傳</li>
          <li><strong>按讚、檢舉</strong></li>
          <li>不收集真實姓名、學號、電話或位置</li>
        </ul>
      </section>

      <section class="section">
        <h2>誰看得到</h2>
        <ul class="plain-list">
          <li>只有<strong>雙方都同意的好友</strong>看得到你分享的紀錄、照片、暱稱和頭像；沒有任何公開的內容，也不能搜尋使用者</li>
          <li>送出或收到好友邀請、還沒接受時，對方看得到你的暱稱和頭像</li>
          <li>封鎖之後雙方互相看不到，對方不會收到通知</li>
          <li>按讚：看得到那筆紀錄的人都看得到讚數；其中是你好友的人，看得到是你按的</li>
          <li>檢舉只有站長看得到，被檢舉的人不會知道是誰檢舉的</li>
          <li>站長（這個服務的管理者）技術上能看到資料庫裡的內容，只在處理檢舉和維護系統時查看</li>
        </ul>
      </section>

      <section class="section">
        <h2>照片怎麼處理</h2>
        <ul class="plain-list">
          <li>選照片時就在手機上重新壓縮成 JPEG（最長邊 1600 像素），照片裡的拍攝地點（GPS）、相機型號等資訊會被移除；上傳前會再檢查一次</li>
          <li>照片存在不公開的空間，好友看的時候用 1 小時內有效的連結</li>
          <li>限制：好友在解除好友或封鎖前拿到的連結，1 小時內仍然打得開；好友也可以截圖或存下照片。只分享你願意讓好友保留的照片</li>
        </ul>
      </section>

      <section class="section">
        <h2>資料存在哪裡</h2>
        <ul class="plain-list">
          <li>使用 Supabase（美國公司）提供的資料庫和檔案空間，伺服器在日本東京</li>
          <li>傳輸一律加密（HTTPS）</li>
        </ul>
      </section>

      <section class="section">
        <h2>怎麼刪除</h2>
        <ul class="plain-list">
          <li><strong>一筆紀錄</strong>：改回「🔒 只有我」或刪除，雲端的紀錄和照片會在下次連上網路時刪除</li>
          <li><strong>整個帳號</strong>：☰ →「帳號」→「刪除我的帳號」，雲端的所有資料和照片立即刪除、無法復原；這支手機上的紀錄會保留</li>
          <li>登出不會刪除雲端的資料</li>
          <li>匯出的備份檔包含你所有的紀錄和筆記，請自己保管好，不要傳給別人</li>
        </ul>
      </section>

      <section class="section">
        <h2>有問題</h2>
        <p>請到 <a href="https://github.com/AndyWu1122/coffee-log/issues" rel="noopener noreferrer" target="_blank">GitHub</a> 回報。</p>
      </section>
    </article>`;
}
