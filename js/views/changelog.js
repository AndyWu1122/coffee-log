// #/changelog 更新內容（從 ☰ 選單、選單最下面的版本號、「已更新」的提示進入）
// 靜態內容（js/changelog.js），離線也能看；打開就算看過了，☰ 的「!」跟著消失
import { CHANGELOG, getChangelogStatus, markChangelogSeen, isNewerThan } from '../models.js';
import { esc, setTitle, appVersion, notifyBadgesChanged } from './ui.js';

export async function render(container) {
  setTitle('更新內容');
  const version = await appVersion();
  // 先記下上次看到哪一版，比它新的標「新」；之後才記成看過了
  const { seen } = await getChangelogStatus(version);
  if (version) {
    await markChangelogSeen(version);
    notifyBadgesChanged();
  }

  container.innerHTML = `
    <article class="changelog">
      ${version ? `<p class="hint">目前的版本：${esc(version)}</p>` : ''}
      ${CHANGELOG.map((entry) => {
        // 沒記過看到哪一版（已經在用的人第一次看到這頁）：只有目前這一版算新
        const isNew = version && (seen ? isNewerThan(entry.version, seen) && !isNewerThan(entry.version, version)
          : entry.version === version);
        return `
        <section class="section" data-version="${esc(entry.version)}">
          <h2>${esc(entry.version)}${isNew ? ' <span class="changelog-new">新</span>' : ''}</h2>
          <ul class="plain-list">${entry.items.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>
        </section>`;
      }).join('')}
    </article>`;
}
