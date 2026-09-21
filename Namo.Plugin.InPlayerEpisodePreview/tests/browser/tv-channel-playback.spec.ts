import {expect, test, type Page} from '@playwright/test';

const panel = (page: Page) => page.locator('#tvEpisodePreview');
const watch = (page: Page) => panel(page).getByRole('button', {name: 'Watch channel', exact: true});

async function selectChannel(page: Page, native = true) {
    await page.goto(`/demo/index.html?media=live-tv${native ? '&native-playback=1' : ''}#/video`);
    await page.keyboard.press('ArrowDown');
    await expect(panel(page).locator('.ipep-tv-title')).toHaveText('North One');
    await page.keyboard.press('ArrowRight');
    await expect(panel(page).locator('.ipep-tv-title')).toHaveText('Frame Cinema');
    await expect(watch(page)).toBeFocused();
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

for (const activation of ['LG OK keycode', 'Jellyfin select command', 'pointer click'] as const) {
    test(`${activation} tunes through the local Jellyfin channel action`, async ({page}) => {
        await selectChannel(page);
        if (activation === 'LG OK keycode') {
            expect(await legacyOk(page)).toBe(true);
        } else if (activation === 'Jellyfin select command') {
            expect(await page.evaluate(() => document.activeElement!.dispatchEvent(new CustomEvent('command', {
                detail: {command: 'select'}, bubbles: true, cancelable: true
            })))).toBe(false);
        } else {
            await watch(page).click();
        }
        await expect(panel(page)).toHaveCount(0);
        expect(await page.evaluate(() => window.__demo.nativePlayRequests)).toEqual([{
            itemId: 'channel-2', ticks: 0, serverId: 'demo-server', type: 'TvChannel', mediaType: 'Video'
        }]);
        expect(await page.evaluate(() => window.__demo.playRequests)).toEqual([]);
        expect(await page.evaluate(() => window.__demo.playingItemId)).toBe('channel-2');
        expect(await page.evaluate(() => window.__demo.playerCommands)).toEqual([]);
        await expect(page.locator('[is="emby-itemscontainer"]')).toHaveCount(0);
    });
}

test('accepted native tune stays busy until the selected channel actually starts', async ({page}) => {
    await selectChannel(page);
    await page.evaluate(() => { window.__demo.channelTuneDelayMs = 2000; });
    await page.keyboard.press('Enter');
    await expect(panel(page).getByRole('button', {name: 'Tuning channel…'})).toBeDisabled();
    expect(await page.evaluate(() => window.__demo.playingItemId)).toBe('channel-1');
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowRight');
    await expect(panel(page).locator('.ipep-tv-title')).toHaveText('Frame Cinema');
    await expect(panel(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__demo.nativePlayRequests)).toHaveLength(1);
    expect(await page.evaluate(() => window.__demo.playRequests)).toEqual([]);
});

test('an unavailable native bridge falls back to the authenticated session command', async ({page}) => {
    await selectChannel(page, false);
    await legacyOk(page);
    await expect(panel(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__demo.nativePlayRequests)).toEqual([]);
    expect(await page.evaluate(() => window.__demo.playRequests)).toEqual([{itemId: 'channel-2', ticks: 0}]);
    expect(await page.evaluate(() => window.__demo.playerCommands)).toEqual([]);
    await expect(page.locator('[is="emby-itemscontainer"]')).toHaveCount(0);
});

test('an acknowledged session command without playback stays open and offers a retry', async ({page}) => {
    await selectChannel(page, false);
    await page.clock.install();
    await page.evaluate(() => { window.__demo.ignorePlay = true; });
    await page.keyboard.press('Enter');
    await expect(panel(page).getByRole('button', {name: 'Tuning channel…'})).toBeDisabled();
    expect(await page.evaluate(() => window.__demo.playRequests)).toEqual([{itemId: 'channel-2', ticks: 0}]);
    await page.clock.runFor(21000);
    await expect(watch(page)).toBeEnabled();
    await expect(panel(page).locator('.ipep-tv-announcement')).toContainText(/try again/i);
    await expect(panel(page).locator('.ipep-tv-title')).toHaveText('Frame Cinema');
    expect(await page.evaluate(() => window.__demo.playingItemId)).toBe('channel-1');
    await page.evaluate(() => { window.__demo.ignorePlay = false; });
    await page.keyboard.press('Enter');
    await expect(panel(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__demo.playRequests)).toHaveLength(2);
});

test('an accepted native command without playback times out without a second tune path', async ({page}) => {
    await selectChannel(page);
    await page.clock.install();
    await page.evaluate(() => { window.__demo.ignorePlay = true; });
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__demo.nativePlayRequests.length)).toBe(1);
    await expect(panel(page).getByRole('button', {name: 'Tuning channel…'})).toBeDisabled();
    await page.keyboard.press('Enter');
    await page.clock.runFor(21000);
    await expect(watch(page)).toBeEnabled();
    await expect(panel(page).locator('.ipep-tv-announcement')).toContainText(/try again/i);
    expect(await page.evaluate(() => window.__demo.nativePlayRequests)).toHaveLength(1);
    expect(await page.evaluate(() => window.__demo.playRequests)).toEqual([]);
    expect(await page.evaluate(() => window.__demo.playingItemId)).toBe('channel-1');
    await expect(page.locator('[is="emby-itemscontainer"]')).toHaveCount(0);
});

