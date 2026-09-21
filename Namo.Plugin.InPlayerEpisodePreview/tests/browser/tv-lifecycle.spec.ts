import {expect, test, type Page} from '@playwright/test';

const panel = (page: Page) => page.locator('#tvEpisodePreview');

async function addSharedHeader(page: Page) {
    await page.evaluate(() => {
        const header = document.createElement('header');
        header.className = 'skinHeader';
        header.innerHTML = '<button id="host-back" type="button">Back</button><button id="host-home" type="button">Home</button>';
        document.body.prepend(header);
        window.__demo.lifecycle = {clicks: [], keys: [], focusAtClick: []};
        header.addEventListener('click', event => {
            window.__demo.lifecycle.clicks.push((event.target as HTMLElement).id);
            window.__demo.lifecycle.focusAtClick.push(document.activeElement?.id);
        });
        header.addEventListener('keydown', event => window.__demo.lifecycle.keys.push(event.key));
    });
}

async function open(page: Page) {
    await page.goto('/demo/index.html#/video');
    await addSharedHeader(page);
    await page.keyboard.press('ArrowDown');
    await expect(panel(page)).toHaveAttribute('data-state', 'episode');
}

test('clicking a shared header button closes the preview and acts on the first click', async ({page}) => {
    await open(page);
    // Keep the test header above the full-screen player, as Jellyfin's shared header is.
    await page.locator('.skinHeader').evaluate(header => {
        (header as HTMLElement).style.cssText = 'position:fixed;top:0;left:0;z-index:999999';
    });
    await page.locator('#host-home').click();
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator('#host-home')).toBeFocused();
    expect(await page.evaluate(() => window.__demo.lifecycle.clicks)).toEqual(['host-home']);
    expect(await page.evaluate(() => window.__demo.lifecycle.focusAtClick)).toEqual(['host-home']);
});

test('shared Back and Home buttons retain focus and their first click immediately after leaving video', async ({page}) => {
    await open(page);
    // Deliberately omit keyup, as can happen when the host changes views during a remote press.
    await page.keyboard.down('ArrowDown');
    const result = await page.evaluate(() => {
        location.hash = '/home';
        // Run before the asynchronous hashchange handler: focus must validate the current route itself.
        for (const id of ['host-back', 'host-home']) {
            const button = document.getElementById(id)!;
            button.focus();
            button.click();
        }
        const down = new KeyboardEvent('keydown', {key: 'ArrowDown', code: 'ArrowDown', repeat: true, bubbles: true, cancelable: true});
        document.getElementById('host-home')!.dispatchEvent(down);
        return {...window.__demo.lifecycle, downPrevented: down.defaultPrevented, focused: document.activeElement?.id};
    });
    expect(result.focusAtClick).toEqual(['host-back', 'host-home']);
    expect(result.clicks).toEqual(['host-back', 'host-home']);
    expect(result.focused).toBe('host-home');
    expect(result.keys).toEqual(['ArrowDown']);
    expect(result.downPrevented).toBe(false);
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveClass(/ipep-tv-preview-open/);
});

for (const loading of [false, true]) {
    test(`viewbeforehide releases focus and held remote keys before host handlers (${loading ? 'pending load' : 'open preview'})`, async ({page}) => {
        await page.goto('/demo/index.html#/video');
        await addSharedHeader(page);
        if (loading) {
            await page.evaluate(() => {
                const client = (window as any).ApiClient;
                const getItem = client.getItem.bind(client);
                client.getItem = (...args: any[]) => new Promise(resolve => {
                    window.__demo.resolveLifecycleItem = () => resolve(getItem(...args));
                });
            });
        }
        await page.keyboard.down('ArrowDown');
        if (loading) {
            await expect.poll(() => page.evaluate(() => typeof window.__demo.resolveLifecycleItem)).toBe('function');
        } else {
            await expect(panel(page)).toHaveAttribute('data-state', 'episode');
        }
        const result = await page.evaluate(() => {
            const player = document.querySelector('[data-type="video-osd"]')!;
            const host = window.__demo.lifecycle;
            player.addEventListener('viewbeforehide', () => {
                // Jellyfin starts changing the page from this target handler. Plugin cleanup must precede it.
                host.panelAtHide = Boolean(document.getElementById('tvEpisodePreview'));
                host.overlayClassAtHide = document.documentElement.classList.contains('ipep-tv-preview-open');
                location.hash = '/home';
                const home = document.getElementById('host-home')!;
                home.focus();
                host.focusAtHide = document.activeElement?.id;
                host.prevented = ['ArrowDown', 'Enter'].map(key => {
                    const event = new KeyboardEvent('keydown', {key, code: key, repeat: false, bubbles: true, cancelable: true});
                    home.dispatchEvent(event);
                    return event.defaultPrevented;
                });
                home.click();
            }, {once: true});
            player.dispatchEvent(new CustomEvent('viewbeforehide', {bubbles: true}));
            return host;
        });
        expect(result.panelAtHide).toBe(false);
        expect(result.overlayClassAtHide).toBe(false);
        expect(result.focusAtHide).toBe('host-home');
        expect(result.keys).toEqual(['ArrowDown', 'Enter']);
        expect(result.prevented).toEqual([false, false]);
        expect(result.clicks).toEqual(['host-home']);
        await expect(panel(page)).toHaveCount(0);
        if (loading) {
            await page.evaluate(async () => {
                window.__demo.resolveLifecycleItem();
                // Let the deferred getItem and its downstream fixture requests finish.
                await new Promise(resolve => setTimeout(resolve, 50));
            });
            await expect(panel(page)).toHaveCount(0);
            await expect(page.locator('#host-home')).toBeFocused();
        }
    });
}

for (const disposition of ['hidden', 'removed'] as const) {
    test(`a ${disposition} player cannot reopen a preview or capture the shared header while the URL still says video`, async ({page}) => {
        await open(page);
        const focused = await page.evaluate(disposition => {
            const player = document.querySelector('[data-type="video-osd"]')!;
            if (disposition === 'hidden') player.classList.add('hide');
            else player.remove();
            document.getElementById('host-home')!.focus();
            return document.activeElement?.id;
        }, disposition);
        expect(focused).toBe('host-home');
        await expect(page).toHaveURL(/#\/video$/);
        await expect(panel(page)).toHaveCount(0);
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await expect(panel(page)).toHaveCount(0);
        await expect(page.locator('#host-home')).toBeFocused();
        expect(await page.evaluate(() => window.__demo.lifecycle.keys)).toEqual(['ArrowDown', 'Enter']);
        expect(await page.evaluate(() => window.__demo.lifecycle.clicks)).toEqual(['host-home']);
    });
}

for (const key of ['Escape', 'Enter']) {
    test(`a fresh ${key} press is not lost when the previous closing press had no keyup`, async ({page}) => {
        await open(page);
        await page.keyboard.down(key);
        await expect(panel(page)).toHaveCount(0);
        const result = await page.evaluate(key => {
            const home = document.getElementById('host-home')!;
            home.focus();
            const event = new KeyboardEvent('keydown', {key, code: key, repeat: false, bubbles: true, cancelable: true});
            home.dispatchEvent(event);
            return {prevented: event.defaultPrevented, keys: window.__demo.lifecycle.keys};
        }, key);
        expect(result.prevented).toBe(false);
        expect(result.keys).toEqual([key]);
        await expect(panel(page)).toHaveCount(0);
        await expect(page.locator('#host-home')).toBeFocused();
    });
}
