import {expect, test, type Page} from '@playwright/test';

const panel = (page: Page) => page.locator('#tvEpisodePreview');
const title = (page: Page) => panel(page).locator('.ipep-tv-title');

async function settled(page: Page) {
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function watchPreviewMounts(page: Page) {
    await page.evaluate(() => {
        window.__demo.previewMounts = [];
        window.__demo.overlayActivations = [];
        new MutationObserver(records => {
            for (const record of records) {
                for (const added of record.addedNodes) {
                    if (added instanceof Element && (added.id === 'tvEpisodePreview' || added.querySelector('#tvEpisodePreview'))) {
                        window.__demo.previewMounts.push('mounted');
                    }
                }
                if (record.target === document.documentElement && record.attributeName === 'class'
                    && (record.oldValue?.includes('ipep-tv-preview-open') || document.documentElement.classList.contains('ipep-tv-preview-open'))) {
                    window.__demo.overlayActivations.push('active');
                }
            }
        }).observe(document.documentElement, {subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: ['class']});
    });
}

test('pre-roll previews the upcoming film and recommendations without claiming the feature is already playing', async ({page}) => {
    await page.goto('/demo/index.html?scenario=preroll#/video');
    await expect(page.locator('.btnUserRating')).toHaveAttribute('data-id', 'intro-1');
    await page.keyboard.press('ArrowDown');
    await expect(title(page)).toHaveText('The Last Meridian');
    await expect(panel(page).locator('.ipep-tv-playing')).toHaveText('Up next');
    await expect(panel(page).getByText('Currently playing', {exact: true})).toHaveCount(0);
    await expect(panel(page).getByRole('button', {name: 'Play film', exact: true})).toBeFocused();
    await expect(panel(page).locator('.ipep-tv-announcement')).toHaveText('Upcoming film');
    await page.keyboard.press('ArrowRight');
    await expect(title(page)).toHaveText('A Map of Silence');
    await expect(panel(page).locator('.ipep-tv-playing')).toBeHidden();
    await page.keyboard.press('ArrowLeft');
    await expect(panel(page).locator('.ipep-tv-playing')).toHaveText('Up next');
    await page.keyboard.press('ArrowUp');
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator('.btnUserRating')).toHaveAttribute('data-id', 'intro-1');
    expect(await page.evaluate(() => window.__demo.playRequests)).toEqual([]);
});

test('explicitly selecting the upcoming film starts it while simply opening the panel does not', async ({page}) => {
    await page.goto('/demo/index.html?scenario=preroll#/video');
    await page.keyboard.press('ArrowDown');
    await expect(title(page)).toHaveText('The Last Meridian');
    expect(await page.evaluate(() => window.__demo.playRequests)).toEqual([]);
    await page.keyboard.press('Enter');
    await expect(panel(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__demo.playRequests)).toEqual([{itemId: 'movie-1', ticks: 0}]);
    await expect(page.locator('.btnUserRating')).toHaveAttribute('data-id', 'movie-1');
    await page.keyboard.press('ArrowDown');
    await expect(panel(page).locator('.ipep-tv-playing')).toHaveText('Currently playing');
    await expect(panel(page).getByRole('button', {name: 'Return to film'})).toBeVisible();
});

test('a pre-roll before an episode opens the complete show on its upcoming episode', async ({page}) => {
    await page.goto('/demo/index.html?scenario=preroll&media=episode#/video');
    await page.keyboard.press('ArrowDown');
    await expect(title(page)).toHaveText('The Glass Station');
    await expect(panel(page).locator('.ipep-tv-playing')).toHaveText('Up next');
    await expect(panel(page).getByRole('button', {name: 'Play episode', exact: true})).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(title(page)).toHaveText('Across the Quiet Water');
    await expect(panel(page).locator('.ipep-tv-playing')).toBeHidden();
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('.btnUserRating')).toHaveAttribute('data-id', 'intro-1');
    expect(await page.evaluate(() => window.__demo.playRequests)).toEqual([]);
});

test('an intro missing from getItem can still resolve a confirmed upcoming feature from the session', async ({page}) => {
    await page.goto('/demo/index.html?scenario=preroll#/video');
    await page.evaluate(() => {
        const client = (window as any).ApiClient;
        const getItem = client.getItem.bind(client);
        client.getItem = (userId: string, id: string) => id === 'intro-1'
            ? Promise.reject({status: 404}) : getItem(userId, id);
    });
    await page.keyboard.press('ArrowDown');
    await expect(title(page)).toHaveText('The Last Meridian');
    await expect(panel(page).locator('.ipep-tv-playing')).toHaveText('Up next');
    expect(await page.evaluate(() => window.__demo.playRequests)).toEqual([]);
});

