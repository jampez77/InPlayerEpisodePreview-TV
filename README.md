# In Player Episode Preview — TV edition

A TV-friendly fork of [Namo2/InPlayerEpisodePreview](https://github.com/Namo2/InPlayerEpisodePreview), based on upstream commit `015c57b`. The original Jellyfin server plugin and desktop episode preview are retained. TV layouts get a large, remote-controlled episode browser over the playing video.

![TV episode browser using fictional demo content](Images/tv-preview.png)

## Controls

| Layout | Action |
| --- | --- |
| TV | **Down** opens the browser on the playing episode. |
| TV | **Left / Right** selects the previous / next episode, across season boundaries. |
| TV | **Up**, **Back**, or **Escape** closes and returns to the player. |
| TV | **OK / Enter** plays or resumes the selected episode; selecting the playing episode returns to it. |
| Desktop / mobile | Use the original **Episode Preview** button in the player. |

The TV panel shows the series, season number and name, episode number and title, description, thumbnail, watch progress, and neighboring episodes. At either end of the show, navigation wraps to the other end, with an explicit on-screen message. Specials come first as Season 0. Missing/virtual episodes are omitted; a one-episode show stays on that episode. Browsing leaves playback running.

TV mode follows Jellyfin's **Display → Layout → TV** setting (`layout-tv`), not screen size. The button is absent in TV mode. The browser handles both keyboard input and Jellyfin's remote command events; other dialogs retain their controls. Existing spoiler-blur settings apply to the TV panel.

## Client compatibility

This extends **Jellyfin Web** and clients using the server's web interface, including Jellyfin Media Player. It does not modify independently implemented native player screens such as the native Android TV player. The inherited server integration has targets for Jellyfin 10.10.7, 10.11.x, and 12.x; choose the package matching your server.

## Install this build

1. Build a ZIP with the instructions below, or use the matching ZIP in `dist/` from this workspace.
2. Stop Jellyfin and back up any existing InPlayerEpisodePreview plugin folder.
3. Extract `Namo.Plugin.InPlayerEpisodePreview.dll` into a folder under Jellyfin's configured `plugins` directory. Replace the existing plugin DLL if already installed; do not keep two copies. This fork deliberately retains the original plugin ID and settings.
4. Restart Jellyfin and refresh/reload the web client. Enable the TV layout on the client, start an episode, and press **Down**.

The original [File Transformation plugin](https://github.com/IAmParadox27/jellyfin-plugin-file-transformation) is recommended for injecting the web script without directly modifying `index.html`. The upstream injector remains in place. The inherited `manifest.json` points to **upstream releases**, not this fork. Installing from it will not install these TV changes. A separately hosted repository manifest is needed before distributing this fork through Jellyfin's plugin catalogue.

## Build and verify

Requires Node.js 22+, npm, a .NET SDK capable of building the selected target (net8.0, net9.0, or net10.0), and Python 3 for packaging.

```sh
cd Namo.Plugin.InPlayerEpisodePreview
npm ci
npm run typecheck
npm test
npx playwright install chromium
npm run test:browser
cd ..

# Defaults to Jellyfin 10.11.0; creates a single-DLL ZIP in dist/.
bash scripts/package-plugin.sh 10.11.0
# Other supported targets:
bash scripts/package-plugin.sh 10.10.7
bash scripts/package-plugin.sh 12.0.0
```

`Web/InPlayerPreview.js` is the generated production bundle embedded in the DLL. Run `npm run build` after changing TypeScript or CSS. `npx webpack --mode development` produces a development bundle with a separate source map.

Tests cover episode pagination, ordering, season transitions, whole-show wrapping, remote and keyboard commands, playback errors, dialog/focus handling, asynchronous cancellation, and the desktop button. Browser tests run against a mocked Jellyfin API; a physical remote and a live server are still needed for device-specific validation.

## Try the UI locally

```sh
cd Namo.Plugin.InPlayerEpisodePreview
npm run build
npm run demo
```

Open [the offline demo](http://127.0.0.1:4173/demo/index.html#/video), then press **Down**. Switch between TV and desktop using the controls at the top. The demo uses fictional episodes and local artwork; it does not connect to or control a Jellyfin server.

## Credits and license

Original plugin by [Namo2 and contributors](https://github.com/Namo2/InPlayerEpisodePreview). TV navigation and presentation are local modifications. The original [MIT license](LICENSE.md) and copyright notice are preserved.
