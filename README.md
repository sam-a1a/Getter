# Getter — Instagram downloads for Chrome

A local Chrome extension that saves Instagram photos and videos into a folder you choose, including a folder on your Desktop. No backend, account signup, API key, or runtime build step.

## Install

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** at the top right.
3. Click **Load unpacked** and select this project's **extension** folder:
   `/Users/sam/PycharmProjects/Getter/extension`
   If using `Getter-Chrome.zip`, extract it first and select the extracted **Getter** folder instead.
4. Pin **Getter** using Chrome's extensions puzzle-piece menu.
5. Refresh any Instagram tabs that were already open. Log into Instagram normally.
6. Click Getter in Chrome's toolbar, then **Choose folder**. Select or create a folder on your Desktop, for example `Instagram downloads`.

Chrome must show its own folder permission dialog. Getter remembers your choice; Chrome may ask you to grant access again after restarting.

## Use

- **A story:** open the story, then click **Download this story** in Getter's floating panel at the bottom right. **All current stories** saves that account's available stories.
- **A single post or reel:** open it, then click **Download post**. Every slide in a carousel is included, with video saved as video.
- **A profile:** click **Download everything** to collect its posts, reels, current stories and highlights. **Posts & reels**, **All highlights**, and **Current stories** are also available separately. The tagged tab still refers to the profile's own media; tagged posts are not collected.
- **A highlight:** open it and click **Entire highlight**. **Download this story** saves the currently identified item; if Instagram does not expose an item ID, Getter can save a visible direct media URL. Some streamed highlight videos cannot be identified individually; use **Entire highlight** in that case.
- Click **−** to minimize the floating panel, or **Folder & download manager** to see progress.
- Use **Stop & clear queue** to stop collection and pending file transfers. Completed files stay in the folder. Start the same download again to skip existing files.

Keep the Instagram tab and Getter's pinned manager tab open until downloads finish. You can use other tabs. Refreshing or closing the source Instagram tab interrupts its active job. If the manager is reloaded, queued work can restart from the beginning, skipping completed files. Closing Chrome clears the session queue; start a download again after reopening.

The manager also has buttons for the connected Instagram page. Click **Refresh** there if you have navigated to a different profile or post.

## File organization

```text
Your selected folder/
  username/
    posts/
      2026-09-22_123456789_1.jpg
      2026-09-22_123456790_2.mp4
    stories/
      2026-09-22_123456791.mp4
    highlights/
      Summer_987654321/
        2026-09-22_123456792.jpg
```

Getter selects the largest downloadable image or video rendition provided by Instagram. The actual response format determines the file extension, so some images are saved as WebP or AVIF. Existing nonempty files with the same generated name are skipped and never overwritten. Incomplete new files are removed when a transfer fails; an abrupt browser crash can leave an empty file, which the next attempt can replace.

## Scope and limitations

This extension uses Instagram's internal web endpoints with the session already open in your Instagram tab. These are undocumented and can change or be restricted per account. Bulk collection is best effort: pagination errors, unavailable sections, missing video URLs, rate limits, and login challenges are reported as **Incomplete**, not as successful full downloads. Getter stops on access checks and rate limits instead of retrying around them.

“Everything” means the accessible posts, reels, current stories and highlights returned for that profile. It does not include DMs, deleted or expired stories, private media your account cannot access, archives, live streams, or tagged posts. Music stickers and other interactive story overlays may not be embedded in the underlying downloaded media.

There is no password entry or cookie export. The extension sends authenticated media-list requests only to Instagram. File requests go directly to Instagram's CDN without account credentials. There is no analytics or upload server. Only the folder handle and the last 20 download summaries are retained locally; pending jobs and their temporary media URLs live in Chrome's session storage. This is an independent extension, not affiliated with Instagram.

## Development and verification

The extension uses vanilla JavaScript and Manifest V3. Runtime files are in `extension/`; load that folder directly.

```sh
npm install
npm test
npx playwright install chromium
npm run test:browser
npm run package
```

The ZIP is written to `dist/Getter-Chrome.zip`. To use an existing compatible Chrome for Testing installation for browser tests, set `GETTER_CHROMIUM_PATH` to its executable path.

Automated browser tests load the real extension in an isolated browser profile, mock Instagram and CDN responses, and write through real Chrome filesystem handles into that profile's origin-private test storage. They verify the queue, pagination, all media categories, carousel videos, cancellation, duplicate skipping, rate-limit handling, and the single-manager lock. Screenshots are written to `artifacts/`. These fixtures do **not** establish that every endpoint currently works with a real logged-in Instagram account; that requires a live account check after installation.

Implementation references: [Chrome File System Access](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access), [Chrome extension network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests), and [Instaloader's highlight endpoint migration](https://github.com/instaloader/instaloader/pull/2672/files).
