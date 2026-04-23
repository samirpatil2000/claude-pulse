# Claude Pulse for Safari

Claude Pulse ships as a cross-browser Web Extension. The root `manifest.json`
already contains the Safari-specific settings, so the same source tree targets
Chrome, Firefox, and Safari.

Because Safari extensions must be distributed inside a macOS/iOS app, producing
a Safari build means wrapping the extension in an Xcode project using Apple's
`safari-web-extension-converter` tool.

## Requirements

- macOS 13 or later
- Xcode 15 or later (with Command Line Tools installed)
- Safari 16.4 or later on the target device

## Build (one-shot script)

From the repository root:

```sh
./safari/build.sh
```

This runs `xcrun safari-web-extension-converter` on the repository root and
writes the generated Xcode project to `safari/build/ClaudePulse/`. Open the
`.xcodeproj` inside that folder, then Build & Run.

## Build (manual)

If you prefer to run the converter yourself:

```sh
xcrun safari-web-extension-converter \
  --project-location safari/build \
  --app-name "Claude Pulse" \
  --bundle-identifier com.claudepulse.safari \
  --swift \
  --no-open \
  --force \
  .
```

Then open the generated project in Xcode and press ⌘R.

## Load the extension in Safari

1. In Safari, open **Settings → Advanced** and enable
   *"Show features for web developers"*.
2. Open **Settings → Developer** and enable
   *"Allow unsigned extensions"* (this must be re-enabled after each Safari
   restart for development builds).
3. Run the generated container app once from Xcode.
4. Open **Settings → Extensions**, enable **Claude Pulse**, and grant it access
   to `claude.ai`.

## Distributing

To ship through the Mac App Store you will need:

- A paid Apple Developer account.
- To set the container app's bundle identifier to one you own.
- Code-signing and notarization configured in Xcode's *Signing & Capabilities*
  tab.

The web-extension assets (manifest + `src/` + `icons/`) ship inside the app
bundle and are updated only when a new version of the app is released.

## What changed for Safari?

- `manifest.json` gained a `browser_specific_settings.safari` entry pinning the
  minimum Safari version to 16.4 (first release with full MV3 parity for the
  APIs this extension uses: `web_accessible_resources`, content-script
  injection, and the `browser.runtime.getURL` helper).
- No runtime code changes were needed — `bridge-client.js` already reads
  `globalThis.browser?.runtime || globalThis.chrome?.runtime`, which resolves
  to Safari's `browser` namespace automatically.
