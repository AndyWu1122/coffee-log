// 在畫面畫出前套用主題，避免先閃一下另一個主題
// 由 index.html <head> 以一般（非 module、非 defer）的 <script> 載入，會擋住畫面直到執行完
// 不寫成 inline script：CSP 只允許 'self' 的 script
// 偏好（auto/light/dark）存 localStorage：只是這支手機的顯示偏好，需要同步讀取（見 CLAUDE.md）
// 切換邏輯在 js/app.js 的 setupTheme()，兩邊的判斷要一致
//
// 也在這裡防點擊劫持（clickjacking）：被別的網頁用 iframe 嵌入時整頁不顯示，並把最上層換成 App 本身
// （meta 的 CSP 不能設 frame-ancestors，GitHub Pages 也不送 X-Frame-Options；放在這裡是因為它在畫面畫出前執行）
(function () {
  if (window.top === window.self) return;
  document.documentElement.style.display = 'none';
  try { window.top.location = window.location.href; } catch (e) { /* sandbox 的 iframe 不能換頁：維持不顯示 */ }
})();

(function () {
  var pref = 'auto';
  try { pref = localStorage.getItem('theme') || 'auto'; } catch (e) {}
  var light = pref === 'light' || (pref !== 'dark' && matchMedia('(prefers-color-scheme: light)').matches);
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  document.querySelector('meta[name="theme-color"]').content = light ? '#ffffff' : '#2b1d14';
  // iPhone 主畫面 App 的狀態列：淺色主題要深色字
  document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]').content = light ? 'default' : 'black-translucent';
})();
