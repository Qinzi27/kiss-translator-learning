# KISS Translator · Bilingual Learning Edition

[中文](README.md) · [Release downloads](../../releases) · [Setup guide](START-HERE.md) · [Validation record](VALIDATION.md)

Click the floating button on a regular webpage to keep the original text and append a translation below it. Click again to hide the translation. This edition focuses on English–Chinese reading, with online services and a separately prepared local Argos engine.

Current version: **`2.0.36-learning.7` (prerelease)**. This version adds an **插件更新** panel in Options and customizable status colors and icons for the webpage and PDF floating buttons. The Python updater, PDF reader, two-page pretranslation, session cache and earlier security fixes remain available. The new Chrome directory-update flow has not completed real installed-extension end-to-end testing. See [update instructions](UPDATING.md) and [security and migration notes](SECURITY.md).

This is an independent learning fork of [KISS Translator by Gabe / fishjar and contributors](https://github.com/fishjar/kiss-translator), based on version 2.0.32. **It is not an official release from the upstream author.** Upstream attribution and the [GPL-3.0 license](LICENSE) are retained.

The PDF reader uses bundled Mozilla PDF.js 6.3.289. **Chrome 151+** can open top-level PDFs directly in this reader through the official MIME handler API, retaining the original address. Embedded PDFs are excluded. Opening a PDF only reads and displays its original text; translation starts after an explicit action. Native stream handling also supports local files without enabling file-URL access. The reader offers controls to disable automatic handling or return to Chrome's native viewer. Availability in other browsers depends on their API support. [Chrome API documentation](https://developer.chrome.com/docs/extensions/reference/api/mimeHandler)

On older browsers, or with handling disabled, use “翻译当前 PDF” in the popup or Alt/Option + Q. This manual route still needs file-URL permission to read a local URL directly; selecting the file through “选择 PDF 并翻译” does not. The reader compares the original canvas with extracted bilingual text and supports page/document translation and stopping. There is no OCR or translated-PDF export. See the [PDF guide](docs/PDF-READER.md).

Clicking page translation also enables automatic page translation and pretranslates the next two pages, with at most two concurrent requests. Page changes reprioritize queued work while preserving requests already in flight. Stopping or opening another document cancels the run and ignores late results. Whole-document mode prioritizes the current page, then processes other pages, skipping cache hits. Completed translations use an LRU session cache capped at 80 pages and 8 MiB. Reopening the same document with the same service configuration can restore cached translations; refresh never resumes sending automatically. Files chosen manually must be selected again after refresh. Extension `storage.session` clears when the browser session ends. Web preview uses `sessionStorage`, which may survive browser tab restoration and has a different lifetime.

## What is included

- **MyMemory:** limited anonymous online translation without an account, email or API key. Real English–Chinese requests and bilingual rendering in the browser development environment have been verified. It is not a chat model and does not use the AI translation Skill.
- **Eight AI API presets:** Doubao, Kimi, DeepSeek, Qwen, GLM, Tencent Hunyuan, SiliconFlow and OpenRouter. Bring your own key and enabled model; free models, trial credits and paid API usage are distinct.
- **Custom AI API:** an OpenAI Chat Completions compatible endpoint, plus a fixed translation Skill with optional terminology and style preferences.
- **Local Argos:** English–Chinese inference after downloading dependencies and models. Neither release ZIP contains those dependencies or models.
- **Experimental Doubao / Kimi webpage mode:** uses the same browser profile's login session in a dedicated background tab. Real logged-in website compatibility has not been validated.

Webpage and PDF floating buttons show actual request activity with a progress ring, a completion check or an error icon. The PDF ring contains a stop square; the webpage button preserves its configured stop/menu behavior. In **概览 → 悬浮翻译按钮颜色**, choose idle, busy and completed colors or enter six-digit hex values. Valid edits save automatically and synchronize with open reading pages. Foregrounds switch to high-contrast black or white; resetting colors preserves position, visibility and click behavior. Reduced-motion preferences are respected.

## Install or update

1. Download `kiss-translator-learning-chrome.zip` from this repository's [Releases](../../releases) and extract it.
2. Open `chrome://extensions` or `edge://extensions` and enable Developer mode.
3. Choose **Load unpacked** and select the extracted **`chrome` folder**, which directly contains `manifest.json`.
4. Refresh a regular webpage and click the floating translation button, or press `Alt + Q` (`Option + Q` on Mac).

The same Release provides separate `SHA256SUMS.txt` and `release-manifest.json` files. Verify the downloaded extension or source ZIP against its SHA-256 checksum; the manifest records the version, source commit and artifact details. See [release notes](RELEASE-NOTES.md).

For a Chrome Developer mode installation, open **插件更新** in Options. First choose and grant access to the actual loaded `chrome` folder. A random plaintext nonce file is written, read through this extension's URL and removed to distinguish the installed directory from an identical copy. Click **检查更新**, **下载并更新**, then explicitly **重新加载插件** and refresh reading tabs. No Python, Git, Node.js, token or additional manifest permission is required; the browser's directory read/write consent is still required.

The browser updater verifies downloads before saving one rollback backup in the extension's IndexedDB, limited to 64 MiB of old file contents. It then replaces files individually, committing entry points last. **This is not an atomic whole-directory replacement.** Errors trigger a recovery attempt; closing the page, power loss or external file edits may require manual recovery before reloading. Requests target this fixed repository's public GitHub releases and allowed attachment-CDN redirects without login credentials or translation keys. Offline-only mode blocks browser update checks and downloads. The real Chrome File System Access permission/write/recovery/reload flow remains unverified; current coverage uses synthetic filesystem, storage and UI tests plus build checks. See [UPDATING.md](UPDATING.md).

The Python updater remains available: double-click `更新插件.command` on macOS or `更新插件.bat` on Windows beside `chrome`, with Python 3.9+ installed. Reload the extension afterward. **Never run the browser and Python updaters simultaneously**; their locks and backups are separate, and the extension's offline policy does not control the external Python process. Existing settings usually remain; missing presets can be added without clearing them. The upstream store extension is a different release.

Open **AI 翻译向导** in Options to try the MyMemory card, add a service, or configure an AI API. Tests send a disclosed synthetic sentence only when clicked. Saving an AI configuration does not send that sentence. After adding a service, refresh the reading page and select it in the translation panel. See the [Chinese setup guide](START-HERE.md) for global rules and offline preparation.

## Build and test

From the repository root or extracted source package, with Node.js and pnpm installed:

```sh
pnpm install --frozen-lockfile
pnpm build:chrome
```

Use Node.js 24 / pnpm 11 for the current source with PDF.js. Load `build/chrome`. An extracted source ZIP can build the extension, but it has no `.git` directory. The packaging script needs Git's file inventory, so use a cloned repository to regenerate release packages. After building in that clone, run:

```sh
python3 src/scripts/package-learning.py
```

The script writes the extension and corresponding GPL source ZIPs, plus separate checksum and release manifest files, into `releases/`. See [VERSION_MANAGEMENT.md](VERSION_MANAGEMENT.md) for the release workflow.

For targeted automated tests, offline setup and optional live API checks, see [VALIDATION.md](VALIDATION.md). Live checks send synthetic text and consume the selected service's quota; normal automated tests use mocks.

## Validation limits

Earlier real MyMemory and Argos inference checks include Argos in a macOS process denied network access by the operating system. PDF Web preview checks loaded an eight-page arXiv paper and translated its first 32 paragraphs through MyMemory with Google blocked; a later synthetic three-page PDF checked page changes and stopping. These are separate rounds, not proof of the new native flow. The 200-paragraph full-document job was stopped, not completed; no new Argos PDF end-to-end check was performed.

The learning.5 MIME, pretranslation and cache paths have synthetic tests and build checks; see the validation record for results. The installed Chrome 153 native MIME flow has **not** been accepted in a real extension session. Private PDFs are not included in public release artifacts or fixtures.

Learning.7 browser-update tests simulate atomic individual-file closes, durable IndexedDB commits, failed writes, cancellation, rollback, external edits, directory probes and size limits. These tests do not establish that real Chrome folder permissions, disk transactions or recovery after power loss work end to end.

The eight AI APIs were not called with user account keys. Background webpage tests use DOM fixtures, not real logged-in sessions. No claim is made about mainland China network reachability, indefinite availability or unlimited free usage. Splitting rich text can preserve formatting while reducing translation fluency.

The offline policy restricts the extension's built-in request layer. It does not turn cloud services into local models or control the webpage's own network traffic. Prepare models and load or save the page before offline use.

## Documentation and attribution

- [START-HERE.md](START-HERE.md): installation, service switching and Argos preparation.
- [UPDATING.md](UPDATING.md): browser updates, directory authorization, recovery and the retained Python tool.
- [docs/PDF-READER.md](docs/PDF-READER.md): PDF handling, pretranslation, session storage and limits.
- [AI-SERVICES.md](AI-SERVICES.md): API configuration, billing labels and experimental webpage mode.
- [TRANSLATION-SKILL.md](TRANSLATION-SKILL.md): fixed translation instructions and limits.
- [VALIDATION.md](VALIDATION.md): evidence, test results and reproduction commands.
- [offline/README.md](offline/README.md): Argos preparation, local service and offline verification.
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md): installation and translation troubleshooting.
- [VERSION_MANAGEMENT.md](VERSION_MANAGEMENT.md): versioning, packaging and publication.
- [RELEASE-NOTES.md](RELEASE-NOTES.md): changes, release artifacts and checksums.
- [MyMemory live receipt](validation/free-api-live.json) and [Argos offline receipt](offline/verified-offline.json).
- [Upstream base commit](https://github.com/fishjar/kiss-translator/commit/2656f564dde5b271a8d3fb31e951a8457e8df41c) and [its original README](https://github.com/fishjar/kiss-translator/blob/2656f564dde5b271a8d3fb31e951a8457e8df41c/README.md).

Learning-edition changes remain under [GPL-3.0](LICENSE). Releases provide the corresponding source and license. The source ZIP excludes Git history, account configuration, dependency folders and downloaded models. Please report learning-edition issues to this repository.
