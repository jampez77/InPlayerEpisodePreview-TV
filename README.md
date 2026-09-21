<p align="center">
  <img src="Images/tv-logo.png" alt="In Player Episode Preview TV Edition logo" width="180">
</p>

# In Player Episode Preview — TV Edition

Browse episodes, discover similar films, and switch live TV channels without leaving the Jellyfin player. Open a remote-friendly panel, explore what to watch next, and keep your place in the video.

Inspired by and based on [Namo2's InPlayerEpisodePreview](https://github.com/Namo2/InPlayerEpisodePreview), this independent fork adds a TV interface while retaining the original desktop and mobile preview. It is maintained separately from the upstream project and is not an official upstream release.

[Try the interactive demo](https://jampez77.github.io/InPlayerEpisodePreview-TV/demo/index.html#/video) · [Download the latest release](https://github.com/jampez77/InPlayerEpisodePreview-TV/releases/latest) · [Report an issue](https://github.com/jampez77/InPlayerEpisodePreview-TV/issues) · [Original project](https://github.com/Namo2/InPlayerEpisodePreview)

![TV episode browser showing fictional demo content](Images/tv-preview.png)

*TV layout. All screenshots use fictional content and local demo artwork.*

## Browse with your remote

| Control | Action |
| --- | --- |
| **Down** | Open the browser on the playing episode, film, or channel. |
| **Left / Right** | Browse episodes, similar films, or live TV channels. |
| **Up**, **Back**, or **Escape** | Close the browser and return to the player. |
| **OK / Enter** | Play or resume the selection, or tune to the selected channel. Selecting the playing item returns to it. |

### Episodes

Each selection shows the series, season number and name, episode number and title, description, thumbnail, watch progress, and neighboring episodes. Generic season names such as “Series 1” or “Chapter 1” are shown once as “Season 1”; descriptive season names are preserved. Browsing leaves playback running, and the existing spoiler-blur settings apply.

Seasons form one continuous list. Moving past the final episode wraps to the first, and moving back from the first wraps to the last. An on-screen message makes the transition clear. Specials appear first as Season 0; unavailable virtual episodes are omitted. A show with one episode stays on that episode.

![TV browser wrapping from the first episode to the last](Images/tv-wrap-preview.png)

*Whole-show wrapping in the fictional demo.*

### Movies

Open the panel during a film to see the current film followed by up to 30 similar films from your Jellyfin library. Recommendations come from Jellyfin's similar-items API. Left and Right browse the list, wrapping at either end; a film with no recommendations remains available on its own.

Each film shows its title, description, artwork, and available year, runtime, and playback progress. Browsing keeps the current film playing until you select another with **OK / Enter**.

![Similar films in the TV browser](Images/movie-preview.png)

### Pre-rolls and trailers

During a pre-roll or trailer, the TV panel uses Jellyfin's playback queue to show the upcoming film or episode, marked **Up next**. Its artwork, description, and browsing options are the same as during the feature. Opening the panel leaves the intro playing; **OK / Enter** starts the selected feature.

When Jellyfin cannot identify the upcoming feature, the panel stays hidden instead of showing an episode-loading error.

### Live TV

Open the panel during live TV to browse the channels available to your Jellyfin account. Each selection identifies the channel and shows its current programme, description, and artwork when supplied by the server. Left and Right wrap through the channel list; **OK / Enter** tunes to the selected channel. Browsing alone does not change the channel.

Live TV requires channels already configured and working in Jellyfin. Programme information depends on your guide data; the channel name remains visible when programme details are unavailable.

Channel selection uses Jellyfin's local player action where available, including in the LG webOS app, with the authenticated session command as a fallback. The button shows **Tuning channel…** while waiting for Jellyfin to report the selected channel. If it does not start within 20 seconds, the selection stays open with a retry message. Both the remote's **OK** button and pointer clicks use this action.

![Live TV channel browser with current programme details](Images/live-tv-preview.png)

### Desktop and mobile

TV mode follows Jellyfin's **Display → Layout → TV** setting. The player button is hidden in TV mode; desktop and mobile layouts keep the original **Episode Preview** button and episode popup. Movie and live TV browsing are available in TV mode.

![Desktop episode preview with fictional demo episodes](Images/desktop-preview.png)

*Desktop layout with the original player button and episode preview.*

## Compatibility

This is a **Jellyfin server plugin that extends Jellyfin Web**. The TV interface works in clients using the server's web player, including Jellyfin Media Player with the TV layout selected. It does not add a panel to independently implemented native players, such as the native Android TV player.

The [official LG webOS app](https://github.com/jellyfin/jellyfin-webos) also loads the server's web interface. The TV panel uses positioning, thumbnail sizing, and spacing compatible with [webOS 6's Chromium 79 engine](https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine). If updating on an LG TV, fully close and reopen the Jellyfin app after restarting the server so it loads the updated script.

| Jellyfin server | Release package target | Build framework |
| --- | --- | --- |
| 10.10.7 | 10.10.7 | .NET 8 |
| 10.11.x | 10.11.0 | .NET 9 |
| 12.x | 12.0 / 12.0.0 | .NET 10 |

Builds cover these three server targets. Automated browser tests use a simulated Jellyfin API and include webOS 6 CSS limitations and remote key codes; live-server and physical-remote testing remains outstanding. When reporting a problem, include the server version, client, layout setting, and steps to reproduce it.

## Install

### Through Jellyfin's plugin catalogue

Add the following repository URL in the Jellyfin dashboard's plugin repository settings:

```text
https://raw.githubusercontent.com/jampez77/InPlayerEpisodePreview-TV/main/manifest.json
```

Open the plugin catalogue and install **InPlayerEpisodePreview** from the TV Edition repository (owner **jampez77**, with the new cyan episode-card logo), then restart Jellyfin. Reload the web client, select the TV layout, start an episode, film, or live TV channel, and press **Down**.

**Replacing the original plugin:** this fork keeps the original plugin ID and settings. Install it as a replacement, not alongside a second copy. Use the TV Edition repository as the update source for this plugin and remove the original InPlayerEpisodePreview repository from your repository list to avoid competing updates. Back up your existing plugin folder before switching.

The inherited integration supports the [File Transformation plugin](https://github.com/IAmParadox27/jellyfin-plugin-file-transformation), which is recommended for loading the web script without directly modifying Jellyfin's `index.html`.

### Manual installation

1. Download the ZIP matching your server from [Releases](https://github.com/jampez77/InPlayerEpisodePreview-TV/releases/latest).
2. Stop Jellyfin and back up any existing InPlayerEpisodePreview plugin folder.
3. Extract `Namo.Plugin.InPlayerEpisodePreview.dll` into a folder under Jellyfin's configured `plugins` directory. Replace the existing plugin DLL if installed; do not leave two copies.
4. Restart Jellyfin and reload the web client. Choose the TV layout, start an episode, film, or live TV channel, and press **Down**.

The release ZIPs contain the plugin DLL. The assembly name remains unchanged for compatibility with the original plugin.

## Build and verify

Requires Node.js 22+, npm, Python 3 for packaging, and a .NET SDK supporting the server target above. The .NET 10 SDK can build all three targets.

```sh
git clone https://github.com/jampez77/InPlayerEpisodePreview-TV.git
cd InPlayerEpisodePreview-TV/Namo.Plugin.InPlayerEpisodePreview
npm ci
npm run typecheck
npm test
npx playwright install chromium
npm run test:browser
cd ..

# Creates the ZIP in dist/; 10.11.0 is also the default if omitted.
bash scripts/package-plugin.sh 10.11.0

# Other supported targets:
bash scripts/package-plugin.sh 10.10.7
bash scripts/package-plugin.sh 12.0.0
```

`Web/InPlayerPreview.js` is the generated production bundle embedded in the DLL. Run `npm run build` from the project directory after editing TypeScript or CSS. For a development bundle with a separate source map, run `npx webpack --mode development`.

Tests cover episode pagination and ordering, season transitions, whole-show wrapping, movies and similar recommendations, live TV channels and confirmed tuning, pre-roll playback queues, remote and keyboard commands, playback errors, player-exit focus and key cleanup, asynchronous cancellation, and the desktop button.

## Try the demo

No installation is needed for the [interactive browser demo](https://jampez77.github.io/InPlayerEpisodePreview-TV/demo/index.html#/video):

- [Episodes](https://jampez77.github.io/InPlayerEpisodePreview-TV/demo/index.html#/video) — browse seasons and wrap around the show.
- [Movies](https://jampez77.github.io/InPlayerEpisodePreview-TV/demo/index.html?media=movie#/video) — explore the current film and similar films.
- [Live TV](https://jampez77.github.io/InPlayerEpisodePreview-TV/demo/index.html?media=live-tv#/video) — browse channels and their current programmes.
- [Pre-roll](https://jampez77.github.io/InPlayerEpisodePreview-TV/demo/index.html?scenario=preroll#/video) — preview the upcoming film during an intro.
- [Desktop](https://jampez77.github.io/InPlayerEpisodePreview-TV/demo/index.html?layout=desktop#/video) — use the original episode preview button.

Press **Down** to open the TV panel, **Left / Right** to browse, **Up** to close, and **Enter** to select. The controls at the top switch media types and layouts.

The demo uses fictional content and local artwork. It runs the actual browser bundle against a simulated API; it does not connect to a Jellyfin server, stream live TV, or play real video. GitHub Pages publishes the demo from `main` whenever its source or browser bundle changes.

### Run locally

From the cloned repository:

```sh
cd Namo.Plugin.InPlayerEpisodePreview
npm ci
npm run build
npm run demo
```

Open the [local demo](http://127.0.0.1:4173/demo/index.html#/video). Use `?media=movie`, `?media=live-tv`, or `?layout=desktop` before `#/video` to start in a particular mode. See the [demo guide](Namo.Plugin.InPlayerEpisodePreview/demo/README.md) for test scenarios.

## Credits and license

The original **InPlayerEpisodePreview** plugin was created by [Namo2 and contributors](https://github.com/Namo2/InPlayerEpisodePreview). Their server integration, settings, episode data handling, and desktop preview provide the foundation for this project. This fork began from upstream commit [`015c57b`](https://github.com/Namo2/InPlayerEpisodePreview/commit/015c57b).

TV Edition adds remote navigation, a TV media panel, continuous browsing across seasons, whole-show wrapping, similar-film browsing, live TV channel navigation, and its accompanying demo and regression tests. The TV Edition logo and screenshots identify this fork; the original project's identity and authorship remain credited.

Distributed under the original [MIT license](LICENSE.md). The upstream license and copyright notice are preserved.
