import {expect, test, type Page} from '@playwright/test';

const panel = (page: Page) => page.locator('#tvEpisodePreview');
const selected = {
    episode: {id: 'episode-3', name: 'Across the Quiet Water', type: 'Episode', ticks: 9000000000, action: 'Resume episode', busy: 'Starting episode…'},
    movie: {id: 'movie-2', name: 'A Map of Silence', type: 'Movie', ticks: 15000000000, action: 'Resume film', busy: 'Starting film…'}
};

async function selectMedia(page: Page, kind: keyof typeof selected, native = true) {
    await page.goto(`/demo/index.html?media=${kind}${native ? '&native-playback=1' : ''}#/video`);
    await page.keyboard.press('ArrowDown');
    await expect(panel(page)).toHaveAttribute('data-kind', kind);
    await page.keyboard.press('ArrowRight');
    await expect(panel(page).locator('.ipep-tv-title')).toHaveText(selected[kind].name);
    await expect(panel(page).getByRole('button', {name: selected[kind].action, exact: true})).toBeFocused();
}

async function legacyOk(page: Page) {
    return page.evaluate(() => {
        const target = document.activeElement!;
        const down = new KeyboardEvent('keydown', {key: 'Unidentified', keyCode: 13, bubbles: true, cancelable: true});
        target.dispatchEvent(down);
        target.dispatchEvent(new KeyboardEvent('keyup', {key: 'Unidentified', keyCode: 13, bubbles: true, cancelable: true}));
        return down.defaultPrevented;
    });
}

for (const kind of ['episode', 'movie'] as const) {
    for (const activation of ['LG OK keycode', 'pointer click'] as const) {
        test(`${activation} resumes ${kind === 'episode' ? 'an episode' : 'a movie'} through the local Jellyfin action`, async ({page}) => {
            await selectMedia(page, kind);
            if (activation === 'LG OK keycode') expect(await legacyOk(page)).toBe(true);
            else await panel(page).getByRole('button', {name: selected[kind].action, exact: true}).click();
            await expect(panel(page)).toHaveCount(0);
            expect(await page.evaluate(() => window.__demo.nativePlayRequests)).toEqual([{
                itemId: selected[kind].id, ticks: selected[kind].ticks,
                serverId: 'demo-server', type: selected[kind].type, mediaType: 'Video'
            }]);
            expect(await page.evaluate(() => window.__demo.playRequests)).toEqual([]);
            expect(await page.evaluate(() => window.__demo.playingItemId)).toBe(selected[kind].id);
            expect(await page.evaluate(() => window.__demo.playerCommands)).toEqual([]);
            await expect(page.locator('[is="emby-itemscontainer"]')).toHaveCount(0);
        });
    }
}

test('an acknowledged episode session command without playback stays open and offers a retry', async ({page}) => {
    await selectMedia(page, 'episode', false);
    await page.clock.install();
    await page.evaluate(() => { window.__demo.ignorePlay = true; });
    await legacyOk(page);
    await expect(panel(page).getByRole('button', {name: selected.episode.busy})).toBeDisabled();
    await expect.poll(() => page.evaluate(() => window.__demo.playRequests.length)).toBe(1);
    await page.clock.runFor(21000);
    await expect(panel(page).getByRole('button', {name: selected.episode.action, exact: true})).toBeEnabled();
    await expect(panel(page).locator('.ipep-tv-announcement')).toContainText(/try again/i);
    await expect(panel(page).locator('.ipep-tv-title')).toHaveText(selected.episode.name);
    expect(await page.evaluate(() => window.__demo.playingItemId)).toBe('episode-2');
    expect(await page.evaluate(() => window.__demo.nativePlayRequests)).toEqual([]);
    expect(await page.evaluate(() => window.__demo.playRequests)).toEqual([{itemId: selected.episode.id, ticks: selected.episode.ticks}]);
    await page.evaluate(() => { window.__demo.ignorePlay = false; });
    await legacyOk(page);
    await expect(panel(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__demo.playingItemId)).toBe(selected.episode.id);
    expect(await page.evaluate(() => window.__demo.playRequests)).toHaveLength(2);
});

async function selectUnresumedFilm(page: Page) {
    await page.goto('/demo/index.html?media=movie&native-playback=1#/video');
    await page.evaluate(() => { window.__demo.movies[1].UserData.PlaybackPositionTicks = 0; });
    await page.keyboard.press('ArrowDown');
    await expect(panel(page)).toHaveAttribute('data-kind', 'movie');
    await page.keyboard.press('ArrowRight');
    await expect(panel(page).locator('.ipep-tv-title')).toHaveText(selected.movie.name);
    await expect(panel(page).getByRole('button', {name: 'Play film', exact: true})).toBeFocused();
}

