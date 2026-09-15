# KISS Translator · Bilingual Learning Edition

[中文](README.md) · [Release downloads](../../releases) · [Setup guide](START-HERE.md) · [Validation record](VALIDATION.md)

Click the floating button on a regular webpage to keep the original text and append a translation below it. Click again to hide the translation. This edition focuses on English–Chinese reading, with online services and a separately prepared local Argos engine.

Current version: **`2.0.33-learning.4`**. This security update disables JavaScript hooks and the external userscript settings bridge, sanitizes settings exports/sync, and requires a local pairing token for Argos. See [security and migration notes](SECURITY.md).

This is an independent learning fork of [KISS Translator by Gabe / fishjar and contributors](https://github.com/fishjar/kiss-translator), based on version 2.0.32. **It is not an official release from the upstream author.** Upstream attribution and the [GPL-3.0 license](LICENSE) are retained.

## What is included

- **MyMemory:** limited anonymous online translation without an account, email or API key. Real English–Chinese requests and bilingual rendering in the browser development environment have been verified. It is not a chat model and does not use the AI translation Skill.
- **Eight AI API presets:** Doubao, Kimi, DeepSeek, Qwen, GLM, Tencent Hunyuan, SiliconFlow and OpenRouter. Bring your own key and enabled model; free models, trial credits and paid API usage are distinct.
- **Custom AI API:** an OpenAI Chat Completions compatible endpoint, plus a fixed translation Skill with optional terminology and style preferences.
- **Local Argos:** English–Chinese inference after downloading dependencies and models. Neither release ZIP contains those dependencies or models.
- **Experimental Doubao / Kimi webpage mode:** uses the same browser profile's login session in a dedicated background tab. Real logged-in website compatibility has not been validated.

## Install or update

1. Download `kiss-translator-learning-chrome.zip` from this repository's [Releases](../../releases) and extract it.
2. Open `chrome://extensions` or `edge://extensions` and enable Developer mode.
3. Choose **Load unpacked** and select the extracted **`chrome` folder**, which directly contains `manifest.json`.
4. Refresh a regular webpage and click the floating translation button, or press `Alt + Q` (`Option + Q` on Mac).

The same Release provides separate `SHA256SUMS.txt` and `release-manifest.json` files. Verify the downloaded extension or source ZIP against its SHA-256 checksum; the manifest records the version, source commit and artifact details. See [release notes](RELEASE-NOTES.md).

To update, keep the loaded folder path, replace its extension files with the new version, click **Reload** in the extension manager, and refresh reading tabs. Existing settings usually remain; missing new presets can be added without clearing them. The upstream store extension is a different release.

Open **AI 翻译向导** in Options to try the MyMemory card, add a service, or configure an AI API. Tests send a disclosed synthetic sentence only when clicked. Saving an AI configuration does not send that sentence. After adding a service, refresh the reading page and select it in the translation panel. See the [Chinese setup guide](START-HERE.md) for global rules and offline preparation.

## Build and test

From the repository root or extracted source package, with Node.js and pnpm installed:

```sh
pnpm install --frozen-lockfile
pnpm build:chrome
```

The existing build was validated with Node.js 20 / pnpm 11. Load `build/chrome`. An extracted source ZIP can build the extension, but it has no `.git` directory. The packaging script needs Git's file inventory, so use a cloned repository to regenerate release packages. After building in that clone, run:

```sh
python3 src/scripts/package-learning.py
```

The script writes the extension and corresponding GPL source ZIPs, plus separate checksum and release manifest files, into `releases/`. See [VERSION_MANAGEMENT.md](VERSION_MANAGEMENT.md) for the release workflow.

For targeted automated tests, offline setup and optional live API checks, see [VALIDATION.md](VALIDATION.md). Live checks send synthetic text and consume the selected service's quota; normal automated tests use mocks.

## Validation limits

Real MyMemory and Argos inference have been checked, including Argos in a macOS process denied network access by the operating system. Browser checks used the **Web development environment**. The final Chrome package has been built but has not been installed and accepted in a real extension environment.

The eight AI APIs were not called with user account keys. Background webpage tests use DOM fixtures, not real logged-in sessions. No claim is made about mainland China network reachability, indefinite availability or unlimited free usage. Splitting rich text can preserve formatting while reducing translation fluency.

The offline policy restricts the extension's built-in request layer. It does not turn cloud services into local models or control the webpage's own network traffic. Prepare models and load or save the page before offline use.

## Documentation and attribution

- [START-HERE.md](START-HERE.md): installation, service switching and Argos preparation.
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