test('a playback-only intro resolves from session context before the OSD exposes a rating item ID', async ({page}) => {
    await page.goto('/demo/index.html?scenario=preroll#/video');
    await page.evaluate(() => {
        document.querySelector('.btnUserRating')!.removeAttribute('data-id');
        const client = (window as any).ApiClient;
        const getItem = client.getItem.bind(client);
        client.getItem = (userId: string, id: string) => id === 'intro-1'
            ? Promise.reject({status: 404}) : getItem(userId, id);
    });
    await page.keyboard.press('ArrowDown');
    await expect(title(page)).toHaveText('The Last Meridian');
    await expect(panel(page).locator('.ipep-tv-playing')).toHaveText('Up next');
    await expect(panel(page).getByRole('button', {name: 'Play film', exact: true})).toBeFocused();
    expect(await page.evaluate(() => window.__demo.calls.some((call: any) => call.path?.endsWith('/PlaybackContext')))).toBe(true);
    expect(await page.evaluate(() => window.__demo.calls.some((call: any) => call.path?.endsWith('/NowPlayingItem')))).toBe(false);
    await page.keyboard.press('ArrowUp');
    await expect(panel(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__demo.playingItemId)).toBe('intro-1');
    expect(await page.evaluate(() => window.__demo.playRequests)).toEqual([]);
});

test('a delayed initial session identity cannot open an old feature after the OSD changes to another film', async ({page}) => {
    await page.goto('/demo/index.html?scenario=preroll#/video');
    await watchPreviewMounts(page);
    await page.evaluate(() => {
        document.querySelector('.btnUserRating')!.removeAttribute('data-id');
        const staleContext = {
            PlayingItemId: 'intro-1', PlayingItemType: 'Video', PlaylistItemId: 'queue-intro',
            Queue: JSON.parse(JSON.stringify(window.__demo.playbackQueue))
        };
        const client = (window as any).ApiClient;
        const ajax = client.ajax.bind(client);
        let contextRequests = 0;
        client.ajax = (request: any) => {
            if (!request.url.endsWith('/PlaybackContext')) return ajax(request);
            // The session report can lag behind the player. Keep later context reads stale too.
            if (++contextRequests > 1) return Promise.resolve(staleContext);
            return new Promise(resolve => {
                window.__demo.resolveInitialIntroContext = () => resolve(staleContext);
            });
        };
    });
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => page.evaluate(() => typeof window.__demo.resolveInitialIntroContext)).toBe('function');
    await page.evaluate(() => window.__demo.setPlaying('movie-2'));
    await expect(page.locator('.btnUserRating')).toHaveAttribute('data-id', 'movie-2');
    await page.evaluate(() => window.__demo.resolveInitialIntroContext());
    await settled(page);
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveClass(/ipep-tv-preview-open/);
    expect(await page.evaluate(() => window.__demo.previewMounts)).toEqual([]);
    expect(await page.evaluate(() => window.__demo.playRequests)).toEqual([]);
    // The rejected lookup must release the controller so a new request uses the new film.
    await page.keyboard.press('ArrowDown');
    await expect(title(page)).toHaveText('A Map of Silence');
    await expect(panel(page).locator('.ipep-tv-playing')).toHaveText('Currently playing');
});

test('the OSD exposing an equivalent compact GUID does not close a valid preview resolved from session context', async ({page}) => {
    await page.goto('/demo/index.html?scenario=preroll#/video');
    const introId = 'a1b2c3d4-1111-2222-3333-444455556666';
    await page.evaluate(introId => {
        window.__demo.intros[0].Id = introId;
        window.__demo.playbackQueue[0].Id = introId;
        window.__demo.setPlaying(introId);
        document.querySelector('.btnUserRating')!.removeAttribute('data-id');
    }, introId);
    await page.keyboard.press('ArrowDown');
    await expect(title(page)).toHaveText('The Last Meridian');
    await expect(panel(page).locator('.ipep-tv-playing')).toHaveText('Up next');
    expect(await page.evaluate(() => window.__demo.calls.some((call: any) => call.path?.endsWith('/PlaybackContext')))).toBe(true);
    await page.evaluate(compactId => {
        (document.querySelector('.btnUserRating') as HTMLElement).dataset.id = compactId;
    }, introId.replace(/-/g, ''));
    await settled(page);
    await expect(title(page)).toHaveText('The Last Meridian');
    await expect(panel(page).locator('.ipep-tv-playing')).toHaveText('Up next');
    await expect(panel(page).getByRole('button', {name: 'Play film', exact: true})).toBeFocused();
    await expect(page.locator('html')).toHaveClass(/ipep-tv-preview-open/);
    expect(await page.evaluate(() => window.__demo.playRequests)).toEqual([]);
});

