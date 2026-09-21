import test from 'node:test';
import assert from 'node:assert/strict';
import '../extension/core.js';
import { saveMedia } from '../extension/files.js';

function directory(name = '') {
  const files = new Map(), dirs = new Map();
  return { name, files, dirs,
    async getDirectoryHandle(name) { if (!dirs.has(name)) dirs.set(name, directory(name)); return dirs.get(name); },
    async getFileHandle(name, options) {
      if (!files.has(name)) {
        if (!options?.create) throw new DOMException('Missing', 'NotFoundError');
        const file = { bytes: new Uint8Array(), async getFile() { return { size: this.bytes.length }; }, async createWritable() {
          const chunks = [];
          return new WritableStream({ write(chunk) { chunks.push(...chunk); }, close() { file.bytes = new Uint8Array(chunks); } });
        }};
        files.set(name, file);
      }
      return files.get(name);
    },
    async removeEntry(name) { files.delete(name); }
  };
}
const item = { id: '123', username: 'alice', category: 'posts', type: 'image', url: 'https://test.cdninstagram.com/photo.jpg' };
const response = (contentType = 'image/jpeg', data = 'actual-image-bytes') => new Response(data, { headers: { 'content-type': contentType } });
test('streams media to the selected directory and skips existing files without overwriting', async () => {
  const root = directory();
  const first = await saveMedia(root, item, { fetcher: async () => response() });
  assert.equal(first.path, 'alice/posts/123.jpg'); assert.equal(first.skipped, false);
  const second = await saveMedia(root, item, { fetcher: async () => response('image/jpeg', 'replacement') });
  assert.equal(second.skipped, true);
  assert.equal(new TextDecoder().decode(root.dirs.get('alice').dirs.get('posts').files.get('123.jpg').bytes), 'actual-image-bytes');
});
test('rejects login pages and off-site URLs before writing a file', async () => {
  const root = directory();
  await assert.rejects(saveMedia(root, item, { fetcher: async () => response('text/html') }), /page/);
  await assert.rejects(saveMedia(root, { ...item, url: 'https://evil.org/x' }, { fetcher: () => { throw new Error('Must not request'); } }), /Untrusted/);
  assert.equal(root.dirs.size, 0);
});
test('cleans up new incomplete files on a failed transfer', async () => {
  const root = directory();
  const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2, 3])); c.error(new Error('Connection lost')); } });
  await assert.rejects(saveMedia(root, item, { fetcher: async () => new Response(stream, { headers: { 'content-type': 'image/jpeg' } }) }), /Connection lost/);
  assert.equal(root.dirs.get('alice').dirs.get('posts').files.size, 0);
});
test('rejects empty and truncated responses instead of counting them as saved', async () => {
  for (const data of ['', 'short']) {
    const root = directory();
    await assert.rejects(saveMedia(root, item, { fetcher: async () => new Response(data, { headers: { 'content-type': 'image/jpeg', 'content-length': '100' } }) }), /incomplete/);
    assert.equal(root.dirs.get('alice').dirs.get('posts').files.size, 0);
  }
});
test('cancel aborts pending writes and preserves only completed files', async () => {
  const root = directory(), controller = new AbortController();
  const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2, 3])); } });
  await assert.rejects(saveMedia(root, item, { signal: controller.signal, fetcher: async () => new Response(stream, { headers: { 'content-type': 'image/jpeg' } }), onProgress() { controller.abort(); } }), { name: 'AbortError' });
  assert.equal(root.dirs.get('alice').dirs.get('posts').files.size, 0);
});
