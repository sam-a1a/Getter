import * as C from './core.js';
import { asError } from './errors.js';
import type { ApiParams, CollectionBatch, CollectionJob, InstagramRequest, InstagramResponse, MediaBatch, Reel, RequestMethod, ResolvedUser } from './types.js';
export class InstagramError extends Error {
  constructor(message: string, public fatal = false, public status = 0) { super(message); this.name = 'InstagramError'; this.fatal = fatal; this.status = status; }
}
function abortCheck(signal: AbortSignal) { signal?.throwIfAborted(); }
export function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    abortCheck(signal);
    const cancel = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, ms);
    signal?.addEventListener('abort', cancel, { once: true });
  });
}
export class Instagram {
  private request: InstagramRequest;
  private signal: AbortSignal;
  private interval: number;
  private lastRequest: number;
  constructor({ request, signal, interval = 1600 }: { request: InstagramRequest; signal: AbortSignal; interval?: number }) { this.request = request; this.signal = signal; this.interval = interval; this.lastRequest = 0; }
  async api(path: string, params: ApiParams = {}, method: RequestMethod = 'GET'): Promise<InstagramResponse> {
    abortCheck(this.signal);
    await delay(Math.max(0, this.interval - (Date.now() - this.lastRequest)), this.signal);
    this.lastRequest = Date.now();
    const data = await this.request(path, params, method, this.signal);
    abortCheck(this.signal);
    return data;
  }
  async user(username: string): Promise<ResolvedUser> {
    let data;
    try {
      data = await this.api('users/web_profile_info/', { username });
      if (data.data?.user?.id) return { ...data.data.user, id: data.data.user.id };
    } catch (e) { if ((e instanceof InstagramError && e.fatal) || asError(e).name === 'AbortError') throw e; }
    data = await this.api(`feed/user/${encodeURIComponent(username)}/username/`, { count: 1 });
    const user = data.user || data.items?.[0]?.user;
    if (!user?.pk && !user?.id) throw new InstagramError('Could not resolve this profile. Open it in Instagram and try again.');
    return { ...user, id: String(user.pk || user.id) };
  }
  async *feed(user: ResolvedUser, reels = false): AsyncGenerator<MediaBatch> {
    let cursor: string | null = null;
    const seen = new Set();
    do {
      const data: InstagramResponse = reels
        ? await this.api('clips/user/', { target_user_id: user.id, page_size: 24, include_feed_video: true, ...(cursor ? { max_id: cursor } : {}) }, 'POST')
        : await this.api(`feed/user/${user.id}/`, { count: 24, ...(cursor ? { max_id: cursor } : {}) });
      if (!Array.isArray(data.items)) throw new InstagramError(`Instagram did not return the ${reels ? 'reels' : 'posts'} list.`);
      yield { media: data.items.map(i => i.media || i), info: { username: user.username, category: 'posts' }, label: reels ? 'Reels' : 'Posts' };
      const more = data.more_available ?? data.paging_info?.more_available ?? false;
      const next = data.next_max_id ?? data.paging_info?.max_id;
      if (!more) break;
      if (!next || seen.has(String(next))) throw new InstagramError('Instagram stopped pagination before the collection finished. Saved files are kept; try again later.');
      cursor = String(next); seen.add(cursor);
    } while (true);
  }
  async reel(id: string): Promise<Reel & { items: NonNullable<Reel['items']> }> {
    const data = await this.api('feed/reels_media/', { 'reel_ids': id });
    const reel = data.reels?.[id] || data.reels_media?.find(r => String(r.id) === String(id)) || data.reels_media?.[0];
    if (!reel || !Array.isArray(reel.items)) throw new InstagramError('Instagram did not return this story collection. It may be unavailable to your account.');
    return { ...reel, items: reel.items };
  }
  async *stories(user: ResolvedUser): AsyncGenerator<MediaBatch> {
    const data = await this.api(`feed/user/${user.id}/reel_media/`);
    const reel = data.reel || data;
    if (data.reel === null) return;
    if (!Array.isArray(reel.items)) throw new InstagramError('Instagram did not return the current stories list.');
    yield { media: reel.items, info: { username: user.username, category: 'stories' }, label: 'Stories' };
  }
  async *highlights(user: ResolvedUser): AsyncGenerator<CollectionBatch> {
    const data = await this.api(`highlights/${user.id}/highlights_tray/`);
    if (!Array.isArray(data.tray)) throw new InstagramError('Instagram did not return the highlights list.');
    for (const tray of data.tray) {
      try {
        const id = String(tray.id).startsWith('highlight:') ? String(tray.id) : `highlight:${tray.id}`;
        const reel = await this.reel(id);
        yield { media: reel.items, info: { username: user.username, category: 'highlights', collection: `${tray.title || 'Highlight'}_${id.replace('highlight:', '')}` }, label: tray.title || 'Highlight' };
      } catch (e) { if ((e instanceof InstagramError && e.fatal) || asError(e).name === 'AbortError') throw e; yield { warning: `Highlight ${tray.title || tray.id}: ${asError(e).message}` }; }
    }
  }
  async *collect(job: CollectionJob): AsyncGenerator<CollectionBatch> {
    const ctx = job.context;
    if (!C.actionsFor(ctx).some(([action]) => action === job.action)) throw new InstagramError('This action is not available on this page.');
    if (job.action === 'post' && ctx.type === 'post') {
      const data = await this.api(`media/${C.shortcodeToId(ctx.shortcode)}/info/`);
      if (!data.items?.length) throw new InstagramError('Instagram did not return this post.');
      yield { media: data.items, info: { category: 'posts' }, label: 'Post' };
      return;
    }
    if (ctx.type === 'highlight') {
      if (job.action === 'current' && !ctx.storyId) {
        if (job.snapshot) { yield { items: [job.snapshot], label: 'Visible story' }; return; }
        throw new InstagramError('The current highlight item could not be identified. Try “Entire highlight”.');
      }
      const reel = await this.reel(`highlight:${ctx.highlightId}`);
      const items = job.action === 'current' ? reel.items.filter(m => String(m.pk || m.id).split('_')[0] === ctx.storyId) : reel.items;
      if (!items.length) throw new InstagramError('This story is no longer available.');
      yield { media: items, info: { username: reel.user?.username, category: 'highlights', collection: `${reel.title || 'Highlight'}_${ctx.highlightId}` }, label: 'Highlight' };
      return;
    }
    if (job.action === 'current' && ctx.type === 'story' && !ctx.storyId) {
      if (job.snapshot) { yield { items: [job.snapshot], label: 'Visible story' }; return; }
      throw new InstagramError('Wait for the story to load, then click download again.');
    }
    if (ctx.type !== 'profile' && ctx.type !== 'story') throw new InstagramError('This page has no profile to download.');
    const user = await this.user(ctx.username);
    user.username ||= ctx.username;
    if (job.action === 'current') {
      let found = false;
      for await (const batch of this.stories(user)) {
        const media = batch.media.filter(m => String(m.pk || m.id).split('_')[0] === ctx.storyId);
        if (!media.length) throw new InstagramError('This story expired or is no longer available.');
        found = true;
        yield { ...batch, media };
      }
      if (!found) throw new InstagramError('This story expired or is no longer available.');
      return;
    }
    const sections: ('posts' | 'reels' | 'stories' | 'highlights')[] = job.action === 'everything' ? ['posts', 'reels', 'stories', 'highlights'] : job.action === 'posts' ? ['posts', 'reels'] : job.action === 'stories' || job.action === 'highlights' ? [job.action] : [];
    for (const section of sections) {
      try {
        const iterator = section === 'posts' || section === 'reels' ? this.feed(user, section === 'reels') : this[section](user);
        yield* iterator;
      } catch (e) {
        if ((e instanceof InstagramError && e.fatal) || asError(e).name === 'AbortError') throw e;
        yield { warning: `${section}: ${asError(e).message}` };
      }
    }
  }
}
