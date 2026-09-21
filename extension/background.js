importScripts('core.js');
const managerUrl = chrome.runtime.getURL('manager.html');
let serial = Promise.resolve();

async function openManager(active = true) {
  const existing = (await chrome.tabs.query({ url: managerUrl }))[0];
  if (existing) {
    if (active) { await chrome.tabs.update(existing.id, { active: true }); await chrome.windows.update(existing.windowId, { focused: true }); }
    return existing;
  }
  return chrome.tabs.create({ url: managerUrl, active, pinned: true });
}
async function handle(message, sender) {
  const manager = sender.url === managerUrl && !sender.tab?.url?.startsWith('https://');
  const instagram = sender.tab && sender.url?.startsWith('https://www.instagram.com/');
  if (!manager && !instagram) throw new Error('Unsupported sender.');
  if (message.type === 'OPEN_MANAGER') {
    if (instagram) await chrome.storage.session.set({ sourceTabId: sender.tab.id });
    await openManager(); return { ok: true };
  }
  if (message.type === 'QUEUE_JOB') {
    const sourceTabId = instagram ? sender.tab.id : message.sourceTabId;
    if (!Number.isInteger(sourceTabId)) throw new Error('Open Instagram first.');
    const source = await chrome.tabs.get(sourceTabId);
    if (!source.url?.startsWith('https://www.instagram.com/')) throw new Error('The source tab is no longer on Instagram.');
    const context = GetterCore.contextFromUrl(message.context?.url);
    if (!GetterCore.actionsFor(context).some(([a]) => a === message.action)) throw new Error('This action is not available here.');
    const { jobs = [] } = await chrome.storage.session.get('jobs');
    if (jobs.length >= 40) throw new Error('The queue is full. Let current downloads finish first.');
    if (jobs.some(j => j.action === message.action && j.context.url === context.url && j.sourceTabId === sourceTabId)) return { ok: true };
    const snapshot = message.snapshot && GetterCore.isMediaUrl(message.snapshot.url) ? message.snapshot : null;
    const job = { id: crypto.randomUUID(), action: message.action, context, snapshot, sourceTabId, created: Date.now() };
    await chrome.storage.session.set({ jobs: [...jobs, job], sourceTabId });
    const { folderConfigured } = await chrome.storage.local.get('folderConfigured');
    await openManager(!folderConfigured);
    return { ok: true, id: job.id };
  }
  if (message.type === 'FINISH_JOB' && manager) {
    const { jobs = [] } = await chrome.storage.session.get('jobs');
    await chrome.storage.session.set({ jobs: jobs.filter(j => j.id !== message.id) });
    return { ok: true };
  }
  if (message.type === 'CLEAR_QUEUE' && manager) {
    await chrome.storage.session.set({ jobs: [] }); return { ok: true };
  }
  throw new Error('Unknown request.');
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!['OPEN_MANAGER', 'QUEUE_JOB', 'FINISH_JOB', 'CLEAR_QUEUE'].includes(message.type)) return;
  serial = serial.catch(() => {}).then(() => handle(message, sender));
  serial.then(respond, error => respond({ ok: false, error: error.message }));
  return true;
});
chrome.action.onClicked.addListener(tab => {
  serial = serial.catch(() => {}).then(async () => {
    if (tab.url?.startsWith('https://www.instagram.com/')) await chrome.storage.session.set({ sourceTabId: tab.id });
    await openManager();
  });
});
