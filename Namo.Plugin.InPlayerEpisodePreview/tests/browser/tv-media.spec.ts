import {expect, test, type Page} from '@playwright/test';

const panel = (page: Page) => page.locator('#tvEpisodePreview');
const title = (page: Page) => panel(page).locator('.ipep-tv-title');

async function open(page: Page, media: 'movie' | 'live-tv') {
    await page.goto(`/demo/index.html?media=${media}#/video`);
    await page.keyboard.press('ArrowDown');
    await expect(panel(page)).toHaveAttribute('data-state', 'episode');
}

test('films start on the playing film, browse similar results in order, and wrap without playing', async ({page}) => {
    await open(page, 'movie');
    await expect(panel(page)).toHaveAccessibleName('Browse similar films');
    await expect(panel(page)).toHaveAttribute('data-kind', 'movie');
    await expect(title(page)).toHaveText('The Last Meridian');
    await expect(panel(page).locator('.ipep-tv-series')).toHaveText('Similar to The Last Meridian');
    await expect(panel(page).locator('.ipep-tv-description')).toContainText('every compass');
    await expect(panel(page).locator('.ipep-tv-image')).toBeVisible();
    await expect(panel(page).getByRole('button', {name: 'Return to film'})).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(title(page)).toHaveText('A Map of Silence');
    await expect(panel(page).locator('.ipep-tv-series')).toHaveText('Similar to The Last Meridian');
    await expect(panel(page).getByRole('button', {name: 'Resume film'})).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(title(page)).toHaveText('Paper Satellites');
    await page.keyboard.press('ArrowRight');
    await expect(title(page)).toHaveText('The Last Meridian');
    await page.keyboard.press('ArrowLeft');
    await expect(title(page)).toHaveText('Paper Satellites');
    expect(await page.evaluate(() => window.__demo.playRequests)).toEqual([]);
    expect(await page.evaluate(() => window.__demo.playerCommands)).toEqual([]);
    const requests = await page.evaluate(() => window.__demo.calls.filter((call: any) => call.method === 'getSimilarItems'));
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({id: 'movie-1', options: {UserId: 'demo-user'}});
    await page.keyboard.press('ArrowUp');
    await expect(panel(page)).toHaveCount(0);
});

test('film playback requires explicit selection and resumes at its saved position', async ({page}) => {
    await open(page, 'movie');
    await page.keyboard.press('ArrowRight');
    await expect(title(page)).toHaveText('A Map of Silence');
    expect(await page.evaluate(() => window.__demo.playRequests)).toEqual([]);
    await page.keyboard.press('Enter');
    await expect(panel(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__demo.playRequests)).toEqual([{itemId: 'movie-2', ticks: 15000000000}]);
    await page.keyboard.press('ArrowDown');
    await expect(title(page)).toHaveText('A Map of Silence');
    await expect(panel(page).getByRole('button', {name: 'Return to film'})).toBeVisible();
});

test('returning to the current film closes the panel without restarting it', async ({page}) => {
    await open(page, 'movie');
    await page.keyboard.press('Enter');
    await expect(panel(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__demo.playRequests)).toEqual([]);
});

test('a film with no recommendations keeps the current film usable', async ({page}) => {
    await page.goto('/demo/index.html?media=movie#/video');
    await page.evaluate(() => { (window as any).ApiClient.getSimilarItems = async () => ({Items: [], TotalRecordCount: 0}); });
    await page.keyboard.press('ArrowDown');
    await expect(title(page)).toHaveText('The Last Meridian');
    await expect(panel(page).locator('.ipep-tv-announcement')).toHaveText('No similar films found');
    await page.keyboard.press('ArrowRight');
    await expect(title(page)).toHaveText('The Last Meridian');
    await page.keyboard.press('Enter');
    await expect(panel(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__demo.playRequests)).toEqual([]);
});

test('live TV browses channels with current programme details, wraps, and does not tune on arrows', async ({page}) => {
    await open(page, 'live-tv');
    await expect(panel(page)).toHaveAccessibleName('Browse live TV');
    await expect(panel(page)).toHaveAttribute('data-kind', 'channel');
    await expect(panel(page)).toContainText('North One');
    await expect(title(page)).toHaveText('North One');
    await expect(panel(page).locator('.ipep-tv-programme')).toHaveText('Now · Morning on the Coast');
    await expect(panel(page).locator('.ipep-tv-description')).toContainText('small harbour');
    await expect(panel(page).getByRole('button', {name: 'Return to channel'})).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(panel(page)).toContainText('Frame Cinema');
    await expect(title(page)).toHaveText('Frame Cinema');
    await expect(panel(page).locator('.ipep-tv-programme')).toHaveText('Now · The Midnight Express');
    await page.keyboard.press('ArrowRight');
    await expect(panel(page)).toContainText('Field Notes');
    await expect(panel(page).locator('.ipep-tv-programme')).toHaveText('Programme information unavailable');
    await expect(panel(page).getByRole('button', {name: 'Watch channel'})).toBeVisible();
    await expect(panel(page).locator('.ipep-tv-description')).not.toContainText('small harbour');
    await expect(panel(page).locator('.ipep-tv-description')).not.toBeEmpty();
    await page.keyboard.press('ArrowRight');
    await expect(title(page)).toHaveText('North One');
    await page.keyboard.press('ArrowLeft');
    await expect(panel(page)).toContainText('Field Notes');
    expect(await page.evaluate(() => window.__demo.playRequests)).toEqual([]);
    expect(await page.evaluate(() => window.__demo.playerCommands)).toEqual([]);
    await page.keyboard.press('ArrowUp');
    await expect(panel(page)).toHaveCount(0);
});

