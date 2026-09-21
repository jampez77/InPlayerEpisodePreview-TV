import {expect, test, type Page} from '@playwright/test';

declare global {
    interface Window {
        __demo: any;
        __unsafeExecuted?: boolean;
    }
}

const panel = (page: Page) => page.locator('#tvEpisodePreview');
const title = (page: Page) => panel(page).locator('.ipep-tv-title');

async function open(page: Page, query = '') {
    await page.goto(`/demo/index.html${query}#/video`);
    await page.keyboard.press('ArrowDown');
    await expect(panel(page)).toHaveAttribute('data-state', 'episode');
}

test('TV opens with Down, identifies the playing episode, and closes with Up', async ({page}) => {
    await open(page);
    await expect(page.locator('#popupPreviewButton')).toHaveCount(0);
    await expect(title(page)).toHaveText('The Glass Station');
    await expect(panel(page)).toHaveAccessibleName('Browse episodes');
    await expect(panel(page).locator('.ipep-tv-season')).toHaveText('Season 1 · The Far Coast · Episode 2');
    await expect(panel(page).locator('.ipep-tv-series')).toHaveText('The Long Way Home');
    await expect(panel(page).locator('.ipep-tv-description')).toContainText('Beyond the last train stop');
    await expect(panel(page).locator('.ipep-tv-image')).toBeVisible();
    await expect(panel(page).getByText('Currently playing', {exact: true})).toBeVisible();
    await expect(panel(page).getByRole('button', {name: 'Return to episode'})).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(panel(page)).toHaveCount(0);
    await expect(page.getByRole('button', {name: 'Pause', exact: true})).toBeFocused();
    expect(await page.evaluate(() => window.__demo.playerCommands)).toEqual([]);
});

for (const {name, expected} of [
    {name: 'Season 1', expected: 'Season 1 · Episode 2'},
    {name: 'Series 1', expected: 'Season 1 · Episode 2'},
    {name: 'Chapter 1', expected: 'Season 1 · Episode 2'},
    {name: '  sErIeS  01  ', expected: 'Season 1 · Episode 2'},
    {name: 'Chapter 1: Home', expected: 'Season 1 · Chapter 1: Home · Episode 2'},
]) {
    test(`season label avoids duplicate numbering while preserving titles: ${name}`, async ({page}) => {
        await page.goto('/demo/index.html#/video');
        await page.evaluate(seasonName => { window.__demo.seasons[0].Name = seasonName; }, name);
        await page.keyboard.press('ArrowDown');
        await expect(panel(page)).toHaveAttribute('data-state', 'episode');
        await expect(panel(page).locator('.ipep-tv-season')).toHaveText(expected);
    });
}

test('left and right form a continuous sequence across seasons and wrap the whole show', async ({page}) => {
    await open(page);
    await page.keyboard.press('ArrowRight');
    await expect(title(page)).toHaveText('Across the Quiet Water');
    await expect(panel(page).locator('.ipep-tv-season')).toHaveText('Season 2 · Beyond the Signal · Episode 1');
    await page.keyboard.press('ArrowLeft');
    await expect(title(page)).toHaveText('The Glass Station');
    await page.keyboard.press('ArrowLeft');
    await expect(title(page)).toHaveText('A Light on the Shore');
    await expect(panel(page).locator('.ipep-tv-announcement')).toContainText('First episode');
    await page.keyboard.press('ArrowLeft');
    await expect(title(page)).toHaveText('The Road Back');
    await expect(panel(page).locator('.ipep-tv-season')).toHaveText('Season 2 · Beyond the Signal · Episode 2');
    await expect(panel(page).locator('.ipep-tv-announcement')).toHaveText('Wrapped to the last episode');
    await expect(panel(page).locator('.ipep-tv-count')).toHaveText('4 / 4 episodes');
    await page.keyboard.press('ArrowRight');
    await expect(title(page)).toHaveText('A Light on the Shore');
    await expect(panel(page).locator('.ipep-tv-announcement')).toHaveText('Back to the first episode');
    await expect(panel(page).locator('.ipep-tv-count')).toHaveText('1 / 4 episodes');
    expect(await page.evaluate(() => window.__demo.playerCommands)).toEqual([]);
});

test('native command events are cancelled before the player can seek', async ({page}) => {
    await page.goto('/demo/index.html#/video');
    async function command(value: string) {
        return page.evaluate(command => {
            const event = new CustomEvent('command', {detail: {command}, bubbles: true, cancelable: true});
            document.activeElement!.dispatchEvent(event);
            return event.defaultPrevented;
        }, value);
    }
    expect(await command('down')).toBe(true);
    await expect(panel(page)).toHaveAttribute('data-state', 'episode');
    expect(await command('right')).toBe(true);
    await expect(title(page)).toHaveText('Across the Quiet Water');
    expect(await command('left')).toBe(true);
    await expect(title(page)).toHaveText('The Glass Station');
    expect(await command('up')).toBe(true);
    await expect(panel(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__demo.playerCommands)).toEqual([]);
});

