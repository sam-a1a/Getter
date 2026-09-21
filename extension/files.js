export async function loadDirectory() {
  return dbOperation('readonly', store => store.get('directory'));
}
export async function storeDirectory(handle) {
  return dbOperation('readwrite', store => store.put(handle, 'directory'));
}
function dbOperation(mode, operation) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('getter-folders', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('settings');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction('settings', mode);
      const request = operation(transaction.objectStore('settings'));
      transaction.oncomplete = () => { db.close(); resolve(request.result); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
      transaction.onabort = () => { db.close(); reject(transaction.error); };
    };
  });
}

export async function saveMedia(root, item, { signal, fetcher = fetch, onProgress = () => {} } = {}) {
  const C = globalThis.GetterCore;
  if (!C.isMediaUrl(item.url) || !['video', 'image'].includes(item.type)) throw new Error('Untrusted media URL or type.');
  signal?.throwIfAborted();
  const timeout = AbortSignal.timeout(120000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetcher(item.url, { credentials: 'omit', redirect: 'error', signal: combined });
  if (!response.ok) throw new Error(`Media download failed (HTTP ${response.status}). Reopen the item and try again.`);
  const ext = C.extensionFor(item, response.headers.get('content-type'));
  const path = C.filePath(item, ext);
  let directory = root;
  for (const name of path.slice(0, -1)) {
    combined.throwIfAborted();
    directory = await directory.getDirectoryHandle(name, { create: true });
  }
  const name = path.at(-1);
  let handle, created = false;
  try {
    handle = await directory.getFileHandle(name);
    const file = await handle.getFile();
    if (file.size > 0) { await response.body?.cancel(); return { skipped: true, path: path.join('/'), bytes: file.size }; }
  } catch (e) { if (e.name !== 'NotFoundError') throw e; }
  if (!handle) { handle = await directory.getFileHandle(name, { create: true }); created = true; }
  let writable, bytes = 0;
  try {
    combined.throwIfAborted();
    if (!response.body) throw new Error('The media response was empty.');
    writable = await handle.createWritable();
    const counter = new TransformStream({ transform(chunk, controller) {
      bytes += chunk.byteLength; onProgress(bytes); controller.enqueue(chunk);
    }});
    // Keep the final close explicit: an empty/truncated transfer must never count as saved.
    await response.body.pipeThrough(counter).pipeTo(writable, { signal: combined, preventClose: true });
    const length = Number(response.headers.get('content-length'));
    if (!bytes || (length > 0 && !response.headers.get('content-encoding') && bytes !== length)) throw new Error('The downloaded file was incomplete. Try again.');
    combined.throwIfAborted();
    await writable.close();
    return { skipped: false, path: path.join('/'), bytes };
  } catch (e) {
    try { await writable?.abort(); } catch { /* pipeTo may already have aborted. */ }
    if (created) { try { await directory.removeEntry(name); } catch { /* Keep the original transfer error. */ } }
    throw e;
  }
}
