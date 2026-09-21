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
    const movies = [
        {Id: 'movie-1', Name: 'The Last Meridian', ProductionYear: 2025, Genres: ['Adventure', 'Drama'], Overview: 'When every compass in the city points toward the same forgotten observatory, a cartographer sets out to find the last line on a map her father never finished.'},
        {Id: 'movie-2', Name: 'A Map of Silence', ProductionYear: 2024, Genres: ['Drama', 'Mystery'], Overview: 'A sound archivist follows a trail of empty recordings across a remote archipelago. What she discovers changes the way she hears the world around her.'},
        {Id: 'movie-3', Name: 'Paper Satellites', ProductionYear: 2023, Genres: ['Science Fiction', 'Adventure'], Overview: 'Two friends build a receiver from discarded parts and hear a transmission from tomorrow. They have one summer night to decide what to do with it.'}
    ].map((item, index) => ({
        ...item, Type: 'Movie', MediaType: 'Video', LocationType: 'FileSystem', ServerId: 'demo-server',
        RunTimeTicks: (108 + index * 6) * 600000000, OfficialRating: 'PG',
        ImageTags: {Primary: 'demo-film'}, BackdropImageTags: ['demo-film'], PrimaryImageTag: 'demo-film',
        UserData: {Played: false, IsFavorite: false, PlaybackPositionTicks: index === 1 ? 15000000000 : 0, PlayedPercentage: index === 1 ? 22 : 0}
    }));
    const programmeStart = new Date(Date.now() - 20 * 60000).toISOString();
    const programmeEnd = new Date(Date.now() + 40 * 60000).toISOString();
    const channels = [
        {Id: 'channel-1', Name: 'North One', ChannelNumber: '1', CurrentProgram: {Id: 'programme-1', Name: 'Morning on the Coast', Overview: 'Meet the people keeping a small harbour moving, from the first fishing boat to the last delivery of the morning.', StartDate: programmeStart, EndDate: programmeEnd, ImageTags: {Primary: 'demo-channel'}}},
        {Id: 'channel-2', Name: 'Frame Cinema', ChannelNumber: '2', CurrentProgram: {Id: 'programme-2', Name: 'The Midnight Express', Overview: 'A missed connection turns into an unforgettable journey when a young musician boards the last train across the mountains.', StartDate: programmeStart, EndDate: programmeEnd, ImageTags: {Primary: 'demo-channel'}}},
        {Id: 'channel-3', Name: 'Field Notes', ChannelNumber: '12'}
    ].map(item => ({
        ...item, Type: 'TvChannel', MediaType: 'Video', ServerId: 'demo-server',
        ImageTags: {Primary: 'demo-channel'}, PrimaryImageTag: 'demo-channel',
        // Nonzero history intentionally exercises the live-channel zero-seek rule.
        UserData: {Played: false, IsFavorite: false, PlaybackPositionTicks: 12000000000}
    }));
    const intros = [
        {Id: 'intro-1', Name: 'A night at the pictures', Type: 'Video'},
        {Id: 'trailer-1', Name: 'Coming soon', Type: 'Trailer', ExtraType: 'Trailer'}
    ].map(item => ({...item, MediaType: 'Video', LocationType: 'FileSystem', ServerId: 'demo-server',
        RunTimeTicks: 450000000, Overview: 'A fictional cinema pre-roll. The feature has not started yet.',
        ImageTags: {Primary: 'demo-intro'}, UserData: {Played: false, PlaybackPositionTicks: 0}}));
    const items = [...episodes, ...movies, ...channels, ...intros];
    const featureItemId = params.get('media') === 'episode' ? 'episode-2' : 'movie-1';
    const artworkUrl = id => new URL(id.startsWith('movie-') ? 'movie-artwork.svg' : /^(channel|programme)-/.test(id) ? 'channel-artwork.svg' : 'artwork.svg', location.href).href;
    const settings = {
        EnabledItemTypes: [28, 5, 13, 35], BlurDescription: false, BlurThumbnail: false,
        EpisodePageSize: 10, ShowWatchedCount: true, WatchCountDisplayMode: 0,
        SearchContainingCollections: false, OnlyBlurUnwatched: false, ShowWatchProgress: true,
        ExpandAllItems: false, ExpandedItemLayout: 0, AutoClosePreview: true, LogLevel: 2
    };
    const clone = value => JSON.parse(JSON.stringify(value));
    const demo = window.__demo = {
        episodes, seasons, movies, channels, intros, settings, calls: [], playRequests: [], nativePlayRequests: [], playerCommands: [],
        featureItemId,
        playbackQueue: params.get('scenario') === 'preroll' ? [
            {Id: 'intro-1', PlaylistItemId: 'queue-intro'},
            {Id: 'trailer-1', PlaylistItemId: 'queue-trailer'},
            {Id: featureItemId, PlaylistItemId: 'queue-feature'}
        ] : [],
        media: 'episode', layout: 'tv',
        delayMs: 0, failPlay: false, failLoad: false, ready: false,
        nativeChannelPlayback: params.get('native-playback') === '1', ignorePlay: false, stallPlay: false, channelTuneDelayMs: 0,
        async wait() {
            if (this.delayMs) await new Promise(resolve => setTimeout(resolve, this.delayMs));
            if (this.failLoad) throw new Error('Synthetic media load failure');
        },
        setPlaying(id) {
            const item = items.find(item => item.Id === id);
            if (!item) throw new Error('Unknown demo item');
            this.playingItemId = id;
            document.querySelector('.btnUserRating').dataset.id = id;
            const isIntro = item.Type === 'Video' || item.Type === 'Trailer';
            const feature = items.find(item => item.Id === this.featureItemId);
            const mediaItem = isIntro ? feature : item;
            const media = mediaItem.Type === 'Movie' ? 'movie' : mediaItem.Type === 'TvChannel' ? 'live-tv' : 'episode';
            this.media = media;
            this.isIntro = isIntro;
            document.querySelector('.demo-stage').dataset.media = media;
            document.getElementById('demo-playing-title').textContent = isIntro ? item.Name : media === 'episode' ? 'The long way home.' : item.Name;
            document.getElementById('demo-playing-type').textContent = isIntro ? 'PRE-ROLL · A FICTIONAL INTRO' : media === 'movie' ? 'NOW PLAYING · A FICTIONAL FILM' : media === 'live-tv' ? 'ON AIR · A FICTIONAL CHANNEL' : 'NOW PLAYING · A FICTIONAL SERIES';
            document.getElementById('demo-playing-name').textContent = isIntro
                ? this.playbackQueue.some(queued => queued.Id === this.featureItemId) ? `Up next · ${feature.Name}` : 'No queued film or episode'
                : media === 'episode'
                ? `Season ${item.ParentIndexNumber} · Episode ${item.IndexNumber} · ${item.Name}`
                : media === 'movie' ? `${item.ProductionYear} · ${item.Genres.join(' / ')}`
                : `Channel ${item.ChannelNumber} · ${item.CurrentProgram?.Name || 'Programme information unavailable'}`;
            document.querySelector('.demo-time').textContent = isIntro ? '00:12 / 00:45' : media === 'live-tv' ? '● LIVE' : media === 'movie' ? '25:00 / 108:00' : '18:42 / 48:00';
            for (const kind of ['episode', 'movie', 'live-tv']) document.getElementById(`demo-${kind}`).setAttribute('aria-pressed', String(kind === media));
            this.updateInstructions();
        },
        setMedia(media) {
            // A fresh page mirrors starting a different item in Jellyfin and clears
            // the original desktop popup's per-video cached groups.
            const url = new URL(location.href);
            url.searchParams.set('media', media);
            url.searchParams.set('layout', media === 'episode' ? this.layout : 'tv');
            if ((media === 'live-tv' || this.layout === 'desktop') && ['preroll', 'trailer-no-feature'].includes(url.searchParams.get('scenario'))) url.searchParams.delete('scenario');
            location.assign(url.href);
        },
        updateInstructions() {
            const hasFeature = this.playbackQueue.some(item => item.Id === this.featureItemId);
            const description = this.isIntro ? hasFeature ? 'Preview the upcoming feature' : 'No feature to preview' : this.media === 'movie' ? 'Browse similar films' : this.media === 'live-tv' ? 'Browse live channels' : 'Browse this show';
            const hint = this.isIntro ? hasFeature ? 'Press Down to browse while the intro keeps playing.' : 'Normal player controls stay available during this trailer.' : this.layout === 'tv' ? 'Open the preview with your remote or keyboard.' : 'Use the preview button in the player controls.';
            const instructions = document.getElementById('demo-instructions');
            instructions.replaceChildren();
            const key = document.createElement('kbd');
            key.textContent = this.layout === 'tv' ? '↓' : '▤';
            const label = document.createElement('div');
            label.textContent = description;
            const detail = document.createElement('span');
            detail.textContent = hint;
            label.append(detail);
            instructions.append(key, label);
        },
        setLayout(layout) {
            this.layout = layout;
            if (layout === 'desktop' && (this.media !== 'episode' || this.isIntro)) {
                this.setMedia('episode');
                return;
            }
            document.documentElement.classList.toggle('layout-tv', layout === 'tv');
            document.documentElement.classList.toggle('layout-desktop', layout !== 'tv');
            document.getElementById('demo-tv').setAttribute('aria-pressed', String(layout === 'tv'));
            document.getElementById('demo-desktop').setAttribute('aria-pressed', String(layout !== 'tv'));
            this.updateInstructions();
            document.dispatchEvent(new CustomEvent('viewshow', {bubbles: true}));
        }
    };
    // Model Jellyfin's v0 itemscontainer only when explicitly enabled. The real
    // host handles its item's play command locally, independently of /Play.
    const createElement = document.createElement;
    document.createElement = function (tagName, options) {
        if (tagName === 'div' && options === 'emby-itemscontainer') {
            const container = createElement.call(this, tagName);
            if (demo.nativeChannelPlayback) {
                container.attachedCallback = function () {};
                container.addEventListener('command', event => {
                    if (!container.isConnected || event.detail?.command !== 'play') return;
                    const item = event.target.closest('[data-id]');
                    if (!item || item.dataset.type !== 'TvChannel' || item.dataset.serverid !== 'demo-server') return;
                    demo.nativePlayRequests.push({itemId: item.dataset.id, ticks: Number(item.dataset.positionticks),
                        serverId: item.dataset.serverid, type: item.dataset.type, mediaType: item.dataset.mediatype});
                    event.preventDefault();
                    event.stopPropagation();
                    if (!demo.ignorePlay) setTimeout(() => demo.setPlaying(item.dataset.id), demo.channelTuneDelayMs);
                });
            }
            return container;
        }
        return createElement.apply(this, arguments);
    };
    if (params.get('scenario') === 'missing') {
        delete episodes[1].ImageTags.Primary;
        episodes[1].Overview = '';
        movies[0].ImageTags = {};
        movies[0].BackdropImageTags = [];
        movies[0].Overview = '';
        channels[0].ImageTags = {};
        delete channels[0].CurrentProgram;
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
        getImageUrl: id => artworkUrl(id),
        getScaledImageUrl: id => artworkUrl(id),
        async getItem(userId, id) {
            demo.calls.push({method: 'getItem', userId, id});
            await demo.wait();
            const item = items.find(item => item.Id === id);
            if (!item) throw new Error(`Unknown demo item: ${id}`);
            return clone(item);
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
        async getSimilarItems(id, options = {}) {
            demo.calls.push({method: 'getSimilarItems', id, options});
            await demo.wait();
            const similar = movies.filter(item => item.Id !== id);
            return {Items: clone(similar.slice(0, options.Limit || 100)), TotalRecordCount: similar.length};
        },
        async getLiveTvChannels(options = {}) {
            demo.calls.push({method: 'getLiveTvChannels', options});
            await demo.wait();
            return {Items: clone(channels.slice(options.StartIndex || 0, (options.StartIndex || 0) + (options.Limit || 200))), TotalRecordCount: channels.length};
        },
        async getLiveTvChannel(id, userId) {
            demo.calls.push({method: 'getLiveTvChannel', id, userId});
            await demo.wait();
            const channel = channels.find(item => item.Id === id);
            if (!channel) throw new Error(`Unknown demo channel: ${id}`);
            return clone(channel);
        },
        async ajax(request) {
            const path = new URL(request.url, location.origin).pathname;
            demo.calls.push({method: 'ajax', path});
            if (path.endsWith('/PluginSettings')) return clone(settings);
            if (path.endsWith('/ServerSettings')) return {MinResumePct: 5, MaxResumePct: 90, MinResumeDurationSeconds: 300};
            if (path.includes('/SourceCollection/')) return undefined;
            if (path.endsWith('/PreviewItemType')) return 'Episode';
            if (path.endsWith('/NowPlayingItem')) return demo.playingItemId;
            if (path.endsWith('/PlaybackContext')) {
                await demo.wait();
                const item = items.find(item => item.Id === demo.playingItemId);
                return clone({PlayingItemId: item.Id, PlayingItemType: item.Type, PlayingItemExtraType: item.ExtraType,
                    PlaylistItemId: demo.playbackQueue.find(queued => queued.Id === item.Id)?.PlaylistItemId,
                    Queue: demo.playbackQueue});
            }
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
                if (demo.stallPlay) await new Promise(() => {});
                // A session command can be accepted even if the client never
                // receives it. Tests can model that independently of HTTP errors.
                if (demo.ignorePlay) return undefined;
                if (play[1].startsWith('channel-') && demo.channelTuneDelayMs) {
                    setTimeout(() => demo.setPlaying(play[1]), demo.channelTuneDelayMs);
                    return undefined;
                }
                demo.setPlaying(play[1]);
                const toast = document.getElementById('demo-toast');
                toast.textContent = 'Demo playback switched to ' + items.find(item => item.Id === play[1]).Name;
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
    for (const media of ['episode', 'movie', 'live-tv']) document.getElementById(`demo-${media}`).addEventListener('click', () => demo.setMedia(media));
    demo.setPlaying(params.get('layout') === 'desktop' ? 'episode-2'
        : params.get('scenario') === 'preroll' ? 'intro-1'
        : params.get('scenario') === 'trailer-no-feature' ? 'trailer-1'
        : params.get('media') === 'movie' ? 'movie-1' : params.get('media') === 'live-tv' ? 'channel-1' : 'episode-2');
    demo.setLayout(params.get('layout') === 'desktop' ? 'desktop' : 'tv');
    demo.ready = true;
})();
