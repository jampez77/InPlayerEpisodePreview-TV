# TV Edition offline demo

Try the TV and desktop interfaces without a Jellyfin server. The demo runs the actual built `Web/InPlayerPreview.js` against a simulated Jellyfin API. Shows, films, channels, programme descriptions, and artwork are fictional; playback is simulated. No account or server connection is needed.

**[Open the live demo](https://jampez77.github.io/InPlayerEpisodePreview-TV/demo/index.html#/video)** · [Movies](https://jampez77.github.io/InPlayerEpisodePreview-TV/demo/index.html?media=movie#/video) · [Live TV](https://jampez77.github.io/InPlayerEpisodePreview-TV/demo/index.html?media=live-tv#/video) · [Desktop](https://jampez77.github.io/InPlayerEpisodePreview-TV/demo/index.html?layout=desktop#/video)

This is part of [In Player Episode Preview — TV Edition](https://github.com/jampez77/InPlayerEpisodePreview-TV), an independent fork inspired by and based on [Namo2's original plugin](https://github.com/Namo2/InPlayerEpisodePreview).

## Run locally

From `Namo.Plugin.InPlayerEpisodePreview`:

```sh
npm ci
npm run build
npm run demo
```

Open the [TV demo](http://127.0.0.1:4173/demo/index.html#/video). Press **Down** to open, **Left / Right** to browse, **Up** to close, and **Enter** to simulate playback. Browsing leaves the playing item unchanged until you select a different item. Selecting the current item returns to playback.

Use the content buttons at the top, or open a mode directly:

| Demo | What to try |
| --- | --- |
| [Episodes](http://127.0.0.1:4173/demo/index.html#/video) | Browse through both seasons, then wrap from the last episode to the first. |
| [Movies](http://127.0.0.1:4173/demo/index.html?media=movie#/video) | Start on the playing film, browse two similar films, and resume **A Map of Silence**. The list wraps back to the current film. |
| [Live TV](http://127.0.0.1:4173/demo/index.html?media=live-tv#/video) | Browse three numbered channels and their current programmes. **Field Notes** demonstrates missing guide data. Select **Watch channel** to simulate tuning. |
| [Pre-roll](http://127.0.0.1:4173/demo/index.html?scenario=preroll#/video) | An intro and trailer precede **The Last Meridian**. Press **Down** to browse the upcoming film and its recommendations. **Up next** distinguishes the feature from the intro currently playing. **Up** leaves the intro running; selecting **Play film** starts the feature. |

Open the [desktop demo](http://127.0.0.1:4173/demo/index.html?layout=desktop#/video) to use the original episode player button and popup. Switching to **Desktop** selects the episode example. Selecting **Movies** or **Live TV** switches to the TV layout; the new film and channel browsers are TV features.

Rebuild with `npm run build` after changing plugin source. The local server listens only on `127.0.0.1`. The public demo uses the same static files, with relative asset paths suitable for GitHub Pages project hosting. All artwork is included in the demo folder.

## Browser regression checks

```sh
npx playwright install chromium
npm run test:browser
```

The test command rebuilds the bundle, and Playwright starts the local demo server automatically. Tests cover remote commands, season and show boundaries, similar-film order and resume playback, channel navigation and explicit tuning, missing programme data, playback and loading failures, route cleanup, desktop behavior, other dialogs, missing metadata, and safe text rendering.

These checks validate the simulated environment. They do not replace testing with a live Jellyfin server, client, and physical remote.

The webOS regression checks remove CSS features unavailable in webOS 6's Chromium 79 engine and send numeric remote key events. They check that the panel stays on-screen, artwork keeps its shape, and Down/Left/Right/Up navigation works. They simulate these specific limitations in Chromium rather than running a webOS emulator.

The [public pre-roll demo](https://jampez77.github.io/InPlayerEpisodePreview-TV/demo/index.html?scenario=preroll#/video) simulates the authenticated session queue used to find the next supported film or episode. The [standalone trailer example](https://jampez77.github.io/InPlayerEpisodePreview-TV/demo/index.html?scenario=trailer-no-feature#/video) has no queued feature: no panel appears, and the player's normal controls remain available.

## Manual scenarios

Add query parameters before `#/video`:

| Parameter | Scenario |
| --- | --- |
| `?layout=desktop` | Start with the desktop layout. |
| `?media=movie` | Start with the playing film and similar-film recommendations. |
| `?media=live-tv` | Start with live channels and current programme information. |
| `?media=live-tv&native-playback=1` | Simulate Jellyfin's local channel action, including remote OK and pointer activation. Without this option the demo exercises the session-command fallback. |
| `?scenario=preroll` | Start an intro before a queued film. Add `&media=episode` to preview an upcoming episode instead. |
| `?scenario=trailer-no-feature` | Play a trailer without a known queued feature; no preview panel or error is shown. |
| `?scenario=missing` | Show the current episode, film, or channel with missing metadata; combine with a media parameter. |
| `?scenario=unsafe` | Exercise safe rendering of text containing markup. |

The fixture's `window.__demo` object also exposes `episodes`, `seasons`, `movies`, `channels`, `intros`, `playbackQueue`, `playingItemId`, `setPlaying(id)`, `delayMs`, `failLoad`, and `failPlay` for metadata, loading, and playback checks. The session's `playingItemId` is independent of the player controls' `data-id`, so tests can simulate an OSD that is still initializing. `playRequests` records simulated selections so tests can distinguish browsing from playing. In the pre-roll example, `setPlaying('movie-1')` simulates the feature starting naturally after the intro.

Channel tests also use `nativePlayRequests`, `channelTuneDelayMs`, and `ignorePlay` to distinguish accepted commands from actual playback. `ignorePlay` suppresses playback for either action path; `stallPlay` leaves the fallback HTTP request pending. A delayed tune keeps **Tuning channel…** visible; an accepted or stalled command that never starts the channel offers a retry after 20 seconds. Closing the panel cancels confirmation polling. These cases simulate the host's action contract and do not verify real tuner playback on an LG TV.

For installation, compatibility, and upstream attribution, see the [project README](https://github.com/jampez77/InPlayerEpisodePreview-TV#readme).
