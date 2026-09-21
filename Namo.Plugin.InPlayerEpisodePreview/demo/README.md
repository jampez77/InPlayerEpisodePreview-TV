# TV Edition offline demo

Try the TV and desktop interfaces without a Jellyfin server. The demo runs the actual built `Web/InPlayerPreview.js` against a simulated Jellyfin API. Show names, episode descriptions, and artwork are fictional; playback is simulated.

This is part of [In Player Episode Preview — TV Edition](https://github.com/jampez77/InPlayerEpisodePreview-TV), an independent fork inspired by and based on [Namo2's original plugin](https://github.com/Namo2/InPlayerEpisodePreview).

## Run locally

From `Namo.Plugin.InPlayerEpisodePreview`:

```sh
npm ci
npm run build
npm run demo
```

Open the [TV demo](http://127.0.0.1:4173/demo/index.html#/video). Press **Down** to open, **Left / Right** to browse across seasons, **Up** to close, and **Enter** to simulate playback. Moving beyond either end of the show wraps to the opposite end.

Open the [desktop demo](http://127.0.0.1:4173/demo/index.html?layout=desktop#/video) to use the original player button and popup. The controls at the top also switch layouts.

Rebuild with `npm run build` after changing plugin source. The demo listens only on `127.0.0.1` and loads its artwork locally.

## Browser regression checks

```sh
npx playwright install chromium
npm run test:browser
```

The test command rebuilds the bundle, and Playwright starts the local demo server automatically. Tests cover remote commands, season and show boundaries, playback and loading failures, route cleanup, desktop behavior, other dialogs, missing metadata, and safe text rendering.

These checks validate the simulated environment. They do not replace testing with a live Jellyfin server, client, and physical remote.

## Manual scenarios

Add query parameters before `#/video`:

| Parameter | Scenario |
| --- | --- |
| `?layout=desktop` | Start with the desktop layout. |
| `?scenario=missing` | Show episodes with missing metadata. |
| `?scenario=unsafe` | Exercise safe rendering of text containing markup. |

The fixture's `window.__demo` object also exposes `delayMs`, `failLoad`, and `failPlay` switches for loading and failure checks.

For installation, compatibility, and upstream attribution, see the [project README](../../README.md).
