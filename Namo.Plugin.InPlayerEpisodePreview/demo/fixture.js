/* Entirely local synthetic Jellyfin fixture. No server, account, or network API is used. */
(() => {
    const params = new URLSearchParams(location.search);
    if (!location.hash) history.replaceState(null, '', `${location.pathname}${location.search}#/video`);
    const episodes = [
        {Id: 'episode-1', Name: 'A Light on the Shore', ParentIndexNumber: 1, IndexNumber: 1, SeasonId: 'season-1', Overview: 'A radio engineer returns to the coast she left behind. An unexpected signal leads her to an abandoned lighthouse, where someone has kept the light burning.'},
        {Id: 'episode-2', Name: 'The Glass Station', ParentIndexNumber: 1, IndexNumber: 2, SeasonId: 'season-1', Overview: 'Beyond the last train stop, Mara discovers a station that appears on no map. As a storm gathers over the inlet, she must decide whether to follow the voice on the radio.'},
        {Id: 'episode-3', Name: 'Across the Quiet Water', ParentIndexNumber: 2, IndexNumber: 1, SeasonId: 'season-2', Overview: 'The first crossing brings the crew to an island of empty houses. A recording left in the harbour offers a clue to the missing expedition—and a reason to leave before dawn.'},
        {Id: 'episode-4', Name: 'The Road Back', ParentIndexNumber: 2, IndexNumber: 2, SeasonId: 'season-2', Overview: 'With the signal fading, Mara and Ivo retrace their journey through the mountains. At the far end of the valley, a familiar light promises a new beginning.'}
    ].map((item, index) => ({
        ...item, Type: 'Episode', MediaType: 'Video', SeriesId: 'demo-series', SeriesName: 'The Long Way Home',
        SeasonName: item.ParentIndexNumber === 1 ? 'The Far Coast' : 'Beyond the Signal',
        LocationType: 'FileSystem', ServerId: 'demo-server', RunTimeTicks: 28800000000,
        PremiereDate: '2026-01-01T00:00:00Z', ImageTags: {Primary: 'demo'}, PrimaryImageTag: 'demo',
        UserData: {Played: index === 0 || index === 3, IsFavorite: false, PlaybackPositionTicks: index === 2 ? 9000000000 : 0, PlayedPercentage: index === 2 ? 31.25 : 0}
    }));
    const seasons = [
        {Id: 'season-1', Name: 'The Far Coast', IndexNumber: 1, Type: 'Season'},
        {Id: 'season-2', Name: 'Beyond the Signal', IndexNumber: 2, Type: 'Season'}
    ];
    const settings = {
        EnabledItemTypes: [28, 5, 13, 35], BlurDescription: false, BlurThumbnail: false,
        EpisodePageSize: 10, ShowWatchedCount: true, WatchCountDisplayMode: 0,
        SearchContainingCollections: false, OnlyBlurUnwatched: false, ShowWatchProgress: true,
        ExpandAllItems: false, ExpandedItemLayout: 0, AutoClosePreview: true, LogLevel: 2
    };
    const clone = value => JSON.parse(JSON.stringify(value));
    const demo = window.__demo = {
        episodes, seasons, settings, calls: [], playRequests: [], playerCommands: [],
        delayMs: 0, failPlay: false, failLoad: false, ready: false,
        async wait() {
            if (this.delayMs) await new Promise(resolve => setTimeout(resolve, this.delayMs));
            if (this.failLoad) throw new Error('Synthetic episode load failure');
        },
        setPlaying(id) {
            const item = episodes.find(episode => episode.Id === id);
            if (!item) throw new Error('Unknown demo item');
            document.querySelector('.btnUserRating').dataset.id = id;
            document.getElementById('demo-playing-name').textContent = `Season ${item.ParentIndexNumber} · Episode ${item.IndexNumber} · ${item.Name}`;
        },
        setLayout(layout) {
            document.documentElement.classList.toggle('layout-tv', layout === 'tv');
            document.documentElement.classList.toggle('layout-desktop', layout !== 'tv');
            document.getElementById('demo-tv').setAttribute('aria-pressed', String(layout === 'tv'));
            document.getElementById('demo-desktop').setAttribute('aria-pressed', String(layout !== 'tv'));
            document.getElementById('demo-instructions').innerHTML = layout === 'tv'
                ? '<kbd>↓</kbd><div>Browse this show<span>Open the episode preview with your remote or keyboard.</span></div>'
                : '<kbd>▤</kbd><div>Browse this show<span>Use the episode button in the player controls.</span></div>';
            document.dispatchEvent(new CustomEvent('viewshow', {bubbles: true}));
        }
    };
    if (params.get('scenario') === 'missing') {
        delete episodes[1].ImageTags.Primary;
        episodes[1].Overview = '';
    }
    if (params.get('scenario') === 'unsafe') {
        episodes[1].Name = '<img src=x onerror="window.__unsafeExecuted=true">';
        episodes[1].Overview = '<script>window.__unsafeExecuted=true</script> & unexpected <b>markup</b>';
        seasons[0].Name = '<b>Untrusted season</b>';
    }
    const listeners = new WeakMap();
    window.Events = {
        on(source, type, callback) {
            if (!listeners.has(source)) listeners.set(source, new Map());
            const callbacks = listeners.get(source).get(type) || [];
            callbacks.push(callback);
            listeners.get(source).set(type, callbacks);
        },
        off(source, type, callback) {
            const events = listeners.get(source);
            if (events) events.set(type, (events.get(type) || []).filter(fn => fn !== callback));
        },
        trigger(source, type, args = []) {
            (listeners.get(source)?.get(type) || []).forEach(callback => callback({type}, ...args));
        }
    };
    const group = season => ({
        GroupId: season.Id, GroupName: season.Name, IndexNumber: season.IndexNumber,
        PlayedItemCount: 1, TotalItemCount: 2, PlayedRuntimeTicks: 28800000000, TotalRuntimeTicks: 57600000000
    });
    window.ApiClient = {
        getCurrentUserId: () => 'demo-user', deviceId: () => 'demo-device', serverId: () => 'demo-server',
        serverAddress: () => location.origin, accessToken: () => 'offline-demo',
        getUrl(path, options) {
            const url = new URL(path.replace(/^\/?/, '/'), location.origin);
            if (options) Object.entries(options).forEach(([key, value]) => url.searchParams.set(key, value));
            return url.href;
        },
        getImageUrl: id => `/demo/artwork.svg?episode=${encodeURIComponent(id)}`,
        getScaledImageUrl: id => `/demo/artwork.svg?episode=${encodeURIComponent(id)}`,
        async getItem(userId, id) {
            demo.calls.push({method: 'getItem', userId, id});
            await demo.wait();
            return clone(episodes.find(episode => episode.Id === id));
        },
        async getEpisodes(seriesId, options = {}) {
            demo.calls.push({method: 'getEpisodes', seriesId, options});
            await demo.wait();
            return {Items: clone(episodes.slice(options.StartIndex || 0, (options.StartIndex || 0) + (options.Limit || 200))), TotalRecordCount: episodes.length};
        },
        async getSeasons(seriesId, options) {
            demo.calls.push({method: 'getSeasons', seriesId, options});
            await demo.wait();
            return {Items: clone(seasons), TotalRecordCount: seasons.length};
        },
        async ajax(request) {
            const path = new URL(request.url, location.origin).pathname;
            demo.calls.push({method: 'ajax', path});
            if (path.endsWith('/PluginSettings')) return clone(settings);
            if (path.endsWith('/ServerSettings')) return {MinResumePct: 5, MaxResumePct: 90, MinResumeDurationSeconds: 300};
            if (path.includes('/SourceCollection/')) return undefined;
            if (path.endsWith('/PreviewItemType')) return 'Episode';
            if (path.endsWith('/NowPlayingItem')) return document.querySelector('.btnUserRating').dataset.id;
            if (path.endsWith('/PreviewData')) {
                const item = episodes.find(episode => path.includes('/' + episode.Id + '/')) || episodes[1];
                return {ItemType: 'Episode', ContainerName: item.SeriesName, Groups: seasons.map(group), ActiveGroupId: item.SeasonId, ActiveItemIndex: item.IndexNumber - 1};
            }
            if (path.includes('/Groups/') && path.endsWith('/Items')) {
                const items = episodes.filter(episode => path.includes('/' + episode.SeasonId + '/')).map(item => ({...item, Description: item.Overview}));
                return {Items: clone(items), TotalRecordCount: items.length};
            }
            if (path.endsWith('/WatchedCount')) return {PlayedItemCount: 1, TotalItemCount: 2, PlayedRuntimeTicks: 28800000000, TotalRuntimeTicks: 57600000000};
            if (path.endsWith('/ContainingCollections')) return [];
            const play = path.match(/\/Items\/([^/]+)\/Play\/(\d+)$/);
            if (play) {
                demo.playRequests.push({itemId: play[1], ticks: Number(play[2])});
                if (demo.failPlay) throw new Error('Synthetic playback failure');
                demo.setPlaying(play[1]);
                const toast = document.getElementById('demo-toast');
                toast.textContent = 'Demo playback switched to ' + episodes.find(item => item.Id === play[1]).Name;
                toast.hidden = false;
                setTimeout(() => { toast.hidden = true; }, 3500);
                return undefined;
            }
            throw new Error(`Unexpected demo request: ${path}`);
        }
    };
    // Bubble listeners stand in for Jellyfin's native player seek/navigation handlers.
    window.addEventListener('keydown', event => {
        if (['ArrowLeft', 'ArrowRight', 'Enter', 'ArrowDown', 'ArrowUp'].includes(event.key)) demo.playerCommands.push(event.key);
    });
    window.addEventListener('command', event => demo.playerCommands.push(event.detail.command));
    document.getElementById('demo-tv').addEventListener('click', () => demo.setLayout('tv'));
    document.getElementById('demo-desktop').addEventListener('click', () => demo.setLayout('desktop'));
    demo.setLayout(params.get('layout') === 'desktop' ? 'desktop' : 'tv');
    demo.ready = true;
})();
