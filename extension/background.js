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
  function isMediaUrl(value) {
    try {
      if (typeof value !== "string") return false;
      const u = new URL(value);
      return u.protocol === "https:" && !u.username && !u.password && (!u.port || u.port === "443") && ["cdninstagram.com", "fbcdn.net"].some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
    } catch {
      return false;
    }
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

  // src/background.ts
  var managerUrl = chrome.runtime.getURL("manager.html");
  var serial = Promise.resolve();
  async function openManager(active = true) {
    const existing = (await chrome.tabs.query({ url: managerUrl }))[0];
    if (existing) {
      if (active) {
        await chrome.tabs.update(existing.id, { active: true });
        await chrome.windows.update(existing.windowId, { focused: true });
      }
      return existing;
    }
    return chrome.tabs.create({ url: managerUrl, active, pinned: true });
  }
  async function handle(message, sender) {
    const manager = sender.url === managerUrl && !sender.tab?.url?.startsWith("https://");
    const instagram = sender.tab && sender.url?.startsWith("https://www.instagram.com/");
    if (!manager && !instagram) throw new Error("Unsupported sender.");
    if (message.type === "OPEN_MANAGER") {
      if (instagram) await chrome.storage.session.set({ sourceTabId: sender.tab?.id });
      await openManager();
      return { ok: true };
    }
    if (message.type === "QUEUE_JOB") {
      const sourceTabId = instagram ? sender.tab?.id : message.sourceTabId;
      if (sourceTabId === void 0 || !Number.isInteger(sourceTabId)) throw new Error("Open Instagram first.");
      const source = await chrome.tabs.get(sourceTabId);
      if (!source.url?.startsWith("https://www.instagram.com/")) throw new Error("The source tab is no longer on Instagram.");
      const context = contextFromUrl(message.context?.url);
      if (!actionsFor(context).some(([a]) => a === message.action)) throw new Error("This action is not available here.");
      const { jobs = [] } = await chrome.storage.session.get("jobs");
      if (jobs.length >= 40) throw new Error("The queue is full. Let current downloads finish first.");
      if (jobs.some((j) => j.action === message.action && j.context.url === context.url && j.sourceTabId === sourceTabId)) return { ok: true };
      const snapshot = message.snapshot && isMediaUrl(message.snapshot.url) ? message.snapshot : null;
      const job = { id: crypto.randomUUID(), action: message.action, context, snapshot, sourceTabId, created: Date.now() };
      await chrome.storage.session.set({ jobs: [...jobs, job], sourceTabId });
      const { folderConfigured } = await chrome.storage.local.get("folderConfigured");
      await openManager(!folderConfigured);
      return { ok: true, id: job.id };
    }
    if (message.type === "FINISH_JOB" && manager) {
      const { jobs = [] } = await chrome.storage.session.get("jobs");
      await chrome.storage.session.set({ jobs: jobs.filter((j) => j.id !== message.id) });
      return { ok: true };
    }
    if (message.type === "CLEAR_QUEUE" && manager) {
      await chrome.storage.session.set({ jobs: [] });
      return { ok: true };
    }
    throw new Error("Unknown request.");
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!["OPEN_MANAGER", "QUEUE_JOB", "FINISH_JOB", "CLEAR_QUEUE"].includes(message.type)) return;
    serial = serial.catch(() => {
    }).then(() => handle(message, sender));
    serial.then(respond, (error) => respond({ ok: false, error: asError(error).message }));
    return true;
  });
  chrome.action.onClicked.addListener((tab) => {
    serial = serial.catch(() => {
    }).then(async () => {
      if (tab.url?.startsWith("https://www.instagram.com/")) await chrome.storage.session.set({ sourceTabId: tab.id });
      await openManager();
    });
  });
})();
