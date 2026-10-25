// 是不是本機的 Supabase（npx supabase start）：本機改用 repo 裡公開的測試金鑰、送到假伺服器
// 只認得已知的本機網址（edge runtime 裡是 http://kong:8000）；其他網址一律當正式環境，金鑰只從 secrets 讀
// （不能反過來用「不是 *.supabase.co 就是本機」：網址格式一變，正式環境就會改用公開的測試金鑰）
const LOCAL_HOSTS = new Set(['kong', 'localhost', '127.0.0.1', 'host.docker.internal']);

export function isLocalSupabase(supabaseUrl: string | undefined): boolean {
  try {
    const url = new URL(supabaseUrl ?? '');
    return url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}