for (const missingItem of [false, true]) {
    test(`a trailer with no queued feature never mounts a panel or steals focus (${missingItem ? 'playback-only item' : 'library item'})`, async ({page}) => {
        await page.goto('/demo/index.html?scenario=trailer-no-feature#/video');
        if (missingItem) {
            await page.evaluate(() => {
                const client = (window as any).ApiClient;
                const getItem = client.getItem.bind(client);
                client.getItem = (userId: string, id: string) => id === 'trailer-1'
                    ? Promise.reject({status: 404}) : getItem(userId, id);
            });
        }
        await watchPreviewMounts(page);
        await page.keyboard.press('ArrowDown');
        await expect.poll(() => page.evaluate(() => window.__demo.calls.filter((call: any) => call.path?.endsWith('/PlaybackContext')).length)).toBe(1);
        await settled(page);
        await expect(panel(page)).toHaveCount(0);
        await expect(page.locator('html')).not.toHaveClass(/ipep-tv-preview-open/);
        await expect(page.getByRole('button', {name: 'Pause', exact: true})).toBeFocused();
        expect(await page.evaluate(() => window.__demo.previewMounts)).toEqual([]);
        expect(await page.evaluate(() => window.__demo.overlayActivations)).toEqual([]);
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('Enter');
        expect(await page.evaluate(() => window.__demo.playerCommands)).toEqual(['ArrowRight', 'Enter']);
        expect(await page.evaluate(() => window.__demo.playRequests)).toEqual([]);
    });
}

test('failed upcoming-feature details never replace an intro with an error panel', async ({page}) => {
    await page.goto('/demo/index.html?scenario=preroll#/video');
    await watchPreviewMounts(page);
    await page.evaluate(() => {
        (window as any).ApiClient.getSimilarItems = async () => {
            window.__demo.featureLoadFailed = true;
            throw new Error('offline');
        };
    });
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => page.evaluate(() => window.__demo.featureLoadFailed)).toBe(true);
    await settled(page);
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveClass(/ipep-tv-preview-open/);
    await expect(page.getByRole('button', {name: 'Pause', exact: true})).toBeFocused();
    expect(await page.evaluate(() => window.__demo.previewMounts)).toEqual([]);
    expect(await page.evaluate(() => window.__demo.playRequests)).toEqual([]);
});

for (const departure of ['Back', 'route'] as const) {
    test(`${departure} during a pending intro lookup prevents a late preview from opening`, async ({page}) => {
        await page.goto('/demo/index.html?scenario=preroll#/video');
        await watchPreviewMounts(page);
        await page.evaluate(() => {
            const client = (window as any).ApiClient;
            const ajax = client.ajax.bind(client);
            client.ajax = (request: any) => request.url.endsWith('/PlaybackContext')
                ? new Promise(resolve => {
                    window.__demo.resolveIntroContext = () => Promise.resolve(ajax(request)).then(value => {
                        resolve(value);
                        return value;
                    });
                }) : ajax(request);
        });
        await page.keyboard.press('ArrowDown');
        await expect.poll(() => page.evaluate(() => typeof window.__demo.resolveIntroContext)).toBe('function');
        await expect(panel(page)).toHaveCount(0);
        await expect(page.locator('html')).not.toHaveClass(/ipep-tv-preview-open/);
        if (departure === 'Back') {
            await page.keyboard.press('Escape');
        } else {
            await page.evaluate(() => {
                location.hash = '/home';
                const home = document.createElement('button');
                home.id = 'preroll-home';
                home.textContent = 'Home';
                document.body.prepend(home);
                home.focus();
            });
        }
        await page.evaluate(() => window.__demo.resolveIntroContext());
        await settled(page);
        await expect(panel(page)).toHaveCount(0);
        await expect(page.locator('html')).not.toHaveClass(/ipep-tv-preview-open/);
        expect(await page.evaluate(() => window.__demo.previewMounts)).toEqual([]);
        expect(await page.evaluate(() => window.__demo.playRequests)).toEqual([]);
        if (departure === 'route') await expect(page.locator('#preroll-home')).toBeFocused();
        else await expect(page.getByRole('button', {name: 'Pause', exact: true})).toBeFocused();
    });
}

test('the feature starting naturally closes the intro preview and reopens with the current-playing marker', async ({page}) => {
    await page.goto('/demo/index.html?scenario=preroll#/video');
    await page.keyboard.press('ArrowDown');
    await expect(panel(page).locator('.ipep-tv-playing')).toHaveText('Up next');
    await page.evaluate(() => window.__demo.setPlaying('movie-1'));
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveClass(/ipep-tv-preview-open/);
    await page.keyboard.press('ArrowDown');
    await expect(title(page)).toHaveText('The Last Meridian');
    await expect(panel(page).locator('.ipep-tv-playing')).toHaveText('Currently playing');
    await expect(panel(page).getByRole('button', {name: 'Return to film'})).toBeVisible();
    expect(await page.evaluate(() => window.__demo.playRequests)).toEqual([]);
});
