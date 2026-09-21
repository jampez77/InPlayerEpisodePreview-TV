const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function compile(file) {
    return ts.transpileModule(readFileSync(path.join(__dirname, `../Web/Services/${file}.ts`), 'utf8'), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017}
    }).outputText;
}
const episodeSource = compile('TvEpisodeSource');
const mediaSource = compile('TvMediaSource');
const endpointContext = {exports: {}};
vm.runInNewContext(ts.transpileModule(readFileSync(path.join(__dirname, '../Web/Endpoints.ts'), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017}
}).outputText, endpointContext);

function movie(id, extra = {}) {
    return {Id: id, Name: id, Type: 'Movie', LocationType: 'FileSystem', ...extra};
}
function channel(id, number = '1', extra = {}) {
    return {Id: id, Name: id, Type: 'TvChannel', ChannelNumber: number, LocationType: 'Remote', ...extra};
}
function setup(overrides = {}) {
    const api = {
        getCurrentUserId: () => 'user',
        getItem: async () => movie('current'),
        getSimilarItems: async () => ({Items: [], TotalRecordCount: 0}),
        getLiveTvChannels: async () => ({Items: [], TotalRecordCount: 0}),
        getEpisodes: async () => ({Items: [], TotalRecordCount: 0}),
        getSeasons: async () => ({Items: []}),
        getImageUrl: (id, options) => `image://${id}/${options.type}/${options.tag}`,
        getUrl: route => `https://jellyfin.invalid${route}`,
        ajax: async () => ({PlayingItemId: 'current', PlayingItemType: 'Movie', Queue: []}),
        ...overrides
    };
    const episodeContext = {exports: {}, ApiClient: api};
    vm.runInNewContext(episodeSource, episodeContext);
    const context = {exports: {}, ApiClient: api, require: id => {
        if (id === '../Endpoints') return endpointContext.exports;
        assert.equal(id, './TvEpisodeSource');
        return episodeContext.exports;
    }};
    vm.runInNewContext(mediaSource, context);
    return {...context.exports, api};
}

test('keeps the playing film first, recommendation ranking, authenticated fields, and useful film metadata', async () => {
    const calls = [];
    const current = movie('current', {Name: 'Current film', ProductionYear: 2024, Genres: ['Mystery'],
        OfficialRating: 'PG', ImageTags: {Primary: 'poster'}, BackdropImageTags: ['landscape'],
        UserData: {Played: true, PlaybackPositionTicks: 200}, RunTimeTicks: 900, Overview: 'Current overview'});
    const {TvMediaSource} = setup({
        getItem: async (userId, id) => {calls.push(['item', userId, id]); return current;},
        getSimilarItems: async (id, options) => {
            calls.push(['similar', id, options]);
            return {Items: [movie('z-ranked-first'), movie('a-ranked-second'), current, movie('z-ranked-first'),
                movie('missing', {IsMissing: true}), movie('virtual', {LocationType: 'Virtual'}),
                movie('virtual-flag', {IsVirtualItem: true}), movie('placeholder', {IsPlaceHolder: true}),
                movie('denied', {PlayAccess: 'None'}), movie('folder', {IsFolder: true}),
                movie('episode', {Type: 'Episode'}), movie(''), movie('last')], TotalRecordCount: 13};
        }
    });
    const result = await new TvMediaSource().load('current');
    assert.deepEqual(Array.from(result.items, item => item.id), ['current', 'z-ranked-first', 'a-ranked-second', 'last']);
    assert.equal(result.kind, 'movie');
    assert.equal(result.activeIndex, 0);
    assert.equal(result.playingItemId, 'current');
    assert.deepEqual(calls[0], ['item', 'user', 'current']);
    assert.equal(calls[1][1], 'current');
    assert.equal(calls[1][2].UserId, 'user');
    assert.equal(calls[1][2].Limit, 30);
    assert.equal(calls[1][2].StartIndex, undefined);
    assert.ok(calls[1][2].Fields.includes('Overview'));
    assert.ok(result.items.every(item => item.kind === 'movie' && item.seriesName === 'Current film'));
    const selected = result.items[0];
    assert.equal(selected.productionYear, 2024);
    assert.deepEqual(Array.from(selected.genres), ['Mystery']);
    assert.equal(selected.officialRating, 'PG');
    assert.equal(selected.description, 'Current overview');
    assert.equal(selected.imageUrl, 'image://current/Backdrop/landscape');
    assert.equal(selected.runtimeTicks, 900);
    assert.equal(selected.playbackPositionTicks, 200);
    assert.equal(selected.played, true);
});

