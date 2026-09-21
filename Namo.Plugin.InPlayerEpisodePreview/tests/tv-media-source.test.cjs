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
        ...overrides
    };
    const episodeContext = {exports: {}, ApiClient: api};
    vm.runInNewContext(episodeSource, episodeContext);
    const context = {exports: {}, ApiClient: api, require: id => {
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

test('rejects missing, unsupported, inaccessible, and malformed items with actionable errors', async () => {
    const cases = [
        [{getCurrentUserId: () => ''}, /Sign in/],
        [{getItem: async () => null}, /playing item/],
        [{getItem: async () => ({Id: 'music', Type: 'Audio'})}, /TV episode, film, or live TV/],
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
