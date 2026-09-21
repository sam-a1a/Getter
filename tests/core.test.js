import test from 'node:test';
import assert from 'node:assert/strict';
import '../extension/core.js';
import '../extension/instagram.js';
const C = globalThis.GetterCore;
const { Instagram, InstagramError } = globalThis.GetterInstagram;
const url = n => `https://scontent.cdninstagram.com/${n}.jpg`;
const photo = (id = '1') => ({ pk: id, media_type: 1, image_versions2: { candidates: [{ url: url(id), width: 1080, height: 1350 }] } });
const client = request => new Instagram({ request, signal: new AbortController().signal, interval: 0 });
async function collect(iterator) { const out = []; for await (const batch of iterator) out.push(batch); return out; }

test('recognizes profiles, reels, individual stories and highlights, excludes non-profile routes', () => {
  for (const [path, type] of [['/alice/', 'profile'], ['/alice/reels/', 'profile'], ['/p/ABC-123/', 'post'], ['/reel/AB_12/', 'post'], ['/stories/alice/123/', 'story'], ['/stories/highlights/456/789/', 'highlight'], ['/direct/inbox/', 'unsupported'], ['/accounts/login/', 'unsupported'], ['/explore/', 'unsupported']])
    assert.equal(C.contextFromUrl(`https://www.instagram.com${path}`).type, type, path);
  assert.equal(C.contextFromUrl('https://evil.com/alice/').type, 'unsupported');
  assert.equal(C.contextFromUrl('https://www.instagram.com/stories/highlights/456/789/').storyId, '789');
});
test('post identifiers keep their full precision', () => {
  assert.equal(C.shortcodeToId('BAAAAAAAAAA'), '1152921504606846976');
  assert.throws(() => C.shortcodeToId('../bad'));
});
test('media URL allowlist rejects redirects, credentials and lookalike hosts', () => {
  assert.ok(C.isMediaUrl(url('ok')));
  for (const value of ['https://fbcdn.net.evil.org/x', 'http://scontent.fbcdn.net/x', 'https://user@fbcdn.net/x', 'https://fbcdn.net:444/x', 'blob:https://www.instagram.com/x', 'https://localhost/x']) assert.equal(C.isMediaUrl(value), false);
});
test('carousel extracts every slide and picks the largest video including audio rather than the poster', () => {
  const item = { pk: '10', user: { username: 'alice' }, taken_at: 1700000000, carousel_media: [photo('11'), { pk: '12', media_type: 2, image_versions2: photo().image_versions2, video_versions: [{ url: 'https://x.fbcdn.net/small.mp4', width: 100, height: 100 }, { url: 'https://x.fbcdn.net/large.mp4', width: 1080, height: 1920 }] }] };
  const result = C.mediaItems(item);
  assert.equal(result.length, 2); assert.equal(result[1].type, 'video'); assert.match(result[1].url, /large.mp4/);
  assert.deepEqual(C.filePath(result[0], 'jpg'), ['alice', 'posts', '2023-11-14_11_1.jpg']);
});
test('never silently substitutes a thumbnail for an unavailable video', () => {
  assert.throws(() => C.mediaItems({ ...photo(), media_type: 2 }), /video/);
});
test('sanitizes directory components and respects actual response formats', () => {
  assert.equal(C.safeSegment('../../something/evil'), '_.._something_evil');
  assert.equal(C.safeSegment('CON'), '_CON');
  assert.equal(C.safeSegment('...'), 'untitled');
  assert.equal(C.extensionFor({ url: url(1), type: 'image' }, 'image/webp'), 'webp');
  assert.throws(() => C.extensionFor({ url: url(1), type: 'image' }, 'text/html'), /page/);
  assert.throws(() => C.extensionFor({ url: url(1), type: 'video' }, 'image/jpeg'), /wrong/);
});
test('follows all pages and detects repeated cursors instead of claiming completion', async () => {
  const cursors = [];
  const api = client(async (path, params) => { cursors.push(params.max_id); return { items: [photo()], more_available: true, next_max_id: 'repeat' }; });
  await assert.rejects(collect(api.feed({ id: '123', username: 'alice' })), /pagination/);
  assert.deepEqual(cursors, [undefined, 'repeat']);
});
test('everything traverses posts, reels, current stories and every highlight', async () => {
  const calls = [];
  const api = client(async (path, params, method) => {
    calls.push([path, params, method]);
    if (path === 'users/web_profile_info/') return { data: { user: { id: '123', username: 'alice' } } };
    if (path === 'feed/user/123/' && !params.max_id) return { items: [photo('1')], more_available: true, next_max_id: 'page2' };
    if (path === 'feed/user/123/') return { items: [photo('2')], more_available: false };
    if (path === 'clips/user/') return { items: [{ media: photo('3') }], paging_info: { more_available: false } };
    if (path === 'feed/user/123/reel_media/') return { items: [photo('4')] };
    if (path === 'highlights/123/highlights_tray/') return { tray: [{ id: 'highlight:5', title: 'Trip' }, { id: 'highlight:6', title: 'Trip' }] };
    if (path === 'feed/reels_media/') return { reels: { [params.reel_ids]: { items: [photo(params.reel_ids)], user: { username: 'alice' } } } };
    throw new Error(path);
  });
  const batches = await collect(api.collect({ action: 'everything', context: { type: 'profile', username: 'alice' } }));
  assert.equal(batches.length, 6); assert.equal(batches.flatMap(b => b.media).length, 6);
  assert.equal(batches[4].info.collection, 'Trip_5'); assert.equal(batches[5].info.collection, 'Trip_6');
  assert.equal(calls.find(c => c[0] === 'clips/user/')[2], 'POST');
});
test('ordinary endpoint failures are reported while rate limits stop immediately', async () => {
  let requests = 0;
  const api = client(async path => {
    requests++;
    if (path === 'users/web_profile_info/') return { data: { user: { id: '1', username: 'alice' } } };
    throw new InstagramError('Rate limited', true, 429);
  });
  await assert.rejects(collect(api.collect({ action: 'everything', context: { type: 'profile', username: 'alice' } })), /Rate limited/);
  assert.equal(requests, 2);
  const other = client(async path => path === 'users/web_profile_info/' ? { data: { user: { id: '1' } } } : Promise.reject(new InstagramError('Changed endpoint')));
  const batches = await collect(other.collect({ action: 'posts', context: { type: 'profile', username: 'alice' } }));
  assert.equal(batches.length, 2); assert.ok(batches.every(b => b.warning));
});
test('downloads exactly the captured story even if the viewing tab has advanced', async () => {
  const api = client(async path => path === 'users/web_profile_info/' ? { data: { user: { id: '123' } } } : { items: [photo('100'), photo('200')] });
  const result = await collect(api.collect({ action: 'current', context: { type: 'story', username: 'alice', storyId: '100' } }));
  assert.deepEqual(result[0].media.map(m => m.pk), ['100']);
});
test('expired current stories fail explicitly instead of reporting an empty successful job', async () => {
  const api = client(async path => path === 'users/web_profile_info/' ? { data: { user: { id: '123' } } } : { reel: null });
  await assert.rejects(collect(api.collect({ action: 'current', context: { type: 'story', username: 'alice', storyId: '100' } })), /expired/);
});
test('cancellation prevents further requests', async () => {
  const controller = new AbortController(); controller.abort(); let called = false;
  const api = new Instagram({ signal: controller.signal, request: () => { called = true; } });
  await assert.rejects(api.user('alice'), { name: 'AbortError' }); assert.equal(called, false);
});