test('holding Back after closing the browser cannot navigate away from playback', async ({page}) => {
    await open(page);
    await page.evaluate(() => {
        window.addEventListener('keydown', event => {
            if (event.key === 'Escape') window.__demo.playerCommands.push('Escape');
        });
    });
    await page.keyboard.down('Escape');
    await expect(panel(page)).toHaveCount(0);
    await page.keyboard.down('Escape');
    await page.keyboard.down('Escape');
    expect(await page.evaluate(() => window.__demo.playerCommands)).toEqual([]);
    await page.keyboard.up('Escape');
    // A fresh Back press after release belongs to Jellyfin again.
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => window.__demo.playerCommands)).toEqual(['Escape']);
});

test('Enter resumes the selected episode through the existing session endpoint', async ({page}) => {
    await open(page);
    await page.keyboard.press('ArrowRight');
    await expect(panel(page).getByRole('button', {name: 'Resume episode'})).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(panel(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__demo.playRequests)).toEqual([{itemId: 'episode-3', ticks: 9000000000}]);
    await page.keyboard.press('ArrowDown');
    await expect(title(page)).toHaveText('Across the Quiet Water');
    await expect(panel(page).getByText('Currently playing', {exact: true})).toBeVisible();
});

test('remote selection still works when the host blocks synthetic click events', async ({page}) => {
    await open(page);
    await page.keyboard.press('ArrowRight');
    await page.evaluate(() => {
        // Jellyfin's Firefox/Edge click capture rejects clicks after an intercepted keydown.
        document.addEventListener('click', event => {
            event.preventDefault();
            event.stopImmediatePropagation();
        }, true);
    });
    await page.keyboard.press('Enter');
    await expect(panel(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__demo.playRequests)).toEqual([{itemId: 'episode-3', ticks: 9000000000}]);
});

test('playback failures keep the selected episode visible and allow retry', async ({page}) => {
    await open(page);
    await page.keyboard.press('ArrowRight');
    await page.evaluate(() => { window.__demo.failPlay = true; });
    await page.keyboard.press('Enter');
    await expect(panel(page).locator('.ipep-tv-announcement')).toContainText('Could not start playback');
    await expect(title(page)).toHaveText('Across the Quiet Water');
    await expect(panel(page).getByRole('button', {name: 'Resume episode'})).toBeEnabled();
    await page.evaluate(() => { window.__demo.failPlay = false; });
    await page.keyboard.press('Enter');
    await expect(panel(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__demo.playRequests.length)).toBe(2);
});

test('late episode data cannot reopen a panel closed by route navigation', async ({page}) => {
    await page.goto('/demo/index.html#/video');
    await page.evaluate(() => { window.__demo.delayMs = 300; });
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => page.evaluate(() => window.__demo.calls.some((call: any) => call.method === 'getItem'))).toBe(true);
    await expect(panel(page)).toHaveCount(0);
    await page.evaluate(() => { location.hash = '/home'; });
    await expect(panel(page)).toHaveCount(0);
    // Covers both sequential getItem and episode/season requests completing after departure.
    await page.waitForTimeout(750);
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveClass(/ipep-tv-preview-open/);
    await page.keyboard.press('ArrowDown');
    await expect(panel(page)).toHaveCount(0);
});

test('a stale now-playing lookup cannot replace the identity in a reopened browser', async ({page}) => {
    await page.goto('/demo/index.html#/video');
    await page.evaluate(() => {
        document.querySelector('.btnUserRating')!.removeAttribute('data-id');
        const client = (window as any).ApiClient;
        const ajax = client.ajax;
        let calls = 0;
        client.ajax = (request: any) => {
            if (request.url.endsWith('/PlaybackContext')) {
                calls++;
                if (calls === 1) return new Promise(resolve => { window.__demo.resolveOldPlaying = resolve; });
                return Promise.resolve({PlayingItemId: 'episode-3'});
            }
            return ajax(request);
        };
    });
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => page.evaluate(() => typeof window.__demo.resolveOldPlaying)).toBe('function');
    await expect(panel(page)).toHaveCount(0);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowDown');
    await expect(title(page)).toHaveText('Across the Quiet Water');
    await page.evaluate(() => window.__demo.resolveOldPlaying({PlayingItemId: 'episode-2'}));
    await page.keyboard.press('ArrowLeft');
    await expect(title(page)).toHaveText('The Glass Station');
    await expect(panel(page).getByText('Currently playing', {exact: true})).toBeHidden();
    await page.keyboard.press('ArrowRight');
    await expect(panel(page).getByText('Currently playing', {exact: true})).toBeVisible();
});

