# Offline episode browser demo

This fixture runs the actual built `Web/InPlayerPreview.js` against a synthetic Jellyfin API. All show names, episode descriptions and artwork are fictional. It does not connect to a Jellyfin server or play real video.

From `Namo.Plugin.InPlayerEpisodePreview`:

```sh
npm install
npx webpack
node demo/server.cjs
```

Open `http://127.0.0.1:4173/demo/index.html#/video`. Press Down to open, Left/Right to browse all seasons, Up to close, and Enter to simulate playback. The top-right controls switch between TV and desktop layouts. Desktop uses the original player button and popup.

Browser regression checks:

```sh
npx playwright install chromium
npx playwright test
```

Playwright starts the local server automatically. Rebuild the bundle after editing source. Tests cover remote commands, season/show boundaries, playback and loading failures, route cleanup, desktop behavior, other dialogs, missing metadata, and safe text rendering.

For manual edge cases, add `?scenario=missing` or `?scenario=unsafe` before `#/video`. `?layout=desktop` starts in desktop mode. The fixture's `window.__demo` object also exposes `delayMs`, `failLoad`, and `failPlay` switches for loading and failure checks.
