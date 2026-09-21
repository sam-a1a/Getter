import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const extension = path.resolve('extension');
const profile = await mkdtemp(path.join(tmpdir(), 'getter-browser-'));
await mkdir('artifacts', { recursive: true });
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: true,
  ...(process.env.GETTER_CHROMIUM_PATH ? { executablePath: process.env.GETTER_CHROMIUM_PATH } : {}),
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  viewport: { width: 1360, height: 980 }
});
const failures = [];
let mode = 'normal', postPages = 0;
const mediaUrl = id => `https://test.cdninstagram.com/${id}.jpg`;
const photo = id => ({ pk: id, media_type: 1, user: { username: 'studio.june' }, taken_at: 1700000000, image_versions2: { candidates: [{ url: mediaUrl(id), width: 1080, height: 1350 }] } });
const video = id => ({ pk: id, media_type: 2, user: { username: 'studio.june' }, taken_at: 1700000000, video_versions: [{ url: `https://test.cdninstagram.com/${id}.mp4`, width: 1080, height: 1920 }] });
context.on('page', page => page.on('pageerror', error => failures.push(error.message)));
await context.route('https://test.cdninstagram.com/**', route => route.fulfill({ status: 200, contentType: route.request().url().endsWith('.mp4') ? 'video/mp4' : 'image/jpeg', body: 'fixture-media-content' }));
await context.route('https://www.instagram.com/**', async route => {
  const request = route.request(), url = new URL(request.url());
  if (!url.pathname.startsWith('/api/')) {
    await route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><title>Instagram fixture</title></head><body style="font-family:system-ui;background:#fafafa;padding:100px"><main><h1>studio.june</h1><p>Instagram fixture · all network traffic is mocked.</p></main></body></html>' }); return;
  }
  if (mode === 'limited') { await route.fulfill({ status: 429, json: { status: 'fail' } }); return; }
  if (mode === 'slow') { await new Promise(r => setTimeout(r, 4000)); }
  let data;
  const p = url.pathname.replace('/api/v1/', '');
  if (p === 'users/web_profile_info/') data = { data: { user: { id: '123', username: 'studio.june' } } };
  else if (p === 'feed/user/123/') {
    postPages++;
    data = url.searchParams.has('max_id') ? { items: [photo('103')], more_available: false } : { items: [{ pk: '100', user: { username: 'studio.june' }, taken_at: 1700000000, carousel_media: [photo('101'), video('102')] }], more_available: true, next_max_id: 'second' };
  } else if (p === 'clips/user/') data = { items: [{ media: video('102') }, { media: video('104') }], paging_info: { more_available: false } };
  else if (p === 'feed/user/123/reel_media/') data = { items: [photo('201'), video('202')] };
  else if (p === 'highlights/123/highlights_tray/') data = { tray: [{ id: 'highlight:999', title: 'Summer' }] };
  else if (p === 'feed/reels_media/') data = { reels: { 'highlight:999': { user: { username: 'studio.june' }, title: 'Summer', items: [photo('301'), video('302')] } } };
  else if (/media\/\d+\/info\//.test(p)) data = { items: [{ pk: '400', user: { username: 'studio.june' }, carousel_media: [photo('401'), video('402')] }] };
  else { await route.fulfill({ status: 404, json: { status: 'fail' } }); return; }
  await route.fulfill({ status: 200, json: { status: 'ok', ...data } });
});
async function waitFor(predicate, message, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await predicate()) return; await new Promise(r => setTimeout(r, 100)); }
  throw new Error(`Timed out: ${message}`);
}
try {
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const instagram = await context.newPage();
  await instagram.goto('https://www.instagram.com/studio.june/');
  await instagram.locator('#getter-extension').waitFor();
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://www.instagram.com/*' }))[0].id);
  await worker.evaluate(async sourceTabId => chrome.storage.session.set({ sourceTabId }), tabId);
  const manager = await context.newPage();
  await manager.goto(`chrome-extension://${id}/manager.html`);
  await manager.getByRole('button', { name: 'Download everything', exact: true }).waitFor();
  await manager.screenshot({ path: 'artifacts/manager-empty.png', fullPage: true });
  await instagram.screenshot({ path: 'artifacts/instagram-controls.png', fullPage: true });
  // Use a real Chrome file handle, scoped to this disposable profile; never touch user folders.
  await manager.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const folder = await root.getDirectoryHandle('Getter test downloads', { create: true });
    window.showDirectoryPicker = async () => folder;
  });
  await manager.getByRole('button', { name: 'Choose folder' }).click();
  await waitFor(() => manager.locator('#folder-name').textContent().then(t => t === 'Getter test downloads'), 'folder selection');
  async function historyCount() { return manager.evaluate(async () => (await chrome.storage.local.get('history')).history?.length || 0); }
  async function job(action) {
    const before = await historyCount();
    await manager.getByRole('button', { name: action, exact: true }).click();
    await waitFor(async () => await historyCount() > before, action, 45000);
    return manager.evaluate(async () => (await chrome.storage.local.get('history')).history[0]);
  }
  const first = await job('Download everything');
  assert.match(first.detail, /Complete · 8 saved · 0 skipped · 0 failed/);
  assert.equal(postPages, 2);
  const saved = await manager.evaluate(async () => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('Getter test downloads');
    const files = [];
    async function walk(dir, prefix = '') { for await (const [name, handle] of dir) { if (handle.kind === 'directory') await walk(handle, `${prefix}${name}/`); else files.push({ path: `${prefix}${name}`, size: (await handle.getFile()).size }); } }
    await walk(root); return files;
  });
  assert.equal(saved.length, 8); assert.ok(saved.every(f => f.size === 21));
  assert.ok(saved.some(f => /highlights\/Summer_999\//.test(f.path)));
  await manager.screenshot({ path: 'artifacts/manager-complete.png', fullPage: true });
  const repeated = await job('Download everything');
  assert.match(repeated.detail, /Complete · 0 saved · 8 skipped · 0 failed/);

  await instagram.goto('https://www.instagram.com/stories/studio.june/202/');
  await instagram.locator('#getter-extension').waitFor();
  await manager.getByRole('button', { name: 'Refresh ↻' }).click();
  const story = await job('Download this story');
  assert.match(story.detail, /Complete · 0 saved · 1 skipped/);

  await instagram.goto('https://www.instagram.com/p/ABC/');
  await instagram.locator('#getter-extension').waitFor();
  await manager.getByRole('button', { name: 'Refresh ↻' }).click();
  const post = await job('Download post');
  assert.match(post.detail, /Complete · 2 saved/);

  mode = 'limited';
  const limited = await job('Download post');
  assert.equal(limited.state, 'error'); assert.match(limited.warnings.join(' '), /rate-limiting/);
  assert.match(limited.detail, /Incomplete/);

  mode = 'slow';
  const beforeStop = await historyCount();
  await manager.getByRole('button', { name: 'Download post', exact: true }).click();
  await manager.locator('#active-card').waitFor({ state: 'visible' });
  await manager.getByRole('button', { name: 'Stop & clear queue' }).click();
  await waitFor(async () => await historyCount() > beforeStop, 'cancellation');
  const stopped = await manager.evaluate(async () => (await chrome.storage.local.get('history')).history[0]);
  assert.match(stopped.detail, /Stopped/);
  assert.equal(await manager.evaluate(async () => (await chrome.storage.session.get('jobs')).jobs.length), 0);

  const duplicate = await context.newPage(); await duplicate.goto(manager.url());
  await waitFor(() => duplicate.locator('#banner').textContent().then(t => t.includes('already open')), 'single-manager lock');
  await duplicate.close();
  assert.deepEqual(failures, []);
  console.log('PASS: real extension load; content controls; folder handle; 8-file paginated collection; deduplication; current story; carousel; rate limit; stop; single-manager lock.');
  console.log('Screenshots: artifacts/manager-empty.png, artifacts/manager-complete.png, artifacts/instagram-controls.png');
} finally { await context.close(); }