test('a new cinema intro leading to the selected film confirms local playback', async ({page}) => {
    await selectUnresumedFilm(page);
    await page.evaluate(() => { window.__demo.ignorePlay = true; });
    await legacyOk(page);
    await expect.poll(() => page.evaluate(() => window.__demo.nativePlayRequests.length)).toBe(1);
    await expect(panel(page).getByRole('button', {name: selected.movie.busy})).toBeDisabled();
    await page.evaluate(() => {
        window.__demo.playingItemId = 'intro-1';
        window.__demo.playbackQueue = [
            {Id: 'intro-1', PlaylistItemId: 'new-queue-intro'},
            {Id: 'trailer-1', PlaylistItemId: 'new-queue-trailer'},
            {Id: 'movie-2', PlaylistItemId: 'new-queue-feature'}
        ];
    });
    await expect(panel(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__demo.playingItemId)).toBe('intro-1');
    await expect(page.locator('.btnUserRating')).toHaveAttribute('data-id', 'movie-1');
    expect(await page.evaluate(() => window.__demo.nativePlayRequests)).toEqual([{
        itemId: selected.movie.id, ticks: 0, serverId: 'demo-server', type: 'Movie', mediaType: 'Video'
    }]);
    expect(await page.evaluate(() => window.__demo.playRequests)).toEqual([]);
});

async function selectUpcomingFilm(page: Page) {
    await page.goto('/demo/index.html?scenario=preroll&native-playback=1#/video');
    await page.keyboard.press('ArrowDown');
    await expect(panel(page).locator('.ipep-tv-title')).toHaveText('The Last Meridian');
    await expect(panel(page).getByRole('button', {name: 'Play film', exact: true})).toBeFocused();
    await page.evaluate(() => { window.__demo.ignorePlay = true; });
}

test('an unchanged intro cannot confirm an ignored request for its upcoming film', async ({page}) => {
    await selectUpcomingFilm(page);
    await page.clock.install();
    await legacyOk(page);
    await expect.poll(() => page.evaluate(() => window.__demo.nativePlayRequests.length)).toBe(1);
    await expect(panel(page).getByRole('button', {name: 'Starting film…'})).toBeDisabled();
    await page.clock.runFor(21000);
    await expect(panel(page).getByRole('button', {name: 'Play film', exact: true})).toBeEnabled();
    await expect(panel(page).locator('.ipep-tv-announcement')).toContainText(/try again/i);
    expect(await page.evaluate(() => window.__demo.playingItemId)).toBe('intro-1');
    expect(await page.evaluate(() => window.__demo.playRequests)).toEqual([]);
});

test('restarting the same intro with a new playlist entry confirms its selected feature', async ({page}) => {
    await selectUpcomingFilm(page);
    await legacyOk(page);
    await expect.poll(() => page.evaluate(() => window.__demo.nativePlayRequests.length)).toBe(1);
    await expect(panel(page).getByRole('button', {name: 'Starting film…'})).toBeDisabled();
    await page.evaluate(() => {
        window.__demo.playbackQueue[0].PlaylistItemId = 'queue-intro-restarted';
    });
    await expect(panel(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__demo.playingItemId)).toBe('intro-1');
    expect(await page.evaluate(() => window.__demo.nativePlayRequests)).toHaveLength(1);
    expect(await page.evaluate(() => window.__demo.playRequests)).toEqual([]);
});

test('an intro leading to another feature cannot confirm a film later in the queue', async ({page}) => {
    await selectUnresumedFilm(page);
    await page.clock.install();
    await page.evaluate(() => { window.__demo.ignorePlay = true; });
    await legacyOk(page);
    await expect.poll(() => page.evaluate(() => window.__demo.nativePlayRequests.length)).toBe(1);
    await page.evaluate(() => {
        window.__demo.playingItemId = 'intro-1';
        window.__demo.playbackQueue = [
            {Id: 'intro-1', PlaylistItemId: 'new-queue-intro'},
            {Id: 'movie-3', PlaylistItemId: 'new-queue-other-film'},
            {Id: 'movie-2', PlaylistItemId: 'new-queue-selected-film'}
        ];
    });
    await page.clock.runFor(21000);
    await expect(panel(page).getByRole('button', {name: 'Play film', exact: true})).toBeEnabled();
    await expect(panel(page).locator('.ipep-tv-announcement')).toContainText(/try again/i);
    await expect(panel(page).locator('.ipep-tv-title')).toHaveText(selected.movie.name);
    expect(await page.evaluate(() => window.__demo.playingItemId)).toBe('intro-1');
    expect(await page.evaluate(() => window.__demo.nativePlayRequests)).toEqual([{
        itemId: selected.movie.id, ticks: 0, serverId: 'demo-server', type: 'Movie', mediaType: 'Video'
    }]);
    expect(await page.evaluate(() => window.__demo.playRequests)).toEqual([]);
});