test('empty recommendations keep the current film and oversized responses are bounded', async () => {
    const empty = setup();
    assert.equal((await new empty.TvMediaSource().load('current')).items.length, 1);
    let requests = 0;
    const oversized = setup({getSimilarItems: async () => {
        requests++;
        return {Items: Array.from({length: 100}, (_, index) => movie(`film-${index}`)), TotalRecordCount: 100};
    }});
    assert.equal((await new oversized.TvMediaSource().load('current')).items.length, 31);
    assert.equal(requests, 1);
});

test('loads every channel page, removes duplicates and inaccessible items, and sorts channel numbers naturally', async () => {
    const options = [];
    const current = channel('channel-12', '12');
    const pages = [[current, channel('channel-2', '2')], [channel('channel-1', '1'),
        channel('channel-2', '2'), channel('legacy-number', undefined, {ChannelNumber: undefined, Number: '3.1'}),
        channel('unnumbered', undefined, {ChannelNumber: undefined}), channel('denied', '4', {PlayAccess: 'None'}),
        movie('not-a-channel')]];
    const {TvMediaSource} = setup({
        getItem: async () => current,
        getLiveTvChannels: async request => {
            options.push(request);
            return {Items: pages[options.length - 1], TotalRecordCount: 8};
        }
    });
    const result = await new TvMediaSource().load(current.Id);
    assert.deepEqual(Array.from(result.items, item => item.id),
        ['channel-1', 'channel-2', 'legacy-number', 'channel-12', 'unnumbered']);
    assert.equal(result.activeIndex, 3);
    assert.equal(result.playingItemId, 'channel-12');
    assert.equal(result.kind, 'channel');
    assert.deepEqual(options.map(option => option.StartIndex), [0, 2]);
    assert.ok(options.every(option => option.UserId === 'user' && option.AddCurrentProgram === true));
    assert.ok(options.every(option => option.SortBy.includes('ChannelNumber') && option.EnableFavoriteSorting === false));
    assert.ok(result.items.every(item => item.kind === 'channel' && item.seriesName === 'Live TV'));
});

test('live programme metadata and images are shown while channels always tune without resume or watched state', async () => {
    const current = channel('news', '101', {ImageTags: {Primary: 'logo'},
        UserData: {Played: true, PlaybackPositionTicks: 1000}, CurrentProgram: {Id: 'programme',
            Name: 'Evening News', Overview: 'Today’s headlines', StartDate: '2026-09-21T18:00:00Z',
            EndDate: '2026-09-21T19:00:00Z', ImageTags: {Primary: 'programme-image'}, RunTimeTicks: 36000000000,
            Genres: ['News'], OfficialRating: 'G'}});
    const {TvMediaSource} = setup({getItem: async () => channel('news', '101'),
        getLiveTvChannels: async () => ({Items: [current], TotalRecordCount: 1})});
    const selected = (await new TvMediaSource().load('news')).items[0];
    assert.equal(selected.name, 'news');
    assert.equal(selected.programName, 'Evening News');
    assert.equal(selected.description, 'Today’s headlines');
    assert.equal(selected.programStart, '2026-09-21T18:00:00Z');
    assert.equal(selected.programEnd, '2026-09-21T19:00:00Z');
    assert.equal(selected.channelNumber, '101');
    assert.equal(selected.imageUrl, 'image://programme/Primary/programme-image');
    assert.equal(selected.runtimeTicks, 36000000000);
    assert.equal(selected.playbackPositionTicks, 0);
    assert.equal(selected.played, false);
});

test('handles absent programme information, falls back to channel artwork, and retains an omitted current channel', async () => {
    const current = channel('current', '2', {Name: 'Channel Two', ImageTags: {Primary: 'logo'}, Overview: 'Channel description'});
    const {TvMediaSource} = setup({getItem: async () => current});
    const result = await new TvMediaSource().load('current');
    assert.equal(result.items.length, 1);
    assert.equal(result.activeIndex, 0);
    assert.equal(result.items[0].programName, undefined);
    assert.equal(result.items[0].programStart, undefined);
    assert.equal(result.items[0].programEnd, undefined);
    assert.equal(result.items[0].imageUrl, 'image://current/Primary/logo');
    assert.equal(result.items[0].description, 'Channel description');
    const noArtwork = setup({getItem: async () => channel('current', '2')});
    assert.equal((await new noArtwork.TvMediaSource().load('current')).items[0].imageUrl, null);
});

