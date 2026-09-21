/* Shared, dependency-free parsing. Never trust a page-provided URL or filename. */
(() => {
  const reserved = new Set(['accounts', 'explore', 'direct', 'reels', 'reel', 'p', 'stories', 'about', 'legal', 'developer', 'challenge', 'emails', 'settings', 'your_activity', 'web', 'api']);
  function contextFromUrl(value) {
    let url;
    try { url = new URL(value); } catch { return { type: 'unsupported' }; }
    if (url.origin !== 'https://www.instagram.com') return { type: 'unsupported' };
    const p = url.pathname.split('/').filter(Boolean);
    if (['p', 'reel', 'reels', 'tv'].includes(p[0]) && /^[\w-]+$/.test(p[1] || ''))
      return { type: 'post', shortcode: p[1], url: url.href };
    if (p[0] === 'stories' && p[1] === 'highlights' && /^\d+$/.test(p[2] || ''))
      return { type: 'highlight', highlightId: p[2], storyId: /^\d+$/.test(p[3] || '') ? p[3] : null, url: url.href };
    if (p[0] === 'stories' && /^[\w.]+$/.test(p[1] || '') && !reserved.has(p[1]))
      return { type: 'story', username: p[1], storyId: /^\d+$/.test(p[2] || '') ? p[2] : null, url: url.href };
    if (p.length >= 1 && p.length <= 2 && /^[\w.]+$/.test(p[0]) && !reserved.has(p[0]) && (!p[1] || ['reels', 'tagged'].includes(p[1])))
      return { type: 'profile', username: p[0], url: url.href };
    return { type: 'unsupported', url: url.href };
  }
  function shortcodeToId(code) {
    if (!/^[A-Za-z0-9_-]{1,20}$/.test(code)) throw new Error('Invalid post code.');
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    return [...code].reduce((n, c) => n * 64n + BigInt(alphabet.indexOf(c)), 0n).toString();
  }
  function safeSegment(value, fallback = 'untitled') {
    const clean = String(value || '').normalize('NFC').replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 110);
    return !clean ? fallback : /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(clean) ? `_${clean}` : clean;
  }
  function isMediaUrl(value) {
    try {
      const u = new URL(value);
      return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') &&
        ['cdninstagram.com', 'fbcdn.net'].some(h => u.hostname === h || u.hostname.endsWith(`.${h}`));
    } catch { return false; }
  }
  function best(versions = []) {
    return versions.filter(v => isMediaUrl(v.url || v.src)).sort((a, b) =>
      ((b.width || b.config_width || 0) * (b.height || b.config_height || 0) - (a.width || a.config_width || 0) * (a.height || a.config_height || 0)) || ((b.bitrate || 0) - (a.bitrate || 0)))[0];
  }
  function mediaItems(media, info = {}) {
    if (!media || typeof media !== 'object') throw new Error('Instagram returned an empty media item.');
    const children = media.carousel_media || media.edge_sidecar_to_children?.edges?.map(e => e.node) || [media];
    if (!children.length) throw new Error('Instagram returned an empty carousel.');
    return children.map((child, i) => {
      const video = best(child.video_versions)?.url || child.video_url;
      const isVideo = child.media_type === 2 || child.is_video || child.__typename === 'GraphVideo' || Boolean(video);
      const photo = best(child.image_versions2?.candidates)?.url || best(child.display_resources)?.src || child.display_url;
      const url = isVideo ? video : photo;
      if (!isMediaUrl(url)) throw new Error(`Instagram did not provide a downloadable ${isVideo ? 'video' : 'image'} for ${child.pk || child.id || 'this item'}.`);
      const id = String(child.pk || child.id || `${media.pk || media.id || media.code}_${i + 1}`).split('_')[0];
      if (id === 'undefined') throw new Error('Media is missing its identifier.');
      return {
        id, url, type: isVideo ? 'video' : 'image',
        username: info.username || media.user?.username || media.owner?.username || 'instagram',
        category: info.category || 'posts', collection: info.collection || '',
        timestamp: child.taken_at || media.taken_at || media.taken_at_timestamp || null,
        shortcode: media.code || media.shortcode || '', index: children.length > 1 ? i + 1 : null
      };
    });
  }
  function extensionFor(item, contentType) {
    const mime = contentType?.split(';')[0].toLowerCase();
    const types = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
    if (mime && types[mime]) {
      if (!mime.startsWith(`${item.type}/`)) throw new Error('Instagram returned the wrong media type.');
      return types[mime];
    }
    if (mime && mime !== 'application/octet-stream' && mime !== 'binary/octet-stream') throw new Error('Instagram returned a page instead of a media file.');
    const ext = new URL(item.url).pathname.match(/\.(jpe?g|png|webp|avif|gif|mp4|webm|mov)$/i)?.[1]?.toLowerCase();
    return ext || (item.type === 'video' ? 'mp4' : 'jpg');
  }
  function filePath(item, ext) {
    let date = '';
    if (item.timestamp && Number.isFinite(Number(item.timestamp))) {
      const d = new Date(Number(item.timestamp) * 1000);
      if (!Number.isNaN(d.getTime())) date = `${d.toISOString().slice(0, 10)}_`;
    }
    return [safeSegment(item.username), safeSegment(item.category), ...(item.collection ? [safeSegment(item.collection)] : []),
      `${date}${safeSegment(item.id)}${item.index ? `_${item.index}` : ''}.${safeSegment(ext)}`];
  }
  function actionsFor(context) {
    if (context.type === 'profile') return [['everything', 'Download everything'], ['posts', 'Posts & reels'], ['highlights', 'All highlights'], ['stories', 'Current stories']];
    if (context.type === 'post') return [['post', 'Download post']];
    if (context.type === 'story') return [['current', 'Download this story'], ['stories', 'All current stories']];
    if (context.type === 'highlight') return [['current', 'Download this story'], ['highlight', 'Entire highlight']];
    return [];
  }
  globalThis.GetterCore = Object.freeze({ contextFromUrl, shortcodeToId, safeSegment, isMediaUrl, mediaItems, extensionFor, filePath, actionsFor });
})();
