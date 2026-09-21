const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const source = readFileSync(path.join(__dirname, '../Web/Services/TvEpisodeSource.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017}
}).outputText;

function episode(id, season = 1, number = 1, extra = {}) {
    return {Id: id, Type: 'Episode', SeriesId: 'show', SeriesName: 'Example show',
        ParentIndexNumber: season, IndexNumber: number, Name: id, ...extra};
}

function setup(overrides = {}) {
    const api = {
        getCurrentUserId: () => 'user',
        getItem: async () => episode('current'),
        getEpisodes: async () => ({Items: [episode('current')], TotalRecordCount: 1}),
        getSeasons: async () => ({Items: []}),
        getImageUrl: (id, options) => `image://${id}/${options.type}/${options.tag}`,
        ...overrides
    };
    const context = {exports: {}, ApiClient: api};
    vm.runInNewContext(compiled, context);
    return {...context.exports, api};
}

test('navigation wraps at both show boundaries and handles a singleton', () => {
    const {wrappedIndex} = setup();
    assert.equal(wrappedIndex(0, -1, 6), 5);
    assert.equal(wrappedIndex(5, 1, 6), 0);
    assert.equal(wrappedIndex(2, 1, 6), 3);
    assert.equal(wrappedIndex(3, -1, 6), 2);
    assert.equal(wrappedIndex(0, 1, 1), 0);
    assert.equal(wrappedIndex(0, -1, 1), 0);
    assert.equal(wrappedIndex(0, 1, 0), -1);
});

test('position labels identify season, specials, ranges, and missing numbering', () => {
    const {episodePositionLabel} = setup();
    assert.equal(episodePositionLabel({seasonNumber: 2, episodeNumber: 3}), 'Season 2 · Episode 3');
    assert.equal(episodePositionLabel({seasonNumber: 0, episodeNumber: 1}), 'Specials · Episode 1');
    assert.equal(episodePositionLabel({seasonNumber: 2, episodeNumber: 3, episodeNumberEnd: 4}), 'Season 2 · Episodes 3–4');
    assert.equal(episodePositionLabel({seasonNumber: null, seasonName: 'Final chapter', episodeNumber: null}),
        'Final chapter · Unnumbered episode');
});

test('pages the full show, removes unavailable/duplicate items, and orders seasons numerically', async () => {
    const requests = [];
    const current = episode('s2e1', 2, 1, {SeasonId: 'season2', Overview: '<b>Raw overview</b>',
        ImageTags: {Primary: 'image-tag'}, RunTimeTicks: 240, UserData: {Played: true, PlaybackPositionTicks: 100}});
    const pages = [
        [episode('s10e1', 10), current, episode('special', 0)],
        [episode('s1e2', 1, 2), episode('s1e1', 1), current,
            episode('missing', 1, 3, {IsMissing: true}), episode('virtual', 1, 4, {LocationType: 'Virtual'}),
            episode('placeholder', 1, 5, {IsPlaceHolder: true}), episode('other-show', 1, 6, {SeriesId: 'other'})]
    ];
    const {TvEpisodeSource} = setup({
        getItem: async () => current,
        getEpisodes: async (id, options) => {
            assert.equal(id, 'show');
            requests.push(options);
            return {Items: pages[requests.length - 1], TotalRecordCount: 10};
        },
        getSeasons: async () => ({Items: [{Id: 'season2', IndexNumber: 2, Name: 'The second chapter'}]})
    });
    const result = await new TvEpisodeSource().load('s2e1');
    assert.deepEqual(Array.from(result.episodes, item => item.id), ['special', 's1e1', 's1e2', 's2e1', 's10e1']);
    assert.equal(result.activeIndex, 3);
    assert.deepEqual(requests.map(request => request.StartIndex), [0, 3]);
    assert.ok(requests.every(request => request.SeasonId === undefined && request.Season === undefined));
    assert.ok(requests.every(request => request.UserId === 'user' && request.IsMissing === false));
    assert.ok(requests.every(request => request.Fields.includes('Overview') && request.EnableUserData));
    const selected = result.episodes[result.activeIndex];
    assert.equal(selected.seasonName, 'The second chapter');
    assert.equal(selected.description, '<b>Raw overview</b>');
    assert.equal(selected.imageUrl, 'image://s2e1/Primary/image-tag');
    assert.equal(selected.runtimeTicks, 240);
    assert.equal(selected.playbackPositionTicks, 100);
    assert.equal(selected.played, true);
});

test('keeps the actual playing item if an alternate version is absent from the listing', async () => {
    const {TvEpisodeSource} = setup({
        getItem: async () => episode('alternate', 2, 2, {SeasonId: 'second', ParentIndexNumber: null}),
        getEpisodes: async () => ({Items: [episode('first')], TotalRecordCount: 1}),
        getSeasons: async () => ({Items: [{Id: 'second', Name: 'Season two', IndexNumber: 2}]})
    });
    const result = await new TvEpisodeSource().load('alternate');
    assert.equal(result.episodes[result.activeIndex].id, 'alternate');
    assert.equal(result.episodes[result.activeIndex].seasonNumber, 2);
    assert.equal(result.episodes[result.activeIndex].imageUrl, null);
});

test('non-episodes, unavailable episodes and empty shows give actionable errors', async () => {
    for (const overrides of [
        {getItem: async () => ({Id: 'movie', Type: 'Movie'})},
        {getItem: async () => episode('current', 1, 1, {LocationType: 'Virtual'})},
        {getEpisodes: async () => ({Items: [], TotalRecordCount: 0})}
    ]) {
        const {TvEpisodeSource} = setup(overrides);
        await assert.rejects(new TvEpisodeSource().load('current'), /Start an episode|Refresh.*library/i);
    }
});

test('authorization and request failures remain visible with recovery instructions', async () => {
    const unauthorized = setup({getItem: async () => {throw {status: 401};}});
    await assert.rejects(new unauthorized.TvEpisodeSource().load('current'), /Sign in to Jellyfin again/);
    const offline = setup({getEpisodes: async () => {throw new Error('Network failure');}});
    await assert.rejects(new offline.TvEpisodeSource().load('current'), /Check your connection to Jellyfin/);
    const seasons = setup({getSeasons: async () => {throw new Error('Network failure');}});
    await assert.rejects(new seasons.TvEpisodeSource().load('current'), /load season names/);
});

test('rejects repeated or incomplete pages instead of presenting a false show boundary', async () => {
    for (const repeat of [true, false]) {
        let calls = 0;
        const {TvEpisodeSource} = setup({getEpisodes: async () => ({
            Items: ++calls === 1 || repeat ? [episode('current')] : [], TotalRecordCount: 3
        })});
        await assert.rejects(new TvEpisodeSource().load('current'), /repeated an episode page|incomplete episode list/);
        assert.equal(calls, 2);
    }
});

test('bounds server pagination even when a changing response never reaches its total', async () => {
    let calls = 0;
    const {TvEpisodeSource} = setup({getEpisodes: async () => ({
        Items: [episode(`item-${++calls}`)], TotalRecordCount: 100000
    })});
    await assert.rejects(new TvEpisodeSource().load('current'), /exceeded the browsing limit/);
    assert.equal(calls, 100);
});