test('resolves a playing programme to its channel ID for selection and playback', async () => {
    const requests = [];
    const {TvMediaSource} = setup({getItem: async (userId, id) => {
        requests.push([userId, id]);
        return id === 'programme' ? {Id: id, Type: 'Program', ChannelId: 'channel'} : channel('channel');
    }});
    const result = await new TvMediaSource().load('programme');
    assert.deepEqual(requests, [['user', 'programme'], ['user', 'channel']]);
    assert.equal(result.playingItemId, 'channel');
    assert.equal(result.items[result.activeIndex].id, 'channel');
});

test('passes a fetched episode into existing complete-show navigation without refetching it', async () => {
    const current = {Id: 'current', Type: 'Episode', SeriesId: 'show', ParentIndexNumber: 1, IndexNumber: 2};
    let requests = 0;
    const {TvMediaSource} = setup({getItem: async () => {requests++; return current;},
        getEpisodes: async () => ({Items: [current, {...current, Id: 'first', IndexNumber: 1}], TotalRecordCount: 2})});
    const result = await new TvMediaSource().load('current');
    assert.equal(requests, 1);
    assert.equal(result.kind, 'episode');
    assert.equal(result.activeIndex, 1);
    assert.equal(result.playingItemId, 'current');
    assert.ok(result.items.every(item => item.kind === 'episode'));
});

test('disabled media types stop after identification before any secondary API requests', async () => {
    for (const [current, expectedKind] of [
        [{Id: 'current', Type: 'Episode', SeriesId: 'show'}, 'episode'],
        [movie('current'), 'movie'],
        [channel('current'), 'channel'],
        [{Id: 'current', Type: 'Program', ChannelId: 'channel'}, 'channel']
    ]) {
        let itemRequests = 0;
        let secondaryRequests = 0;
        const kinds = [];
        const unexpected = async () => {secondaryRequests++; throw new Error('Secondary request should not run');};
        const {TvMediaSource, TvMediaDisabledError} = setup({
            getItem: async () => {itemRequests++; return current;},
            getEpisodes: unexpected, getSeasons: unexpected,
            getSimilarItems: unexpected, getLiveTvChannels: unexpected
        });
        await assert.rejects(new TvMediaSource().load('current', kind => {kinds.push(kind); return false;}),
            error => error instanceof TvMediaDisabledError);
        assert.deepEqual(kinds, [expectedKind]);
        assert.equal(itemRequests, 1);
        assert.equal(secondaryRequests, 0);
    }
    const {TvMediaSource} = setup();
    const enabledKinds = [];
    const result = await new TvMediaSource().load('current', kind => {enabledKinds.push(kind); return true;});
    assert.equal(result.kind, 'movie');
    assert.deepEqual(enabledKinds, ['movie']);
});

test('rejects missing, inaccessible, and malformed supported items with actionable errors', async () => {
    const cases = [
        [{getCurrentUserId: () => ''}, /Sign in/],
        [{getItem: async () => null}, /playing item/],
        [{getItem: async () => movie('current', {PlayAccess: 'None'})}, /film is unavailable/],
        [{getItem: async () => ({Id: 'programme', Type: 'Program'})}, /no live channel/],
        [{getItem: async () => ({Id: 'programme', Type: 'Program', ChannelId: 'bad'})}, /channel is unavailable/],
        [{getItem: async () => channel('denied', '1', {PlayAccess: 'None'})}, /channel is unavailable/],
        [{getSimilarItems: async () => ({})}, /invalid similar-film list/],
        [{getItem: async () => channel('current'), getLiveTvChannels: async () => ({})}, /invalid channel list/]
    ];
    for (const [overrides, pattern] of cases) {
        const {TvMediaSource} = setup(overrides);
        await assert.rejects(new TvMediaSource().load('current'), pattern);
    }
    const {TvMediaSource} = setup();
    await assert.rejects(new TvMediaSource().load(''), /No playing item/);
});

test('request failures identify movie, live channel, authentication, and missing-item recovery', async () => {
    for (const [overrides, pattern] of [
        [{getItem: async () => {throw {status: 401};}}, /Sign in to Jellyfin again/],
        [{getItem: async () => {throw {status: 404};}}, /moved or been removed/],
        [{getSimilarItems: async () => {throw new Error('offline');}}, /load similar films.*Check your connection/],
        [{getItem: async () => channel('current'), getLiveTvChannels: async () => {throw {status: 403};}},
            /load live TV channels.*Sign in/]
    ]) {
        const {TvMediaSource} = setup(overrides);
        await assert.rejects(new TvMediaSource().load('current'), pattern);
    }
});

