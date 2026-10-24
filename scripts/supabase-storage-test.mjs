// 從 Storage API 測照片與頭像權限（docs/social-spec.md 階段 2、3）：用真的 JWT 上傳、下載、建立 signed URL
// pgTAP（supabase/tests/04、05）測 RLS 本身；這裡確認 bucket 的大小／格式限制與 HTTP 端點同樣擋得住
//
// 用法：先 npx supabase@2.120.0 start，再 node scripts/supabase-storage-test.mjs

import {
  api, call, rest, check, failures, summary, setupUsers, cleanup,
  BUCKET, AVATARS, photoPath, avatarPath, insertBrew, uploadPhoto, downloadPhoto, signPhoto, photoExists,
} from './supabase-local.mjs';

// 最小的合法 JPEG（1×1）；Storage 不檢查內容，這裡只需要一個像樣的檔案
const TINY_JPEG = Uint8Array.from(Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64',
));
const ok = (r) => r.status >= 200 && r.status < 300;
const status = (r) => `HTTP ${r.status} ${r.json?.error ?? r.json?.message ?? ''}`.trim();

try {
  const { A, B, C, D } = await setupUsers(['A', 'B', 'C', 'D'], [['A', 'B']]);

  /* ----- A 上傳：只能傳到自己紀錄指定的路徑 ----- */
  const a1 = await insertBrew(A);
  const a1Path = photoPath(A.id, a1);
  const up = await uploadPhoto(A.token, a1Path, TINY_JPEG);
  check('A 上傳自己紀錄的照片', ok(up), status(up));

  const noPhoto = await insertBrew(A, { withPhoto: false });
  check('紀錄沒指定照片時不能上傳', !ok(await uploadPhoto(A.token, photoPath(A.id, noPhoto), TINY_JPEG)));
  check('沒有對應紀錄時不能上傳', !ok(await uploadPhoto(A.token, photoPath(A.id, crypto.randomUUID()), TINY_JPEG)));
  const b1 = await insertBrew(B);
  const b1Path = photoPath(B.id, b1);
  check('A 不能上傳到 B 的資料夾', !ok(await uploadPhoto(A.token, b1Path, TINY_JPEG)));
  check('A 不能傳到子資料夾', !ok(await uploadPhoto(A.token, `${A.id}/x/${a1}.jpg`, TINY_JPEG)));

  /* ----- bucket 限制：1MB、只收 image/jpeg ----- */
  const big = await insertBrew(A);
  const tooBig = new Uint8Array(1024 * 1024 + 1);
  tooBig.set(TINY_JPEG);
  const bigRes = await uploadPhoto(A.token, photoPath(A.id, big), tooBig);
  check('超過 1MB 被拒絕', !ok(bigRes), status(bigRes));
  const exact = new Uint8Array(1024 * 1024);
  exact.set(TINY_JPEG);
  const exactRes = await uploadPhoto(A.token, photoPath(A.id, big), exact);
  check('剛好 1MB 可以上傳', ok(exactRes), status(exactRes));
  const png = await insertBrew(A);
  const pngRes = await uploadPhoto(A.token, photoPath(A.id, png), TINY_JPEG, { contentType: 'image/png' });
  check('Content-Type 不是 image/jpeg 被拒絕', !ok(pngRes), status(pngRes));
  const html = await insertBrew(A);
  check('Content-Type text/html 被拒絕',
    !ok(await uploadPhoto(A.token, photoPath(A.id, html), new TextEncoder().encode('<script>alert(1)</script>'), { contentType: 'text/html' })));

  /* ----- 未登入 ----- */
  check('未登入：不能下載', !ok(await call(`/storage/v1/object/authenticated/${BUCKET}/${a1Path}`)));
  check('未登入：沒有公開網址（bucket 是私有的）', !ok(await call(`/storage/v1/object/public/${BUCKET}/${a1Path}`)));
  check('未登入：不能建立 signed URL', !(await signPhoto(undefined, a1Path)).url);
  check('未登入：不能上傳', !ok(await uploadPhoto(undefined, a1Path, TINY_JPEG, { upsert: true })));
  const anonList = await call(`/storage/v1/object/list/${BUCKET}`, { method: 'POST', body: { prefix: A.id } });
  check('未登入：列不出檔案', !ok(anonList) || anonList.json?.length === 0, status(anonList));

  /* ----- C（不是好友） ----- */
  check('C 下載不到 A 的照片', !ok(await downloadPhoto(C.token, a1Path)));
  check('C 不能建立 A 照片的 signed URL', !(await signPhoto(C.token, a1Path)).url);
  const cList = await call(`/storage/v1/object/list/${BUCKET}`, { method: 'POST', token: C.token, body: { prefix: A.id } });
  check('C 列不出 A 資料夾裡的檔案', cList.json?.length === 0, status(cList));

  /* ----- B（好友）：讀得到，改不了 ----- */
  const bDown = await downloadPhoto(B.token, a1Path);
  check('B 下載得到 A 的照片，內容一致', ok(bDown) && Buffer.compare(bDown.bytes, TINY_JPEG) === 0, status(bDown));
  const signed = await signPhoto(B.token, a1Path);
  check('B 能建立 A 照片的 signed URL（1 小時）', !!signed.url, status(signed.res));
  const viaUrl = signed.url ? await fetch(signed.url) : null;
  check('用 signed URL 下載得到（不需要登入）', viaUrl?.status === 200, `HTTP ${viaUrl?.status}`);
  check('signed URL 回傳 image/jpeg', viaUrl?.headers.get('content-type') === 'image/jpeg', viaUrl?.headers.get('content-type'));
  const tampered = signed.url ? await fetch(signed.url.replace(a1, b1)) : null;
  check('改過路徑的 signed URL 無效', tampered && tampered.status >= 400, `HTTP ${tampered?.status}`);

  const fake = new TextEncoder().encode('B 偷換的');
  check('B 不能覆蓋 A 的照片', !ok(await uploadPhoto(B.token, a1Path, fake, { upsert: true })));
  const bDel = await call(`/storage/v1/object/${BUCKET}`, { method: 'DELETE', token: B.token, body: { prefixes: [a1Path] } });
  check('B 不能刪除 A 的照片', await photoExists(a1Path), `${status(bDel)} 刪到 ${bDel.json?.length ?? '?'} 個`);
  const bMove = await call('/storage/v1/object/move', {
    method: 'POST', token: B.token, body: { bucketId: BUCKET, sourceKey: a1Path, destinationKey: b1Path },
  });
  check('B 不能搬走 A 的照片', !ok(bMove) && await photoExists(a1Path), status(bMove));
  const still = await downloadPhoto(A.token, a1Path);
  check('A 的照片內容沒被改', Buffer.compare(still.bytes, TINY_JPEG) === 0);

  /* ----- A 覆蓋自己的照片 ----- */
  check('A 能覆蓋自己的照片（upsert）', ok(await uploadPhoto(A.token, a1Path, TINY_JPEG, { upsert: true })));

  /* ----- 照片跟著紀錄走 ----- */
  await rest(`shared_brews?id=eq.${a1}`, { method: 'PATCH', token: A.token, body: { photo_path: null } });
  check('紀錄移除照片後，B 下載不到', !ok(await downloadPhoto(B.token, a1Path)));
  check('紀錄移除照片後，B 不能建立 signed URL', !(await signPhoto(B.token, a1Path)).url);
  await rest(`shared_brews?id=eq.${a1}`, { method: 'PATCH', token: A.token, body: { photo_path: a1Path } });
  check('恢復後 B 又下載得到', ok(await downloadPhoto(B.token, a1Path)));

  /* ----- A 封鎖 B ----- */
  const block = await rest('blocks', { method: 'POST', token: A.token, body: { blocked: B.id } });
  check('A 封鎖 B', block.status === 201, `HTTP ${block.status}`);
  check('封鎖後 B 下載不到 A 的照片', !ok(await downloadPhoto(B.token, a1Path)));
  check('封鎖後 B 不能建立 signed URL', !(await signPhoto(B.token, a1Path)).url);
  // 已知限制：signed URL 發出後 Storage 不再檢查 RLS，封鎖前拿到的網址到期前仍可用（見 docs/social-open-questions.md）
  const old = signed.url ? await fetch(signed.url) : null;
  console.log(`INFO  封鎖前發出的 signed URL：HTTP ${old?.status}（到期前仍有效，屬已知限制）`);

  /* ===== 頭像（階段 3） ===== */
  // D 對 C 送邀請（待處理）：C、D 互相讀得到頭像
  const cCode = (await rest('profiles?select=friend_code', { token: C.token })).json[0].friend_code;
  await call('/rest/v1/rpc/send_friend_request', { method: 'POST', token: D.token, body: { code: cCode } });
  const cAvatar = avatarPath(C.id);
  const av = { bucket: AVATARS };
  const cUp = await uploadPhoto(C.token, cAvatar, TINY_JPEG, av);
  check('C 上傳自己的頭像', ok(cUp), status(cUp));
  await rest(`profiles?id=eq.${C.id}`, { method: 'PATCH', token: C.token, body: { avatar_path: cAvatar } });
  check('C 不能上傳到 D 的頭像路徑', !ok(await uploadPhoto(C.token, avatarPath(D.id), TINY_JPEG, av)));
  check('頭像檔名只能是 avatar.jpg', !ok(await uploadPhoto(C.token, `${C.id}/other.jpg`, TINY_JPEG, av)));
  const bigAvatar = new Uint8Array(100 * 1024 + 1);
  bigAvatar.set(TINY_JPEG);
  const bigAvRes = await uploadPhoto(C.token, cAvatar, bigAvatar, { ...av, upsert: true });
  check('頭像超過 100KB 被拒絕', !ok(bigAvRes), status(bigAvRes));
  const pngAv = await uploadPhoto(C.token, cAvatar, TINY_JPEG, { ...av, upsert: true, contentType: 'image/png' });
  check('頭像 Content-Type 不是 image/jpeg 被拒絕', !ok(pngAv), status(pngAv));
  check('未登入：讀不到頭像', !ok(await call(`/storage/v1/object/authenticated/${AVATARS}/${cAvatar}`)));
  check('未登入：頭像沒有公開網址', !ok(await call(`/storage/v1/object/public/${AVATARS}/${cAvatar}`)));
  check('D（待處理邀請的對方）讀得到 C 的頭像', ok(await downloadPhoto(D.token, cAvatar, AVATARS)));
  check('D 能建立 C 頭像的 signed URL', !!(await signPhoto(D.token, cAvatar, av)).url);
  check('A（沒有關係）讀不到 C 的頭像', !ok(await downloadPhoto(A.token, cAvatar, AVATARS)));
  check('A 不能建立 C 頭像的 signed URL', !(await signPhoto(A.token, cAvatar, av)).url);
  check('D 不能覆蓋 C 的頭像', !ok(await uploadPhoto(D.token, cAvatar, new TextEncoder().encode('x'), { ...av, upsert: true })));
  await call(`/storage/v1/object/${AVATARS}`, { method: 'DELETE', token: D.token, body: { prefixes: [cAvatar] } });
  check('D 不能刪除 C 的頭像', await photoExists(cAvatar, AVATARS));
  const dBlock = await rest('blocks', { method: 'POST', token: C.token, body: { blocked: D.id } });
  check('C 封鎖 D', dBlock.status === 201, `HTTP ${dBlock.status}`);
  check('封鎖後 D 讀不到 C 的頭像', !ok(await downloadPhoto(D.token, cAvatar, AVATARS)));
  const cBlocks = (await rest('blocks?select=blocked,blocked_nickname', { token: C.token })).json;
  check('C 的封鎖名單記下 D 的暱稱', cBlocks?.[0]?.blocked_nickname === 'D', JSON.stringify(cBlocks));
  const cDelAv = await call(`/storage/v1/object/${AVATARS}`, { method: 'DELETE', token: C.token, body: { prefixes: [cAvatar] } });
  check('C 刪除自己的頭像', ok(cDelAv) && !(await photoExists(cAvatar, AVATARS)), status(cDelAv));

  /* ----- A 刪除紀錄後，留下的照片本人還能刪 ----- */
  await rest(`shared_brews?id=eq.${a1}`, { method: 'DELETE', token: A.token });
  const aDel = await call(`/storage/v1/object/${BUCKET}`, { method: 'DELETE', token: A.token, body: { prefixes: [a1Path] } });
  check('紀錄刪除後，A 能刪掉留下的照片', ok(aDel) && !(await photoExists(a1Path)), status(aDel));

  console.log(`\n（API：${api}）`);
} catch (err) {
  failures.push(`執行錯誤：${err.message}`);
  console.error(err);
} finally {
  await cleanup();
}

summary();
