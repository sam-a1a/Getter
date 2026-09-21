import * as C from './core.js';
import { Instagram, InstagramError } from './instagram.js';
import { asError } from './errors.js';
import { sendRuntime } from './messaging.js';
import type { ApiParams, Capture, CollectorCommand, CollectorReply, ContentRequest, DownloadBatch, DownloadItem, InstagramResponse, PageContext, RequestMethod } from './types.js';

declare global { var __getterLoaded: boolean | undefined; }

(() => {
  if (globalThis.__getterLoaded) return;
  globalThis.__getterLoaded = true;
  let latestContext: PageContext, renderKey = '', toastTimer: ReturnType<typeof setTimeout> | undefined;

  function visibleSnapshot(context: PageContext): DownloadItem | null {
    if (!['story', 'highlight'].includes(context.type)) return null;
    const candidates = [...document.querySelectorAll<HTMLVideoElement | HTMLImageElement>('video, main img, [role="dialog"] img')].map(el => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (r.width < 180 || r.height < 240 || r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight || style.visibility === 'hidden' || Number(style.opacity) === 0) return null;
      const url = el.currentSrc || el.src;
      if (!C.isMediaUrl(url)) return null;
      // The active story is centered; neighboring story previews are smaller.
      const center = Math.abs(r.left + r.width / 2 - innerWidth / 2);
      return { el, url, score: r.width * r.height / (1 + center / innerWidth) };
    }).filter((item): item is NonNullable<typeof item> => item !== null).sort((a, b) => b.score - a.score);
    const match = candidates[0];
    if (!match) return null;
    let hash = 2166136261;
    for (const char of new URL(match.url).pathname) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return { id: context.storyId || `visible_${(hash >>> 0).toString(16)}`, url: match.url,
      type: match.el.tagName === 'VIDEO' ? 'video' : 'image', username: context.username || 'instagram',
      category: context.type === 'highlight' ? 'highlights' : 'stories', collection: context.highlightId || '' };
  }
  function capture(): Capture {
    const context = C.contextFromUrl(location.href);
    return { context, snapshot: visibleSnapshot(context) };
  }
  async function request(path: string, params: ApiParams, method: RequestMethod, signal: AbortSignal): Promise<InstagramResponse> {
    const url = new URL(`/api/v1/${path}`, location.origin);
    const headers: Record<string, string> = { 'X-IG-App-ID': '936619743392459', 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' };
    const csrf = document.cookie.split('; ').find(c => c.startsWith('csrftoken='))?.slice(10);
    if (csrf) headers['X-CSRFToken'] = csrf;
    const options: RequestInit = { method, credentials: 'include', headers, signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]) };
    if (method === 'GET') url.search = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])).toString();
    else { headers['Content-Type'] = 'application/x-www-form-urlencoded'; options.body = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])).toString(); }
    const response = await fetch(url, options);
    if (response.status === 429) throw new InstagramError('Instagram is rate-limiting downloads. Stop and try again later.', true, 429);
    if ([401, 403].includes(response.status) || /\/accounts\/login|\/challenge\//.test(response.url))
      throw new InstagramError('Instagram requires login or an account check. Open Instagram to resolve it before retrying.', true, response.status);
    if (!response.ok) throw new InstagramError(`Instagram request failed (HTTP ${response.status}).`, false, response.status);
    let data: InstagramResponse;
    try { data = await response.json() as InstagramResponse; } catch { throw new InstagramError('Instagram returned a page instead of data. Check your login and try again.', true); }
    if (data.status === 'fail' || data.message === 'login_required' || data.challenge) {
      const fatal = /login|challenge|feedback|wait|limit|checkpoint/i.test(data.message || '') || Boolean(data.challenge);
      throw new InstagramError(fatal ? 'Instagram paused access. Check your account in Instagram and try again later.' : 'Instagram could not complete this request.', fatal);
    }
    return data;
  }

  chrome.runtime.onMessage.addListener((message: ContentRequest, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.type === 'CAPTURE') { respond(capture()); return; }
    if (message.type === 'NOTICE') toast(message.text);
  });
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== 'getter-collect' || port.sender?.id !== chrome.runtime.id) return;
    const controller = new AbortController();
    let started = false, ack: { resolve: () => void; reject: (reason: unknown) => void } | null;
    port.onDisconnect.addListener(() => { controller.abort(); ack?.reject(controller.signal.reason); });
    async function emit(batch: DownloadBatch) {
      controller.signal.throwIfAborted();
      await new Promise<void>((resolve, reject) => { ack = { resolve, reject }; port.postMessage({ type: 'BATCH', ...batch } satisfies CollectorReply); });
      ack = null;
    }
    port.onMessage.addListener((message: CollectorCommand) => {
      if (message.type === 'ACK') { ack?.resolve(); return; }
      if (message.type === 'CANCEL') { controller.abort(); ack?.reject(controller.signal.reason); return; }
      if (message.type !== 'START' || started) return;
      started = true;
      (async () => {
        const client = new Instagram({ request, signal: controller.signal });
        for await (const batch of client.collect(message.job)) {
          if (batch.warning) { await emit({ warning: batch.warning }); continue; }
          const items = [...(batch.items || [])], warnings = [];
          for (const media of batch.media || []) {
            try { items.push(...C.mediaItems(media, batch.info)); }
            catch (e) { warnings.push(asError(e).message); }
          }
          await emit({ items, warnings, label: batch.label });
        }
        port.postMessage({ type: 'DONE' } satisfies CollectorReply);
      })().catch(error => {
        try { port.postMessage({ type: 'ERROR', error: asError(error).name === 'AbortError' ? 'Download stopped.' : asError(error).message }); } catch { /* Tab disconnected. */ }
      });
    });
  });

  const host = document.createElement('div');
  host.id = 'getter-extension';
  host.style.cssText = 'position:fixed!important;bottom:24px!important;right:24px!important;z-index:2147483647!important;width:auto!important;height:auto!important;';
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; color-scheme: dark; font: 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    * { box-sizing: border-box; } button { font: inherit; cursor: pointer; }
    .panel { width: 242px; padding: 12px; border:1px solid #ffffff29; border-radius:18px; background:#1a1922f5; color:#f8f7ff; box-shadow:0 10px 40px #0005; }
    .head { display:flex; align-items:center; gap:9px; margin-bottom:10px; } .logo { display:grid; place-items:center; width:27px; height:27px; background:#d8cbff; border-radius:9px; color:#292038; font-size:20px; }
    strong { font-size:14px; } .head button { margin-left:auto; background:none; color:#aaa4b5; border:0; font-size:18px; padding:4px 7px; }
    .context { margin:0 0 10px; font-size:11px; color:#b9b3c7; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .action { width:100%; text-align:left; display:block; border:0; border-radius:10px; padding:11px 12px; margin-top:5px; color:#e8e3f4; background:#ffffff0c; }
    .action:first-child { color:#2a203d; background:#d8cbff; font-weight:650; } button:hover { filter:brightness(1.12); } button:focus-visible { outline:2px solid #fff; outline-offset:2px; }
    .manager { width:100%; border:0; background:transparent; color:#b9b3c7; padding:12px 2px 2px; font-size:11px; }
    .bubble { border:1px solid #ffffff29; border-radius:30px; background:#211d2c; color:#e3d9ff; padding:12px 17px; box-shadow:0 5px 20px #0004; }
    .toast { position:absolute; bottom:calc(100% + 10px); right:0; width:270px; padding:13px 16px; background:#211d2c; color:#fff; border:1px solid #5e5275; border-radius:12px; line-height:1.5; box-shadow:0 8px 24px #0003; }
    [hidden] { display:none!important; }
  `;
  root.append(style);
  const panel = document.createElement('div'); panel.className = 'panel';
  const head = document.createElement('div'); head.className = 'head';
  const logo = document.createElement('span'); logo.className = 'logo'; logo.textContent = '↓';
  const title = document.createElement('strong'); title.textContent = 'Getter';
  const collapse = document.createElement('button'); collapse.textContent = '−'; collapse.title = 'Minimize Getter'; collapse.setAttribute('aria-label', 'Minimize Getter');
  head.append(logo, title, collapse);
  const contextLabel = document.createElement('p'); contextLabel.className = 'context';
  const actions = document.createElement('div');
  const manager = document.createElement('button'); manager.className = 'manager'; manager.textContent = 'Folder & download manager ↗';
  panel.append(head, contextLabel, actions, manager);
  const bubble = document.createElement('button'); bubble.className = 'bubble'; bubble.textContent = '↓ Getter'; bubble.hidden = true;
  const notification = document.createElement('div'); notification.className = 'toast'; notification.hidden = true; notification.setAttribute('role', 'status');
  root.append(panel, bubble, notification);
  document.documentElement.append(host);
  collapse.onclick = () => { panel.hidden = true; bubble.hidden = false; };
  bubble.onclick = () => { panel.hidden = false; bubble.hidden = true; };
  manager.onclick = () => sendRuntime({ type: 'OPEN_MANAGER' }).catch(() => toast('Extension updated. Refresh Instagram.'));
  function toast(text: string) {
    notification.textContent = text; notification.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { notification.hidden = true; }, 6000);
  }
  function update() {
    latestContext = C.contextFromUrl(location.href);
    const key = JSON.stringify([latestContext.type, latestContext.username, latestContext.shortcode, latestContext.highlightId]);
    if (key === renderKey) return;
    renderKey = key;
    host.hidden = latestContext.type === 'unsupported';
    contextLabel.textContent = latestContext.username ? `@${latestContext.username}` : latestContext.type === 'post' ? 'Photo, video & every carousel slide' : 'Stories & highlights';
    actions.replaceChildren();
    for (const [action, label] of C.actionsFor(latestContext)) {
      const button = document.createElement('button'); button.className = 'action'; button.textContent = `${action === C.actionsFor(latestContext)[0][0] ? '↓  ' : ''}${label}`;
      button.onclick = async () => {
        button.disabled = true;
        try {
          const result = await sendRuntime({ type: 'QUEUE_JOB', action, ...capture() });
          toast(result.ok ? 'Added to Getter. Check the download manager for progress.' : result.error);
        } catch { toast('Extension updated. Refresh Instagram and try again.'); }
        finally { button.disabled = false; }
      };
      actions.append(button);
    }
  }
  update();
  // Instagram uses client-side navigation; polling the URL avoids observing its entire DOM.
  setInterval(update, 650);
})();