test('rejects repeated or incomplete channel pages instead of presenting false wrap boundaries', async () => {
    for (const repeat of [true, false]) {
        let calls = 0;
        const {TvMediaSource} = setup({getItem: async () => channel('current'), getLiveTvChannels: async () => ({
            Items: ++calls === 1 || repeat ? [channel('current')] : [], TotalRecordCount: 3
        })});
        await assert.rejects(new TvMediaSource().load('current'), /repeated a channel page|incomplete channel list/);
        assert.equal(calls, 2);
    }
    let calls = 0;
    const {TvMediaSource} = setup({getItem: async () => channel('current'), getLiveTvChannels: async () => ({
        Items: [channel(`channel-${++calls}`)], TotalRecordCount: 100000
    })});
    await assert.rejects(new TvMediaSource().load('current'), /exceeded the browsing limit/);
    assert.equal(calls, 100);
});

test('cinema trailers and generic intros preview the following queued feature without claiming it is playing', async () => {
    for (const intro of [{Id: 'intro', Type: 'Video'}, {Id: 'intro', Type: 'Trailer'},
        movie('intro', {ExtraType: 'Trailer'})]) {
        const items = [intro, {Id: 'trailer', Type: 'Trailer'}, movie('feature', {Name: 'Upcoming feature'})];
        const calls = [];
        const {TvMediaSource} = setup({
            getItem: async (userId, id) => {
                calls.push(['item', userId, id]);
                return items.find(item => item.Id === id);
            },
            ajax: async request => {
                calls.push(['context', request]);
                return {PlayingItemId: 'intro', PlayingItemType: intro.Type, PlaylistItemId: 'slot-0',
                    Queue: items.map((item, index) => ({Id: item.Id, PlaylistItemId: `slot-${index}`}))};
            }
        });
        const result = await new TvMediaSource().load('intro');
        assert.equal(result.playingItemId, 'intro');
        assert.equal(result.upcomingItemId, 'feature');
        assert.equal(result.items[result.activeIndex].name, 'Upcoming feature');
        assert.equal(result.kind, 'movie');
        assert.equal(calls[1][1].url, 'https://jellyfin.invalid/InPlayerPreview/PlaybackContext');
        assert.equal(calls[1][1].type, 'GET');
        assert.deepEqual(calls.filter(call => call[0] === 'item').map(call => call[2]), ['intro', 'trailer', 'feature']);
    }
});

test('an upcoming episode retains complete-show browsing and settings apply to the resolved feature', async () => {
    const episode = {Id: 'episode', Type: 'Episode', SeriesId: 'show', IndexNumber: 1, ParentIndexNumber: 1};
    const overrides = {
        getItem: async (userId, id) => id === 'intro' ? {Id: 'intro', Type: 'Video'} : episode,
        getEpisodes: async () => ({Items: [episode, {...episode, Id: 'next', IndexNumber: 2}], TotalRecordCount: 2}),
        ajax: async () => ({PlayingItemId: 'intro', Queue: [{Id: 'intro'}, {Id: 'episode'}]})
    };
    const enabled = setup(overrides);
    const result = await new enabled.TvMediaSource().load('intro');
    assert.equal(result.kind, 'episode');
    assert.equal(result.upcomingItemId, 'episode');
    assert.equal(result.items.length, 2);
    const disabled = setup(overrides);
    await assert.rejects(new disabled.TvMediaSource().load('intro', kind => kind !== 'episode'),
        error => error instanceof disabled.TvMediaDisabledError);
});

test('playback-only intros can use the authenticated session type when their library item is missing', async () => {
    const {TvMediaSource} = setup({
        getItem: async (userId, id) => {
            if (id === 'intro') throw {status: 404};
            return movie('feature');
        },
        ajax: async () => ({PlayingItemId: 'intro', PlayingItemType: 'Video',
            Queue: [{Id: 'intro'}, {Id: 'feature'}]})
    });
    const result = await new TvMediaSource().load('intro');
    assert.equal(result.upcomingItemId, 'feature');
    assert.equal(result.playingItemId, 'intro');
});

