import { loadDirectory, storeDirectory, saveMedia } from './files.js';
const C = GetterCore;
const $ = id => document.getElementById(id);
let directory, sourceTabId, capture, running = false, activeController, ready = false, stopped = false, history = [], queueLength = 0;

function banner(text = '') { $('banner').textContent = text; $('banner').hidden = !text; }
function jobTitle(job) {
  const target = job.context.username ? `@${job.context.username}` : job.context.shortcode || 'Highlight';
  const label = C.actionsFor(job.context).find(([a]) => a === job.action)?.[1] || 'Download';
  return `${target} · ${label}`;
}
function renderHistory() {
  $('activity').replaceChildren();
  $('empty-state').hidden = running || history.length > 0;
  $('activity-count').textContent = history.length;
  for (const record of history.slice(0, 20)) {
    const row = document.createElement('div'); row.className = `activity-row ${record.state || ''}`;
    const icon = document.createElement('div'); icon.className = 'row-icon'; icon.textContent = record.state === 'error' ? '×' : record.state === 'warning' ? '!' : '✓';
    const copy = document.createElement('div'); copy.className = 'row-copy';
    const title = document.createElement('strong'); title.textContent = record.title;
    const detail = document.createElement('p'); detail.textContent = record.detail;
    copy.append(title, detail);
    if (record.warnings?.length) {
      const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = 'View issues';
      const list = document.createElement('ul');
      for (const text of record.warnings) { const li = document.createElement('li'); li.textContent = text; list.append(li); }
      details.append(summary, list); copy.append(details);
    }
    const time = document.createElement('span'); time.className = 'row-time'; time.textContent = new Date(record.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    row.append(icon, copy, time); $('activity').append(row);
  }
}
async function refreshSource() {
  const data = await chrome.storage.session.get('sourceTabId'); sourceTabId = data.sourceTabId;
  capture = null;
  if (sourceTabId != null) {
    try { capture = await chrome.tabs.sendMessage(sourceTabId, { type: 'CAPTURE' }); } catch { /* Show a helpful disconnected state. */ }
  }
  const ctx = capture?.context;
  const available = ctx && C.actionsFor(ctx).length > 0;
  $('source-state').textContent = available ? 'CONNECTED' : 'CONNECT INSTAGRAM';
  $('source-state').classList.toggle('connected', Boolean(available));
  $('source-title').textContent = available ? ctx.username ? `@${ctx.username}` : ctx.type === 'post' ? 'Your open post' : 'Your open highlight' : 'Open a profile, post or story';
  $('source-detail').textContent = available ? ctx.type === 'profile' ? 'Photos, videos and every slide. Organized automatically.' : 'Save the item you opened, straight to your folder.' : 'Click Getter in the Chrome toolbar on Instagram. Refresh Instagram after installing.';
  $('source-actions').replaceChildren();
  for (const [action, label] of C.actionsFor(ctx || {})) {
    const button = document.createElement('button'); button.textContent = label;
    button.onclick = async () => {
      button.disabled = true;
      try {
        // Capture again at the actual click, because stories and SPA routes change.
        const latest = await chrome.tabs.sendMessage(sourceTabId, { type: 'CAPTURE' });
        if (!C.actionsFor(latest.context).some(([a]) => a === action)) throw new Error('Instagram changed pages. Refresh the connected page here.');
        const result = await chrome.runtime.sendMessage({ type: 'QUEUE_JOB', action, sourceTabId, ...latest });
        if (!result.ok) throw new Error(result.error);
        stopped = false; await pump();
      } catch (e) { banner(e.message); }
      finally { button.disabled = false; }
    };
    $('source-actions').append(button);
  }
}
async function folderState() {
  ready = directory && await directory.queryPermission({ mode: 'readwrite' }) === 'granted';
  $('folder-name').textContent = directory?.name || 'A home for your downloads';
  $('folder-detail').textContent = ready ? 'Files are organized by profile, then posts, stories and highlights.' : directory ? 'Allow access to continue saving to this folder.' : 'Choose a folder on your Desktop, or anywhere you like.';
  $('choose-folder').textContent = directory ? 'Change folder ↗' : 'Choose folder ↗';
  $('grant-folder').hidden = !directory || ready;
  await chrome.storage.local.set({ folderConfigured: Boolean(ready) });
}
$('choose-folder').onclick = async () => {
  try {
    const selected = await showDirectoryPicker({ id: 'getter-downloads', mode: 'readwrite', startIn: directory || 'desktop' });
    await storeDirectory(selected); directory = selected;
    await folderState(); banner(); stopped = false; await pump();
  } catch (e) { if (e.name !== 'AbortError') banner(`Could not select that folder: ${e.message}`); }
};
$('grant-folder').onclick = async () => {
  try { await directory.requestPermission({ mode: 'readwrite' }); await folderState(); stopped = false; await pump(); }
  catch (e) { banner(e.message); }
};
$('refresh-source').onclick = () => refreshSource().catch(e => banner(e.message));
$('stop').onclick = async () => {
  stopped = true;
  activeController?.abort();
  await chrome.runtime.sendMessage({ type: 'CLEAR_QUEUE' });
  banner('Downloads stopped. Files already saved are kept. Click a download button to try again; existing files are skipped.');
  $('stop').hidden = true;
};
function counts(stats) {
  $('saved-count').textContent = stats.saved; $('skipped-count').textContent = stats.skipped; $('failed-count').textContent = stats.failed;
}
async function consume(job, stats, signal) {
  const transport = new AbortController();
  signal = AbortSignal.any([signal, transport.signal]);
  const seen = new Set();
  const port = chrome.tabs.connect(job.sourceTabId, { name: 'getter-collect' });
  return new Promise((resolve, reject) => {
    let settled = false, timer, processing = Promise.resolve();
    function finish(error) {
      if (settled) return;
      settled = true; clearTimeout(timer); signal.removeEventListener('abort', cancel);
      if (error) transport.abort(error);
      port.disconnect();
      // Wait for any in-flight disk write to abort before allowing a new job.
      const complete = () => error ? reject(error) : resolve();
      processing.then(complete, complete);
    }
    function watchdog() { clearTimeout(timer); timer = setTimeout(() => finish(new Error('Instagram stopped responding. Keep its tab open, refresh it, and try again.')), 65000); }
    function cancel() { finish(signal.reason || new DOMException('Stopped', 'AbortError')); }
    signal.addEventListener('abort', cancel, { once: true });
    port.onDisconnect.addListener(() => { const error = chrome.runtime.lastError; if (!settled) finish(new Error(error?.message || 'The Instagram tab was closed or refreshed. Saved files are kept.')); });
    port.onMessage.addListener(message => {
      if (settled) return;
      clearTimeout(timer);
      if (message.type === 'DONE') { finish(); return; }
      if (message.type === 'ERROR') { finish(new Error(message.error)); return; }
      if (message.type !== 'BATCH') { watchdog(); return; }
      processing = (async () => {
        signal.throwIfAborted();
        if (message.warning) stats.warnings.push(message.warning);
        stats.warnings.push(...(message.warnings || []));
        stats.failed += message.warnings?.length || 0;
        $('active-state').textContent = message.label || 'Collecting';
        for (const item of message.items || []) {
          signal.throwIfAborted();
          const key = `${item.category}/${item.collection}/${item.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          try {
            $('active-detail').textContent = `Saving ${item.type} ${item.id}…`;
            let lastPaint = 0;
            const result = await saveMedia(directory, item, { signal, onProgress(bytes) {
              if (Date.now() - lastPaint < 250) return;
              lastPaint = Date.now();
              $('active-detail').textContent = `Saving ${item.type} ${item.id} · ${(bytes / 1048576).toFixed(1)} MB`;
            }});
            stats[result.skipped ? 'skipped' : 'saved']++;
            stats.bytes += result.skipped ? 0 : result.bytes;
            stats.consecutiveFailures = 0;
            $('active-detail').textContent = `${result.skipped ? 'Already saved' : 'Saved'} · ${result.path}`;
          } catch (e) {
            if (signal.aborted) throw e;
            stats.failed++; stats.consecutiveFailures++;
            stats.warnings.push(`${item.id}: ${e.message}`);
            if (e.name === 'NotAllowedError' || e.name === 'QuotaExceededError' || stats.consecutiveFailures >= 3) throw new Error(`Download stopped: ${e.message}`);
          }
          counts(stats);
        }
        counts(stats);
        if (!settled) { port.postMessage({ type: 'ACK' }); watchdog(); }
      })();
      processing.catch(error => finish(error));
    });
    if (signal.aborted) { cancel(); return; }
    port.postMessage({ type: 'START', job }); watchdog();
  });
}
async function pump() {
  const { jobs = [] } = await chrome.storage.session.get('jobs');
  queueLength = jobs.length;
  $('queue-badge').textContent = queueLength;
  $('queue-count').textContent = `${Math.max(0, queueLength - (running ? 1 : 0))} queued`;
  $('stop').hidden = !queueLength && !running;
  if (running || !jobs.length || stopped) return;
  if (!ready) { banner(`${jobs.length} download${jobs.length === 1 ? '' : 's'} waiting. ${directory ? 'Allow folder access' : 'Choose a folder'} to begin.`); return; }
  // Claim synchronously before the next await; storage notifications can call pump again.
  running = true;
  const job = jobs[0];
  activeController = new AbortController();
  const stats = { saved: 0, skipped: 0, failed: 0, bytes: 0, consecutiveFailures: 0, warnings: [] };
  let error;
  $('active-card').hidden = false; $('empty-state').hidden = true; $('choose-folder').disabled = true;
  $('active-title').textContent = jobTitle(job); $('active-state').textContent = 'Collecting'; $('active-detail').textContent = 'Connecting to Instagram…'; counts(stats); banner();
  try {
    await consume(job, stats, activeController.signal);
  } catch (e) { error = e; if (!activeController.signal.aborted) banner(e.message); }
  const aborted = activeController.signal.aborted;
  const incomplete = Boolean(error || stats.failed || stats.warnings.length);
  const prefix = aborted ? 'Stopped' : incomplete ? 'Incomplete' : stats.saved + stats.skipped === 0 ? 'No available media' : 'Complete';
  const warnings = [...(error && !aborted ? [error.message] : []), ...stats.warnings].slice(0, 100);
  history.unshift({ title: jobTitle(job), detail: `${prefix} · ${stats.saved} saved · ${stats.skipped} skipped · ${stats.failed} failed${stats.bytes ? ` · ${(stats.bytes / 1048576).toFixed(1)} MB` : ''}`, warnings, time: Date.now(), state: incomplete || aborted ? (stats.saved || stats.skipped ? 'warning' : 'error') : '' });
  history = history.slice(0, 20);
  try {
    await chrome.storage.local.set({ history });
    const result = await chrome.runtime.sendMessage({ type: 'FINISH_JOB', id: job.id });
    if (!result.ok) throw new Error(result.error);
  } catch (e) { stopped = true; banner(`Queue could not be updated: ${e.message}`); }
  if (error && !aborted) {
    // Do not plow through pending jobs after an account check or transport failure.
    stopped = true;
    await chrome.runtime.sendMessage({ type: 'CLEAR_QUEUE' });
  }
  running = false; activeController = null; $('active-card').hidden = true; $('choose-folder').disabled = false; renderHistory();
  await folderState();
  await pump();
}

async function start() {
  const stored = await chrome.storage.local.get('history'); history = stored.history || []; renderHistory();
  try { directory = await loadDirectory(); await folderState(); } catch (e) { banner(`Choose your folder again: ${e.message}`); }
  await refreshSource();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'session') return;
    if (changes.sourceTabId) refreshSource().catch(e => banner(e.message));
    if (changes.jobs) {
      if ((changes.jobs.newValue?.length || 0) > (changes.jobs.oldValue?.length || 0)) stopped = false;
      pump().catch(e => banner(e.message));
    }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshSource().catch(() => {}); });
  window.addEventListener('beforeunload', event => { if (running) { event.preventDefault(); event.returnValue = ''; } });
  await pump();
}
// A user can duplicate an extension tab. Only one manager may write to disk.
navigator.locks.request('getter-download-manager', { ifAvailable: true }, async lock => {
  if (!lock) {
    banner('Getter is already open in another tab. Use that tab for downloads.');
    for (const button of document.querySelectorAll('button')) button.disabled = true;
    return;
  }
  await start();
  await new Promise(() => {});
}).catch(e => banner(e.message));
