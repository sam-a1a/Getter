// Generated from src/*.ts by npm run build. Do not edit directly.
"use strict";
(() => {
  // src/core.ts
  function safeSegment(value, fallback = "untitled") {
    const clean = String(value || "").normalize("NFC").replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, "_").replace(/^[.\s]+|[.\s]+$/g, "").slice(0, 110);
    return !clean ? fallback : /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(clean) ? `_${clean}` : clean;
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
  function extensionFor(item, contentType) {
    const mime = contentType?.split(";")[0].toLowerCase();
    const types = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif", "image/gif": "gif", "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" };
    if (mime && types[mime]) {
      if (!mime.startsWith(`${item.type}/`)) throw new Error("Instagram returned the wrong media type.");
      return types[mime];
    }
    if (mime && mime !== "application/octet-stream" && mime !== "binary/octet-stream") throw new Error("Instagram returned a page instead of a media file.");
    const ext = new URL(item.url).pathname.match(/\.(jpe?g|png|webp|avif|gif|mp4|webm|mov)$/i)?.[1]?.toLowerCase();
    return ext || (item.type === "video" ? "mp4" : "jpg");
  }
  function filePath(item, ext) {
    let date = "";
    if (item.timestamp && Number.isFinite(Number(item.timestamp))) {
      const d = new Date(Number(item.timestamp) * 1e3);
      if (!Number.isNaN(d.getTime())) date = `${d.toISOString().slice(0, 10)}_`;
    }
    return [
      safeSegment(item.username),
      safeSegment(item.category),
      ...item.collection ? [safeSegment(item.collection)] : [],
      `${date}${safeSegment(item.id)}${item.index ? `_${item.index}` : ""}.${safeSegment(ext)}`
    ];
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

  // src/files.ts
  async function loadDirectory() {
    return dbOperation("readonly", (store) => store.get("directory"));
  }
  async function storeDirectory(handle) {
    return dbOperation("readwrite", (store) => store.put(handle, "directory"));
  }
  function dbOperation(mode, operation) {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open("getter-folders", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("settings");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const transaction = db.transaction("settings", mode);
        const request = operation(transaction.objectStore("settings"));
        transaction.oncomplete = () => {
          db.close();
          resolve(request.result);
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error);
        };
        transaction.onabort = () => {
          db.close();
          reject(transaction.error);
        };
      };
    });
  }
  async function saveMedia(root, item, { signal, fetcher = fetch, onProgress = () => {
  } } = {}) {
    if (!isMediaUrl(item.url) || !["video", "image"].includes(item.type)) throw new Error("Untrusted media URL or type.");
    signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(12e4);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetcher(item.url, { credentials: "omit", redirect: "error", signal: combined });
    if (!response.ok) throw new Error(`Media download failed (HTTP ${response.status}). Reopen the item and try again.`);
    const ext = extensionFor(item, response.headers.get("content-type"));
    const path = filePath(item, ext);
    let directory2 = root;
    for (const name2 of path.slice(0, -1)) {
      combined.throwIfAborted();
      directory2 = await directory2.getDirectoryHandle(name2, { create: true });
    }
    const name = path.at(-1);
    let handle, created = false;
    try {
      handle = await directory2.getFileHandle(name);
      const file = await handle.getFile();
      if (file.size > 0) {
        await response.body?.cancel();
        return { skipped: true, path: path.join("/"), bytes: file.size };
      }
    } catch (e) {
      if (asError(e).name !== "NotFoundError") throw e;
    }
    if (!handle) {
      handle = await directory2.getFileHandle(name, { create: true });
      created = true;
    }
    let writable, bytes = 0;
    try {
      combined.throwIfAborted();
      if (!response.body) throw new Error("The media response was empty.");
      writable = await handle.createWritable();
      const counter = new TransformStream({ transform(chunk, controller) {
        bytes += chunk.byteLength;
        onProgress(bytes);
        controller.enqueue(chunk);
      } });
      await response.body.pipeThrough(counter).pipeTo(writable, { signal: combined, preventClose: true });
      const length = Number(response.headers.get("content-length"));
      if (!bytes || length > 0 && !response.headers.get("content-encoding") && bytes !== length) throw new Error("The downloaded file was incomplete. Try again.");
      combined.throwIfAborted();
      await writable.close();
      return { skipped: false, path: path.join("/"), bytes };
    } catch (e) {
      try {
        await writable?.abort();
      } catch {
      }
      if (created) {
        try {
          await directory2.removeEntry(name);
        } catch {
        }
      }
      throw e;
    }
  }

  // src/messaging.ts
  function sendRuntime(message) {
    return chrome.runtime.sendMessage(message);
  }
  function captureTab(tabId) {
    return chrome.tabs.sendMessage(tabId, { type: "CAPTURE" });
  }

  // src/manager.ts
  var $ = (id) => {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing manager element: ${id}`);
    return element;
  };
  var button = (id) => {
    const element = $(id);
    if (!(element instanceof HTMLButtonElement)) throw new Error(`Expected a button: ${id}`);
    return element;
  };
  var directory;
  var sourceTabId;
  var capture = null;
  var activeController = null;
  var history = [];
  var running = false;
  var ready = false;
  var stopped = false;
  var queueLength = 0;
  function banner(text = "") {
    $("banner").textContent = text;
    $("banner").hidden = !text;
  }
  function jobTitle(job) {
    const target = job.context.username ? `@${job.context.username}` : job.context.shortcode || "Highlight";
    const label = actionsFor(job.context).find(([a]) => a === job.action)?.[1] || "Download";
    return `${target} · ${label}`;
  }
  function renderHistory() {
    $("activity").replaceChildren();
    $("empty-state").hidden = running || history.length > 0;
    $("activity-count").textContent = String(history.length);
    for (const record of history.slice(0, 20)) {
      const row = document.createElement("div");
      row.className = `activity-row ${record.state || ""}`;
      const icon = document.createElement("div");
      icon.className = "row-icon";
      icon.textContent = record.state === "error" ? "×" : record.state === "warning" ? "!" : "✓";
      const copy = document.createElement("div");
      copy.className = "row-copy";
      const title = document.createElement("strong");
      title.textContent = record.title;
      const detail = document.createElement("p");
      detail.textContent = record.detail;
      copy.append(title, detail);
      if (record.warnings?.length) {
        const details = document.createElement("details");
        const summary = document.createElement("summary");
        summary.textContent = "View issues";
        const list = document.createElement("ul");
        for (const text of record.warnings) {
          const li = document.createElement("li");
          li.textContent = text;
          list.append(li);
        }
        details.append(summary, list);
        copy.append(details);
      }
      const time = document.createElement("span");
      time.className = "row-time";
      time.textContent = new Date(record.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      row.append(icon, copy, time);
      $("activity").append(row);
    }
  }
  async function refreshSource() {
    const data = await chrome.storage.session.get("sourceTabId");
    sourceTabId = data.sourceTabId;
    capture = null;
    if (sourceTabId != null) {
      try {
        capture = await captureTab(sourceTabId);
      } catch {
      }
    }
    const ctx = capture?.context;
    const available = ctx && actionsFor(ctx).length > 0;
    $("source-state").textContent = available ? "CONNECTED" : "CONNECT INSTAGRAM";
    $("source-state").classList.toggle("connected", Boolean(available));
    $("source-title").textContent = available ? ctx.username ? `@${ctx.username}` : ctx.type === "post" ? "Your open post" : "Your open highlight" : "Open a profile, post or story";
    $("source-detail").textContent = available ? ctx.type === "profile" ? "Photos, videos and every slide. Organized automatically." : "Save the item you opened, straight to your folder." : "Click Getter in the Chrome toolbar on Instagram. Refresh Instagram after installing.";
    $("source-actions").replaceChildren();
    for (const [action, label] of actionsFor(ctx || { type: "unsupported" })) {
      const button2 = document.createElement("button");
      button2.textContent = label;
      button2.onclick = async () => {
        button2.disabled = true;
        try {
          if (sourceTabId === void 0) throw new Error("Open Instagram first.");
          const latest = await captureTab(sourceTabId);
          if (!actionsFor(latest.context).some(([a]) => a === action)) throw new Error("Instagram changed pages. Refresh the connected page here.");
          const result = await sendRuntime({ type: "QUEUE_JOB", action, sourceTabId, ...latest });
          if (!result.ok) throw new Error(result.error);
          stopped = false;
          await pump();
        } catch (e) {
          banner(asError(e).message);
        } finally {
          button2.disabled = false;
        }
      };
      $("source-actions").append(button2);
    }
  }
  async function folderState() {
    ready = !!directory && await directory.queryPermission({ mode: "readwrite" }) === "granted";
    $("folder-name").textContent = directory?.name || "A home for your downloads";
    $("folder-detail").textContent = ready ? "Files are organized by profile, then posts, stories and highlights." : directory ? "Allow access to continue saving to this folder." : "Choose a folder on your Desktop, or anywhere you like.";
    $("choose-folder").textContent = directory ? "Change folder ↗" : "Choose folder ↗";
    $("grant-folder").hidden = !directory || ready;
    await chrome.storage.local.set({ folderConfigured: Boolean(ready) });
  }
  $("choose-folder").onclick = async () => {
    try {
      const selected = await showDirectoryPicker({ id: "getter-downloads", mode: "readwrite", startIn: directory || "desktop" });
      await storeDirectory(selected);
      directory = selected;
      await folderState();
      banner();
      stopped = false;
      await pump();
    } catch (e) {
      if (asError(e).name !== "AbortError") banner(`Could not select that folder: ${asError(e).message}`);
    }
  };
  $("grant-folder").onclick = async () => {
    try {
      await directory?.requestPermission({ mode: "readwrite" });
      await folderState();
      stopped = false;
      await pump();
    } catch (e) {
      banner(asError(e).message);
    }
  };
  $("refresh-source").onclick = () => refreshSource().catch((e) => banner(asError(e).message));
  $("stop").onclick = async () => {
    stopped = true;
    activeController?.abort();
    await sendRuntime({ type: "CLEAR_QUEUE" });
    banner("Downloads stopped. Files already saved are kept. Click a download button to try again; existing files are skipped.");
    $("stop").hidden = true;
  };
  function counts(stats) {
    $("saved-count").textContent = String(stats.saved);
    $("skipped-count").textContent = String(stats.skipped);
    $("failed-count").textContent = String(stats.failed);
  }
  async function consume(job, stats, signal) {
    if (!directory) throw new Error("Choose a download folder first.");
    const targetDirectory = directory;
    const transport = new AbortController();
    signal = AbortSignal.any([signal, transport.signal]);
    const seen = /* @__PURE__ */ new Set();
    const port = chrome.tabs.connect(job.sourceTabId, { name: "getter-collect" });
    return new Promise((resolve, reject) => {
      let settled = false, timer, processing = Promise.resolve();
      function finish(error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
        if (error) transport.abort(error);
        port.disconnect();
        const complete = () => error ? reject(error) : resolve();
        processing.then(complete, complete);
      }
      function watchdog() {
        clearTimeout(timer);
        timer = setTimeout(() => finish(new Error("Instagram stopped responding. Keep its tab open, refresh it, and try again.")), 65e3);
      }
      function cancel() {
        finish(asError(signal.reason || new DOMException("Stopped", "AbortError")));
      }
      signal.addEventListener("abort", cancel, { once: true });
      port.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError;
        if (!settled) finish(new Error(error?.message || "The Instagram tab was closed or refreshed. Saved files are kept."));
      });
      port.onMessage.addListener((message) => {
        if (settled) return;
        clearTimeout(timer);
        if (message.type === "DONE") {
          finish();
          return;
        }
        if (message.type === "ERROR") {
          finish(new Error(message.error));
          return;
        }
        if (message.type !== "BATCH") {
          watchdog();
          return;
        }
        processing = (async () => {
          signal.throwIfAborted();
          if (message.warning) stats.warnings.push(message.warning);
          stats.warnings.push(...message.warnings || []);
          stats.failed += message.warnings?.length || 0;
          $("active-state").textContent = message.label || "Collecting";
          for (const item of message.items || []) {
            signal.throwIfAborted();
            const key = `${item.category}/${item.collection}/${item.id}`;
            if (seen.has(key)) continue;
            seen.add(key);
            try {
              $("active-detail").textContent = `Saving ${item.type} ${item.id}…`;
              let lastPaint = 0;
              const result = await saveMedia(targetDirectory, item, { signal, onProgress(bytes) {
                if (Date.now() - lastPaint < 250) return;
                lastPaint = Date.now();
                $("active-detail").textContent = `Saving ${item.type} ${item.id} · ${(bytes / 1048576).toFixed(1)} MB`;
              } });
              stats[result.skipped ? "skipped" : "saved"]++;
              stats.bytes += result.skipped ? 0 : result.bytes;
              stats.consecutiveFailures = 0;
              $("active-detail").textContent = `${result.skipped ? "Already saved" : "Saved"} · ${result.path}`;
            } catch (e) {
              if (signal.aborted) throw e;
              stats.failed++;
              stats.consecutiveFailures++;
              stats.warnings.push(`${item.id}: ${asError(e).message}`);
              if (asError(e).name === "NotAllowedError" || asError(e).name === "QuotaExceededError" || stats.consecutiveFailures >= 3) throw new Error(`Download stopped: ${asError(e).message}`);
            }
            counts(stats);
          }
          counts(stats);
          if (!settled) {
            port.postMessage({ type: "ACK" });
            watchdog();
          }
        })();
        processing.catch((error) => finish(asError(error)));
      });
      if (signal.aborted) {
        cancel();
        return;
      }
      port.postMessage({ type: "START", job });
      watchdog();
    });
  }
  async function pump() {
    const { jobs = [] } = await chrome.storage.session.get("jobs");
    queueLength = jobs.length;
    $("queue-badge").textContent = String(queueLength);
    $("queue-count").textContent = `${Math.max(0, queueLength - (running ? 1 : 0))} queued`;
    $("stop").hidden = !queueLength && !running;
    if (running || !jobs.length || stopped) return;
    if (!ready) {
      banner(`${jobs.length} download${jobs.length === 1 ? "" : "s"} waiting. ${directory ? "Allow folder access" : "Choose a folder"} to begin.`);
      return;
    }
    running = true;
    const job = jobs[0];
    activeController = new AbortController();
    const stats = { saved: 0, skipped: 0, failed: 0, bytes: 0, consecutiveFailures: 0, warnings: [] };
    let error;
    $("active-card").hidden = false;
    $("empty-state").hidden = true;
    button("choose-folder").disabled = true;
    $("active-title").textContent = jobTitle(job);
    $("active-state").textContent = "Collecting";
    $("active-detail").textContent = "Connecting to Instagram…";
    counts(stats);
    banner();
    try {
      await consume(job, stats, activeController.signal);
    } catch (e) {
      error = asError(e);
      if (!activeController.signal.aborted) banner(asError(e).message);
    }
    const aborted = activeController.signal.aborted;
    const incomplete = Boolean(error || stats.failed || stats.warnings.length);
    const prefix = aborted ? "Stopped" : incomplete ? "Incomplete" : stats.saved + stats.skipped === 0 ? "No available media" : "Complete";
    const warnings = [...error && !aborted ? [error.message] : [], ...stats.warnings].slice(0, 100);
    history.unshift({ title: jobTitle(job), detail: `${prefix} · ${stats.saved} saved · ${stats.skipped} skipped · ${stats.failed} failed${stats.bytes ? ` · ${(stats.bytes / 1048576).toFixed(1)} MB` : ""}`, warnings, time: Date.now(), state: incomplete || aborted ? stats.saved || stats.skipped ? "warning" : "error" : "" });
    history = history.slice(0, 20);
    try {
      await chrome.storage.local.set({ history });
      const result = await sendRuntime({ type: "FINISH_JOB", id: job.id });
      if (!result.ok) throw new Error(result.error);
    } catch (e) {
      stopped = true;
      banner(`Queue could not be updated: ${asError(e).message}`);
    }
    if (error && !aborted) {
      stopped = true;
      await sendRuntime({ type: "CLEAR_QUEUE" });
    }
    running = false;
    activeController = null;
    $("active-card").hidden = true;
    button("choose-folder").disabled = false;
    renderHistory();
    await folderState();
    await pump();
  }
  async function start() {
    const stored = await chrome.storage.local.get("history");
    history = stored.history || [];
    renderHistory();
    try {
      directory = await loadDirectory();
      await folderState();
    } catch (e) {
      banner(`Choose your folder again: ${asError(e).message}`);
    }
    await refreshSource();
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "session") return;
      if (changes.sourceTabId) refreshSource().catch((e) => banner(asError(e).message));
      if (changes.jobs) {
        const newLength = Array.isArray(changes.jobs.newValue) ? changes.jobs.newValue.length : 0;
        const oldLength = Array.isArray(changes.jobs.oldValue) ? changes.jobs.oldValue.length : 0;
        if (newLength > oldLength) stopped = false;
        pump().catch((e) => banner(asError(e).message));
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshSource().catch(() => {
      });
    });
    window.addEventListener("beforeunload", (event) => {
      if (running) {
        event.preventDefault();
        event.returnValue = "";
      }
    });
    await pump();
  }
  navigator.locks.request("getter-download-manager", { ifAvailable: true }, async (lock) => {
    if (!lock) {
      banner("Getter is already open in another tab. Use that tab for downloads.");
      for (const button2 of document.querySelectorAll("button")) button2.disabled = true;
      return;
    }
    await start();
    await new Promise(() => {
    });
  }).catch((e) => banner(asError(e).message));
})();