test('queue matching normalizes GUID formatting and uses playlist identity to disambiguate repeated intros', async () => {
    const rawId = 'AABBCCDD11223344556677889900AABB';
    const dtoId = 'aabbccdd-1122-3344-5566-77889900aabb';
    const {TvMediaSource} = setup({
        getItem: async (userId, id) => id === rawId ? {Id: dtoId, Type: 'Trailer'} : movie(id),
        ajax: async () => ({PlayingItemId: dtoId, PlaylistItemId: 'second', Queue: [
            {Id: dtoId, PlaylistItemId: 'first'}, {Id: 'wrong-feature'},
            {Id: dtoId, PlaylistItemId: 'second'}, {Id: 'right-feature'}]})
    });
    const result = await new TvMediaSource().load(rawId);
    assert.equal(result.playingItemId, rawId);
    assert.equal(result.upcomingItemId, 'right-feature');
});

test('unsupported or ambiguous playback stays silent instead of guessing an upcoming film', async () => {
    const intro = {Id: 'intro', Type: 'Trailer'};
    const context = {PlayingItemId: 'intro', PlayingItemType: 'Trailer', Queue: [{Id: 'intro'}, {Id: 'feature'}]};
    const cases = [
        {getItem: async () => ({Id: 'intro', Type: 'Audio'})},
        {getItem: async () => ({Id: 'other-intro', Type: 'Trailer'})},
        {ajax: async () => ({...context, PlayingItemId: 'old-intro'})},
        {ajax: async () => ({...context, Queue: []})},
        {ajax: async () => ({...context, Queue: [{Id: 'intro'}]})},
        {ajax: async () => ({...context, Queue: [{Id: 'intro'}, {Id: 'feature'}, {Id: 'intro'}]})},
        {ajax: async () => ({...context, PlaylistItemId: 'missing-slot'})},
        {ajax: async () => {throw {status: 404};}},
        {getItem: async (userId, id) => id === 'intro' ? intro : {Id: 'feature', Type: 'Audio'}},
        {getItem: async (userId, id) => id === 'intro' ? intro : null},
        {getItem: async (userId, id) => id === 'intro' ? intro : movie('wrong-id')},
        {getItem: async (userId, id) => {if (id === 'intro') return intro; throw {status: 403};}},
        {getItem: async () => {throw {status: 404};}, ajax: async () => ({...context, PlayingItemType: undefined})}
    ];
    for (const overrides of cases) {
        const {TvMediaSource, TvMediaUnavailableError} = setup({
            getItem: async (userId, id) => id === 'intro' ? intro : movie(id),
            ajax: async () => context, ...overrides
        });
        await assert.rejects(new TvMediaSource().load('intro'), error => error instanceof TvMediaUnavailableError);
    }
});

test('missing intermediate queue items are not skipped and intro searches remain bounded', async () => {
    let lookedUp = [];
    const missing = setup({
        getItem: async (userId, id) => {
            lookedUp.push(id);
            if (id === 'intro') return {Id: 'intro', Type: 'Video'};
            if (id === 'unknown') throw {status: 404};
            return movie(id);
        },
        ajax: async () => ({PlayingItemId: 'intro', Queue: [{Id: 'intro'}, {Id: 'unknown'}, {Id: 'feature'}]})
    });
    await assert.rejects(new missing.TvMediaSource().load('intro'), error => error instanceof missing.TvMediaUnavailableError);
    assert.deepEqual(lookedUp, ['intro', 'unknown']);
    lookedUp = [];
    const bounded = setup({
        getItem: async (userId, id) => {lookedUp.push(id); return {Id: id, Type: 'Trailer'};},
        ajax: async () => ({PlayingItemId: 'intro', Queue: [{Id: 'intro'},
            ...Array.from({length: 50}, (_, index) => ({Id: `intro-${index}`})), {Id: 'feature'}]})
    });
    await assert.rejects(new bounded.TvMediaSource().load('intro'), error => error instanceof bounded.TvMediaUnavailableError);
    assert.equal(lookedUp.length, 33);
});

test('unavailable upcoming details stay silent while normal feature errors remain actionable', async () => {
    const {TvMediaSource, TvMediaUnavailableError} = setup({
        getItem: async (userId, id) => id === 'intro' ? {Id: 'intro', Type: 'Video'} : movie(id),
        ajax: async () => ({PlayingItemId: 'intro', Queue: [{Id: 'intro'}, {Id: 'feature'}]}),
        getSimilarItems: async () => {throw new Error('offline');}
    });
    await assert.rejects(new TvMediaSource().load('intro'), error => error instanceof TvMediaUnavailableError);
    await assert.rejects(new TvMediaSource().load('feature'), error =>
        !(error instanceof TvMediaUnavailableError) && /load similar films/.test(error.message));
});