test('live TV only tunes on selection and always uses zero seek ticks', async ({page}) => {
    await open(page, 'live-tv');
    await page.keyboard.press('ArrowRight');
    await expect(title(page)).toHaveText('Frame Cinema');
    expect(await page.evaluate(() => window.__demo.playRequests)).toEqual([]);
    await page.keyboard.press('Enter');
    await expect(panel(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__demo.playRequests)).toEqual([{itemId: 'channel-2', ticks: 0}]);
    await page.keyboard.press('ArrowDown');
    await expect(panel(page)).toContainText('Frame Cinema');
    await expect(panel(page).getByRole('button', {name: 'Return to channel'})).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(panel(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__demo.playRequests)).toHaveLength(1);
});

test('a playing programme resolves to its channel for return and tuning actions', async ({page}) => {
    await page.goto('/demo/index.html?media=live-tv#/video');
    await page.evaluate(() => {
        const client = (window as any).ApiClient;
        const getItem = client.getItem;
        client.getItem = (userId: string, id: string) => id === 'programme-current'
            ? Promise.resolve({Id: id, Type: 'Program', ChannelId: 'channel-1'}) : getItem(userId, id);
        document.querySelector('.btnUserRating')!.setAttribute('data-id', 'programme-current');
    });
    await page.keyboard.press('ArrowDown');
    await expect(title(page)).toHaveText('North One');
    await expect(panel(page).getByRole('button', {name: 'Return to channel'})).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(panel(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__demo.playRequests)).toEqual([]);
    await page.keyboard.press('ArrowDown');
    await expect(title(page)).toHaveText('North One');
    await page.keyboard.press('ArrowRight');
    await expect(title(page)).toHaveText('Frame Cinema');
    await page.keyboard.press('Enter');
    await expect(panel(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__demo.playRequests)).toEqual([{itemId: 'channel-2', ticks: 0}]);
});

test('demo switches among episode, movie and live TV examples using shareable URLs', async ({page}) => {
    await page.goto('/demo/index.html#/video');
    await page.getByRole('button', {name: 'Movies', exact: true}).click();
    await expect(page).toHaveURL(/media=movie/);
    await expect(page.getByRole('button', {name: 'Movies', exact: true})).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(title(page)).toHaveText('The Last Meridian');
    await page.keyboard.press('ArrowUp');
    await page.getByRole('button', {name: 'Live TV', exact: true}).click();
    await expect(page).toHaveURL(/media=live-tv/);
    await page.keyboard.press('ArrowDown');
    await expect(title(page)).toHaveText('North One');
});

test('desktop demo keeps the original episode popup and movie examples select TV layout', async ({page}) => {
    await page.goto('/demo/index.html?media=movie#/video');
    await page.getByRole('button', {name: 'Desktop', exact: true}).click();
    await expect(page).toHaveURL(/media=episode.*layout=desktop/);
    await expect(page.locator('html')).toHaveClass(/layout-desktop/);
    await expect(page.locator('#popupPreviewButton')).toBeVisible();
    await page.locator('#popupPreviewButton').click();
    await expect(page.locator('#previewPopup')).toContainText('The Glass Station');
    await page.goto('/demo/index.html?layout=desktop#/video');
    await page.getByRole('button', {name: 'Movies', exact: true}).click();
    await expect(page.locator('html')).toHaveClass(/layout-tv/);
    await page.keyboard.press('ArrowDown');
    await expect(title(page)).toHaveText('The Last Meridian');
});

test('demo assets and original desktop artwork work under a static project subpath', async ({page}) => {
    const prefix = '/InPlayerEpisodePreview-TV';
    const requests: string[] = [];
    page.on('request', request => { requests.push(new URL(request.url()).pathname); });
    await page.route(`**${prefix}/**`, async route => {
        const url = new URL(route.request().url());
        url.pathname = url.pathname.slice(prefix.length);
        await route.fulfill({response: await route.fetch({url: url.href})});
    });
    await page.goto(`${prefix}/demo/index.html?media=movie#/video`);
    await page.keyboard.press('ArrowDown');
    await expect(title(page)).toHaveText('The Last Meridian');
    await expect(panel(page).locator('.ipep-tv-image')).toBeVisible();
    await expect(panel(page).locator('.ipep-tv-image')).toHaveAttribute('src', new RegExp(`${prefix}/demo/movie-artwork\\.svg$`));
    await page.keyboard.press('ArrowUp');
    await page.getByRole('button', {name: 'Desktop', exact: true}).click();
    await expect(page.locator('#popupPreviewButton')).toBeVisible();
    await page.locator('#popupPreviewButton').click();
    const card = page.locator('#previewItemImageCard-episode-2');
    await expect(card).toBeVisible();
    await expect(card).toHaveCSS('background-image', new RegExp(`${prefix}/demo/artwork\\.svg`));
    expect(requests.filter(path => !path.startsWith(`${prefix}/`))).toEqual([]);
    expect(requests.some(path => path.includes('/Items/'))).toBe(false);
});