test('loading errors have a working remote retry action', async ({page}) => {
    await page.goto('/demo/index.html#/video');
    await page.evaluate(() => { window.__demo.failLoad = true; });
    await page.keyboard.press('ArrowDown');
    await expect(panel(page)).toHaveAttribute('data-state', 'error');
    await expect(panel(page).getByRole('button', {name: 'Try loading preview again'})).toBeFocused();
    await page.evaluate(() => { window.__demo.failLoad = false; });
    await page.keyboard.press('Enter');
    await expect(title(page)).toHaveText('The Glass Station');
});

test('non-TV keeps its player button and original desktop popup', async ({page}) => {
    await page.goto('/demo/index.html?layout=desktop#/video');
    const button = page.locator('#popupPreviewButton');
    await expect(button).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect(panel(page)).toHaveCount(0);
    await button.click();
    await expect(page.locator('#popupFocusContainer')).toBeVisible();
    await expect(page.locator('#previewPopup')).toContainText('The Glass Station');
    await expect(panel(page)).toHaveCount(0);
});

test('changing layout removes the TV panel and restores the non-TV player button', async ({page}) => {
    await open(page);
    await page.evaluate(() => window.__demo.setLayout('desktop'));
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator('#popupPreviewButton')).toBeVisible();
    await page.evaluate(() => window.__demo.setLayout('tv'));
    await expect(page.locator('#popupPreviewButton')).toHaveCount(0);
    await page.keyboard.press('ArrowDown');
    await expect(panel(page)).toHaveAttribute('data-state', 'episode');
});

test('other player dialogs and editable fields retain their remote input', async ({page}) => {
    await page.goto('/demo/index.html#/video');
    await page.evaluate(() => {
        const container = document.createElement('div');
        container.className = 'dialogContainer';
        container.innerHTML = '<div class="dialog opened" role="dialog" aria-modal="true"><button id="subtitle-option">English subtitles</button></div>';
        document.body.append(container);
        document.getElementById('subtitle-option')!.focus();
    });
    await page.keyboard.press('ArrowDown');
    await expect(panel(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__demo.playerCommands)).toEqual(['ArrowDown']);
    await page.evaluate(() => {
        document.querySelector('.dialogContainer')!.remove();
        const input = document.createElement('input');
        input.id = 'search-input';
        document.body.append(input);
        input.focus();
    });
    await page.keyboard.press('ArrowDown');
    await expect(panel(page)).toHaveCount(0);
});

test('a new host dialog closes the episode overlay and keeps its own focus', async ({page}) => {
    await open(page);
    await page.evaluate(() => {
        const container = document.createElement('div');
        container.className = 'dialogContainer';
        container.innerHTML = '<div class="dialog opened" role="dialog" aria-modal="true"><button id="host-dialog-action">Continue playback</button></div>';
        document.body.append(container);
        document.getElementById('host-dialog-action')!.focus();
    });
    await expect(panel(page)).toHaveCount(0);
    await expect(page.getByRole('button', {name: 'Continue playback'})).toBeFocused();
    await expect(page.locator('html')).not.toHaveClass(/ipep-tv-preview-open/);
    await page.keyboard.press('ArrowDown');
    await expect(panel(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__demo.playerCommands)).toEqual(['ArrowDown']);
});

test('an autoplay item change closes the old episode browser and opens on the new item', async ({page}) => {
    await open(page);
    await page.evaluate(() => window.__demo.setPlaying('episode-3'));
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveClass(/ipep-tv-preview-open/);
    await page.keyboard.press('ArrowDown');
    await expect(title(page)).toHaveText('Across the Quiet Water');
    await expect(panel(page).getByText('Currently playing', {exact: true})).toBeVisible();
});

test('missing artwork and overview render explicit useful fallbacks', async ({page}) => {
    await open(page, '?scenario=missing');
    await expect(panel(page).getByText('No episode image', {exact: true})).toBeVisible();
    await expect(panel(page).locator('.ipep-tv-image')).toBeHidden();
    await expect(panel(page).locator('.ipep-tv-description')).toHaveText('No description available for this episode.');
    await page.keyboard.press('ArrowRight');
    await expect(panel(page).locator('.ipep-tv-image')).toBeVisible();
});

test('library metadata is rendered as text without executing markup', async ({page}) => {
    await open(page, '?scenario=unsafe');
    await expect(title(page)).toHaveText('<img src=x onerror="window.__unsafeExecuted=true">');
    await expect(panel(page).locator('.ipep-tv-season')).toContainText('<b>Untrusted season</b>');
    await expect(panel(page).locator('.ipep-tv-description')).toContainText('<script>window.__unsafeExecuted=true</script>');
    expect(await page.evaluate(() => window.__unsafeExecuted)).toBeUndefined();
    await expect(panel(page).locator('script, .ipep-tv-title img, .ipep-tv-description b, .ipep-tv-season b')).toHaveCount(0);
});
