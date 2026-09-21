// Generated from src/*.ts by npm run build. Do not edit directly.
"use strict";
(() => {
  // src/core.ts
  var reserved = /* @__PURE__ */ new Set(["accounts", "explore", "direct", "reels", "reel", "p", "stories", "about", "legal", "developer", "challenge", "emails", "settings", "your_activity", "web", "api"]);
  function contextFromUrl(value) {
    let url;
    try {
      if (typeof value !== "string") return { type: "unsupported" };
      url = new URL(value);
    } catch {
      return { type: "unsupported" };
    }
    if (url.origin !== "https://www.instagram.com") return { type: "unsupported" };
    const p = url.pathname.split("/").filter(Boolean);
    if (["p", "reel", "reels", "tv"].includes(p[0]) && /^[\w-]+$/.test(p[1] || ""))
      return { type: "post", shortcode: p[1], url: url.href };
    if (p[0] === "stories" && p[1] === "highlights" && /^\d+$/.test(p[2] || ""))
      return { type: "highlight", highlightId: p[2], storyId: /^\d+$/.test(p[3] || "") ? p[3] : null, url: url.href };
    if (p[0] === "stories" && /^[\w.]+$/.test(p[1] || "") && !reserved.has(p[1]))
      return { type: "story", username: p[1], storyId: /^\d+$/.test(p[2] || "") ? p[2] : null, url: url.href };
    if (p.length >= 1 && p.length <= 2 && /^[\w.]+$/.test(p[0]) && !reserved.has(p[0]) && (!p[1] || ["reels", "tagged"].includes(p[1])))
      return { type: "profile", username: p[0], url: url.href };
    return { type: "unsupported", url: url.href };
  }
  function shortcodeToId(code) {
    if (!/^[A-Za-z0-9_-]{1,20}$/.test(code)) throw new Error("Invalid post code.");
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    return [...code].reduce((n, c) => n * 64n + BigInt(alphabet.indexOf(c)), 0n).toString();
  }
  function isMediaUrl(value) {
    try {
      if (typeof value !== "string") return false;
      const u = new URL(value);
      return u.protocol === "https:" && !u.username && !u.password && (!u.port || u.port === "443") && ["cdninstagram.com", "fbcdn.net"].some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
    } catch {
      return false;
    }
  }
  function best(versions = []) {
    return versions.filter((v) => isMediaUrl(v.url || v.src)).sort((a, b) => (b.width || b.config_width || 0) * (b.height || b.config_height || 0) - (a.width || a.config_width || 0) * (a.height || a.config_height || 0) || (b.bitrate || 0) - (a.bitrate || 0))[0];
  }
  function mediaItems(media, info = {}) {
    if (!media || typeof media !== "object") throw new Error("Instagram returned an empty media item.");
    const children = media.carousel_media || media.edge_sidecar_to_children?.edges?.map((e) => e.node) || [media];
    if (!children.length) throw new Error("Instagram returned an empty carousel.");
    return children.map((child, i) => {
      const video = best(child.video_versions)?.url || child.video_url;
      const isVideo = child.media_type === 2 || child.is_video || child.__typename === "GraphVideo" || Boolean(video);
      const photo = best(child.image_versions2?.candidates)?.url || best(child.display_resources)?.src || child.display_url;
      const url = isVideo ? video : photo;
      if (!isMediaUrl(url)) throw new Error(`Instagram did not provide a downloadable ${isVideo ? "video" : "image"} for ${child.pk || child.id || "this item"}.`);
      const id = String(child.pk || child.id || `${media.pk || media.id || media.code}_${i + 1}`).split("_")[0];
      if (id === "undefined") throw new Error("Media is missing its identifier.");
      return {
        id,
        url,
        type: isVideo ? "video" : "image",
        username: info.username || media.user?.username || media.owner?.username || "instagram",
        category: info.category || "posts",
        collection: info.collection || "",
        timestamp: child.taken_at || media.taken_at || media.taken_at_timestamp || null,
        shortcode: media.code || media.shortcode || "",
        index: children.length > 1 ? i + 1 : null
      };
    });
  }
  function actionsFor(context) {
    if (context.type === "profile") return [["everything", "Download everything"], ["posts", "Posts & reels"], ["highlights", "All highlights"], ["stories", "Current stories"]];
    if (context.type === "post") return [["post", "Download post"]];
    if (context.type === "story") return [["current", "Download this story"], ["stories", "All current stories"]];
    if (context.type === "highlight") return [["current", "Download this story"], ["highlight", "Entire highlight"]];
    return [];
  }

  // src/errors.ts
  function asError(value) {
    return value instanceof Error ? value : new Error(String(value));
  }

  // src/instagram.ts
  var InstagramError = class extends Error {
    constructor(message, fatal = false, status = 0) {
      super(message);
      this.fatal = fatal;
      this.status = status;
      this.name = "InstagramError";
      this.fatal = fatal;
      this.status = status;
    }
    fatal;
    status;
  };
  function abortCheck(signal) {
    signal?.throwIfAborted();
  }
  function delay(ms, signal) {
    return new Promise((resolve, reject) => {
      abortCheck(signal);
      const cancel = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", cancel);
        resolve();
      }, ms);
      signal?.addEventListener("abort", cancel, { once: true });
    });
  }
  var Instagram = class {
    request;
    signal;
    interval;
    lastRequest;
    constructor({ request, signal, interval = 1600 }) {
      this.request = request;
      this.signal = signal;
      this.interval = interval;
      this.lastRequest = 0;
    }
    async api(path, params = {}, method = "GET") {
      abortCheck(this.signal);
      await delay(Math.max(0, this.interval - (Date.now() - this.lastRequest)), this.signal);
      this.lastRequest = Date.now();
      const data = await this.request(path, params, method, this.signal);
      abortCheck(this.signal);
      return data;
    }
    async user(username) {
      let data;
      try {
        data = await this.api("users/web_profile_info/", { username });
        if (data.data?.user?.id) return { ...data.data.user, id: data.data.user.id };
      } catch (e) {
        if (e instanceof InstagramError && e.fatal || asError(e).name === "AbortError") throw e;
      }
      data = await this.api(`feed/user/${encodeURIComponent(username)}/username/`, { count: 1 });
      const user = data.user || data.items?.[0]?.user;
      if (!user?.pk && !user?.id) throw new InstagramError("Could not resolve this profile. Open it in Instagram and try again.");
      return { ...user, id: String(user.pk || user.id) };
    }
    async *feed(user, reels = false) {
      let cursor = null;
      const seen = /* @__PURE__ */ new Set();
      do {
        const data = reels ? await this.api("clips/user/", { target_user_id: user.id, page_size: 24, include_feed_video: true, ...cursor ? { max_id: cursor } : {} }, "POST") : await this.api(`feed/user/${user.id}/`, { count: 24, ...cursor ? { max_id: cursor } : {} });
        if (!Array.isArray(data.items)) throw new InstagramError(`Instagram did not return the ${reels ? "reels" : "posts"} list.`);
        yield { media: data.items.map((i) => i.media || i), info: { username: user.username, category: "posts" }, label: reels ? "Reels" : "Posts" };
        const more = data.more_available ?? data.paging_info?.more_available ?? false;
        const next = data.next_max_id ?? data.paging_info?.max_id;
        if (!more) break;
        if (!next || seen.has(String(next))) throw new InstagramError("Instagram stopped pagination before the collection finished. Saved files are kept; try again later.");
        cursor = String(next);
        seen.add(cursor);
      } while (true);
    }
    async reel(id) {
      const data = await this.api("feed/reels_media/", { "reel_ids": id });
      const reel = data.reels?.[id] || data.reels_media?.find((r) => String(r.id) === String(id)) || data.reels_media?.[0];
      if (!reel || !Array.isArray(reel.items)) throw new InstagramError("Instagram did not return this story collection. It may be unavailable to your account.");
      return { ...reel, items: reel.items };
    }
    async *stories(user) {
      const data = await this.api(`feed/user/${user.id}/reel_media/`);
      const reel = data.reel || data;
      if (data.reel === null) return;
      if (!Array.isArray(reel.items)) throw new InstagramError("Instagram did not return the current stories list.");
      yield { media: reel.items, info: { username: user.username, category: "stories" }, label: "Stories" };
    }
    async *highlights(user) {
      const data = await this.api(`highlights/${user.id}/highlights_tray/`);
      if (!Array.isArray(data.tray)) throw new InstagramError("Instagram did not return the highlights list.");
      for (const tray of data.tray) {
        try {
          const id = String(tray.id).startsWith("highlight:") ? String(tray.id) : `highlight:${tray.id}`;
          const reel = await this.reel(id);
          yield { media: reel.items, info: { username: user.username, category: "highlights", collection: `${tray.title || "Highlight"}_${id.replace("highlight:", "")}` }, label: tray.title || "Highlight" };
        } catch (e) {
          if (e instanceof InstagramError && e.fatal || asError(e).name === "AbortError") throw e;
          yield { warning: `Highlight ${tray.title || tray.id}: ${asError(e).message}` };
        }
      }
    }
    async *collect(job) {
      const ctx = job.context;
      if (!actionsFor(ctx).some(([action]) => action === job.action)) throw new InstagramError("This action is not available on this page.");
      if (job.action === "post" && ctx.type === "post") {
        const data = await this.api(`media/${shortcodeToId(ctx.shortcode)}/info/`);
        if (!data.items?.length) throw new InstagramError("Instagram did not return this post.");
        yield { media: data.items, info: { category: "posts" }, label: "Post" };
        return;
      }
      if (ctx.type === "highlight") {
        if (job.action === "current" && !ctx.storyId) {
          if (job.snapshot) {
            yield { items: [job.snapshot], label: "Visible story" };
            return;
          }
          throw new InstagramError("The current highlight item could not be identified. Try “Entire highlight”.");
        }
        const reel = await this.reel(`highlight:${ctx.highlightId}`);
        const items = job.action === "current" ? reel.items.filter((m) => String(m.pk || m.id).split("_")[0] === ctx.storyId) : reel.items;
        if (!items.length) throw new InstagramError("This story is no longer available.");
        yield { media: items, info: { username: reel.user?.username, category: "highlights", collection: `${reel.title || "Highlight"}_${ctx.highlightId}` }, label: "Highlight" };
        return;
      }
      if (job.action === "current" && ctx.type === "story" && !ctx.storyId) {
        if (job.snapshot) {
          yield { items: [job.snapshot], label: "Visible story" };
          return;
        }
        throw new InstagramError("Wait for the story to load, then click download again.");
      }
      if (ctx.type !== "profile" && ctx.type !== "story") throw new InstagramError("This page has no profile to download.");
      const user = await this.user(ctx.username);
      user.username ||= ctx.username;
      if (job.action === "current") {
        let found = false;
        for await (const batch of this.stories(user)) {
          const media = batch.media.filter((m) => String(m.pk || m.id).split("_")[0] === ctx.storyId);
          if (!media.length) throw new InstagramError("This story expired or is no longer available.");
          found = true;
          yield { ...batch, media };
        }
        if (!found) throw new InstagramError("This story expired or is no longer available.");
        return;
      }
      const sections = job.action === "everything" ? ["posts", "reels", "stories", "highlights"] : job.action === "posts" ? ["posts", "reels"] : job.action === "stories" || job.action === "highlights" ? [job.action] : [];
      for (const section of sections) {
        try {
          const iterator = section === "posts" || section === "reels" ? this.feed(user, section === "reels") : this[section](user);
          yield* iterator;
        } catch (e) {
          if (e instanceof InstagramError && e.fatal || asError(e).name === "AbortError") throw e;
          yield { warning: `${section}: ${asError(e).message}` };
        }
      }
    }
  };

  // src/messaging.ts
  function sendRuntime(message) {
    return chrome.runtime.sendMessage(message);
  }

  // src/content.ts
  (() => {
    if (globalThis.__getterLoaded) return;
    globalThis.__getterLoaded = true;
    let latestContext, renderKey = "", toastTimer;
    function visibleSnapshot(context) {
      if (!["story", "highlight"].includes(context.type)) return null;
      const candidates = [...document.querySelectorAll('video, main img, [role="dialog"] img')].map((el) => {
        const r = el.getBoundingClientRect();
        const style2 = getComputedStyle(el);
        if (r.width < 180 || r.height < 240 || r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight || style2.visibility === "hidden" || Number(style2.opacity) === 0) return null;
        const url = el.currentSrc || el.src;
        if (!isMediaUrl(url)) return null;
        const center = Math.abs(r.left + r.width / 2 - innerWidth / 2);
        return { el, url, score: r.width * r.height / (1 + center / innerWidth) };
      }).filter((item) => item !== null).sort((a, b) => b.score - a.score);
      const match = candidates[0];
      if (!match) return null;
      let hash = 2166136261;
      for (const char of new URL(match.url).pathname) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
      return {
        id: context.storyId || `visible_${(hash >>> 0).toString(16)}`,
        url: match.url,
        type: match.el.tagName === "VIDEO" ? "video" : "image",
        username: context.username || "instagram",
        category: context.type === "highlight" ? "highlights" : "stories",
        collection: context.highlightId || ""
      };
    }
    function capture() {
      const context = contextFromUrl(location.href);
      return { context, snapshot: visibleSnapshot(context) };
    }
    async function request(path, params, method, signal) {
      const url = new URL(`/api/v1/${path}`, location.origin);
      const headers = { "X-IG-App-ID": "936619743392459", "X-Requested-With": "XMLHttpRequest", "Accept": "application/json" };
      const csrf = document.cookie.split("; ").find((c) => c.startsWith("csrftoken="))?.slice(10);
      if (csrf) headers["X-CSRFToken"] = csrf;
      const options = { method, credentials: "include", headers, signal: AbortSignal.any([signal, AbortSignal.timeout(45e3)]) };
      if (method === "GET") url.search = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])).toString();
      else {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
        options.body = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])).toString();
      }
      const response = await fetch(url, options);
      if (response.status === 429) throw new InstagramError("Instagram is rate-limiting downloads. Stop and try again later.", true, 429);
      if ([401, 403].includes(response.status) || /\/accounts\/login|\/challenge\//.test(response.url))
        throw new InstagramError("Instagram requires login or an account check. Open Instagram to resolve it before retrying.", true, response.status);
      if (!response.ok) throw new InstagramError(`Instagram request failed (HTTP ${response.status}).`, false, response.status);
      let data;
      try {
        data = await response.json();
      } catch {
        throw new InstagramError("Instagram returned a page instead of data. Check your login and try again.", true);
      }
      if (data.status === "fail" || data.message === "login_required" || data.challenge) {
        const fatal = /login|challenge|feedback|wait|limit|checkpoint/i.test(data.message || "") || Boolean(data.challenge);
        throw new InstagramError(fatal ? "Instagram paused access. Check your account in Instagram and try again later." : "Instagram could not complete this request.", fatal);
      }
      return data;
    }
    chrome.runtime.onMessage.addListener((message, sender, respond) => {
      if (sender.id !== chrome.runtime.id) return;
      if (message.type === "CAPTURE") {
        respond(capture());
        return;
      }
      if (message.type === "NOTICE") toast(message.text);
    });
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name !== "getter-collect" || port.sender?.id !== chrome.runtime.id) return;
      const controller = new AbortController();
      let started = false, ack;
      port.onDisconnect.addListener(() => {
        controller.abort();
        ack?.reject(controller.signal.reason);
      });
      async function emit(batch) {
        controller.signal.throwIfAborted();
        await new Promise((resolve, reject) => {
          ack = { resolve, reject };
          port.postMessage({ type: "BATCH", ...batch });
        });
        ack = null;
      }
      port.onMessage.addListener((message) => {
        if (message.type === "ACK") {
          ack?.resolve();
          return;
        }
        if (message.type === "CANCEL") {
          controller.abort();
          ack?.reject(controller.signal.reason);
          return;
        }
        if (message.type !== "START" || started) return;
        started = true;
        (async () => {
          const client = new Instagram({ request, signal: controller.signal });
          for await (const batch of client.collect(message.job)) {
            if (batch.warning) {
              await emit({ warning: batch.warning });
              continue;
            }
            const items = [...batch.items || []], warnings = [];
            for (const media of batch.media || []) {
              try {
                items.push(...mediaItems(media, batch.info));
              } catch (e) {
                warnings.push(asError(e).message);
              }
            }
            await emit({ items, warnings, label: batch.label });
          }
          port.postMessage({ type: "DONE" });
        })().catch((error) => {
          try {
            port.postMessage({ type: "ERROR", error: asError(error).name === "AbortError" ? "Download stopped." : asError(error).message });
          } catch {
          }
        });
      });
    });
    const host = document.createElement("div");
    host.id = "getter-extension";
    host.style.cssText = "position:fixed!important;bottom:24px!important;right:24px!important;z-index:2147483647!important;width:auto!important;height:auto!important;";
    const root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
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
    const panel = document.createElement("div");
    panel.className = "panel";
    const head = document.createElement("div");
    head.className = "head";
    const logo = document.createElement("span");
    logo.className = "logo";
    logo.textContent = "↓";
    const title = document.createElement("strong");
    title.textContent = "Getter";
    const collapse = document.createElement("button");
    collapse.textContent = "−";
    collapse.title = "Minimize Getter";
    collapse.setAttribute("aria-label", "Minimize Getter");
    head.append(logo, title, collapse);
    const contextLabel = document.createElement("p");
    contextLabel.className = "context";
    const actions = document.createElement("div");
    const manager = document.createElement("button");
    manager.className = "manager";
    manager.textContent = "Folder & download manager ↗";
    panel.append(head, contextLabel, actions, manager);
    const bubble = document.createElement("button");
    bubble.className = "bubble";
    bubble.textContent = "↓ Getter";
    bubble.hidden = true;
    const notification = document.createElement("div");
    notification.className = "toast";
    notification.hidden = true;
    notification.setAttribute("role", "status");
    root.append(panel, bubble, notification);
    document.documentElement.append(host);
    collapse.onclick = () => {
      panel.hidden = true;
      bubble.hidden = false;
    };
    bubble.onclick = () => {
      panel.hidden = false;
      bubble.hidden = true;
    };
    manager.onclick = () => sendRuntime({ type: "OPEN_MANAGER" }).catch(() => toast("Extension updated. Refresh Instagram."));
    function toast(text) {
      notification.textContent = text;
      notification.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        notification.hidden = true;
      }, 6e3);
    }
    function update() {
      latestContext = contextFromUrl(location.href);
      const key = JSON.stringify([latestContext.type, latestContext.username, latestContext.shortcode, latestContext.highlightId]);
      if (key === renderKey) return;
      renderKey = key;
      host.hidden = latestContext.type === "unsupported";
      contextLabel.textContent = latestContext.username ? `@${latestContext.username}` : latestContext.type === "post" ? "Photo, video & every carousel slide" : "Stories & highlights";
      actions.replaceChildren();
      for (const [action, label] of actionsFor(latestContext)) {
        const button = document.createElement("button");
        button.className = "action";
        button.textContent = `${action === actionsFor(latestContext)[0][0] ? "↓  " : ""}${label}`;
        button.onclick = async () => {
          button.disabled = true;
          try {
            const result = await sendRuntime({ type: "QUEUE_JOB", action, ...capture() });
            toast(result.ok ? "Added to Getter. Check the download manager for progress." : result.error);
          } catch {
            toast("Extension updated. Refresh Instagram and try again.");
          } finally {
            button.disabled = false;
          }
        };
        actions.append(button);
      }
    }
    update();
    setInterval(update, 650);
  })();
})();
