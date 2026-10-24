// Supabase 連線設定（咖啡社群）
// anon key 是公開的：任何人都能拿它直接呼叫 API，所以所有權限都由資料庫（RLS、check、函式）把關
// ⚠ service_role key 絕對不能放在這裡或 repo 的任何地方
//
// 依網址決定連哪裡；null = 這個環境沒有社群功能（☰ 選單不顯示，App 其他功能照常）

// 本機開發（npx supabase@2.120.0 start）：CLI 內建的公開示範金鑰，每台電腦都一樣
const LOCAL = {
  url: 'http://127.0.0.1:54321',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
};

// 正式專案（Tokyo）：publishable key 和 anon key 一樣是公開的（步驟見 docs/supabase-setup.md）
// ⚠ 改網址時，index.html 的 CSP（connect-src、img-src）要一起改
const PRODUCTION = {
  url: 'https://rygsjrzddhhhdqpoayoa.supabase.co',
  anonKey: 'sb_publishable_jJfi96HHgNORDl1-IYFsLg_adfwn9ma',
};

function pick() {
  const { hostname } = location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return LOCAL;
  if (hostname === 'andywu1122.github.io') return PRODUCTION;
  return null; // 區網 http 測試等：不是 secure context，也不開放社群功能
}

export const SUPABASE = pick();