test('a stalled session request cannot leave channel tuning busy indefinitely', async ({page}) => {
    await selectChannel(page, false);
    await page.clock.install();
    await page.evaluate(() => { window.__demo.stallPlay = true; });
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__demo.playRequests.length)).toBe(1);
    await expect(panel(page).getByRole('button', {name: 'Tuning channel…'})).toBeDisabled();
    await page.clock.runFor(21000);
    await expect(watch(page)).toBeEnabled();
    await expect(panel(page).locator('.ipep-tv-announcement')).toContainText(/try again/i);
    await expect(panel(page).locator('.ipep-tv-title')).toHaveText('Frame Cinema');
    expect(await page.evaluate(() => window.__demo.playRequests)).toHaveLength(1);
    expect(await page.evaluate(() => window.__demo.playingItemId)).toBe('channel-1');
});

test('closing during an unconfirmed tune cancels polling and cannot reopen the panel', async ({page}) => {
    await selectChannel(page, false);
    await page.clock.install();
    await page.evaluate(() => { window.__demo.ignorePlay = true; });
    await page.keyboard.press('Enter');
    await expect(panel(page).getByRole('button', {name: 'Tuning channel…'})).toBeDisabled();
    await page.clock.runFor(1000);
    await page.keyboard.press('ArrowUp');
    await expect(panel(page)).toHaveCount(0);
    const contextCalls = await page.evaluate(() => window.__demo.calls.filter((call: any) => call.path?.endsWith('/PlaybackContext')).length);
    await page.clock.runFor(25000);
    await expect(panel(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__demo.calls.filter((call: any) => call.path?.endsWith('/PlaybackContext')).length)).toBe(contextCalls);
    expect(await page.evaluate(() => window.__demo.playRequests)).toHaveLength(1);
});

test('closing before the native action attaches does not start a channel later', async ({page}) => {
    await selectChannel(page);
    await page.clock.install({time: new Date('2026-09-21T12:00:00Z')});
    await page.clock.pauseAt(new Date('2026-09-21T12:00:01Z'));
    await page.keyboard.press('Enter');
    await expect(panel(page).getByRole('button', {name: 'Tuning channel…'})).toBeDisabled();
    await page.keyboard.press('ArrowUp');
    await expect(panel(page)).toHaveCount(0);
    await page.clock.runFor(1000);
    expect(await page.evaluate(() => window.__demo.nativePlayRequests)).toEqual([]);
    expect(await page.evaluate(() => window.__demo.playRequests)).toEqual([]);
    expect(await page.evaluate(() => window.__demo.playingItemId)).toBe('channel-1');
    await expect(page.locator('[is="emby-itemscontainer"]')).toHaveCount(0);
});
