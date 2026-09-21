import {expect, test, type Page} from '@playwright/test';

const panel = (page: Page) => page.locator('#tvEpisodePreview');
const selected = {
    episode: {id: 'episode-3', previous: 'episode-2', name: 'Across the Quiet Water', busy: 'Starting episode…'},
    channel: {id: 'channel-2', previous: 'channel-1', name: 'Frame Cinema', busy: 'Tuning channel…'}
};

async function selectNextItem(page: Page, kind: keyof typeof selected = 'episode') {
    await page.goto(`/demo/index.html?media=${kind === 'channel' ? 'live-tv' : kind}&native-playback=1#/video`);
    await page.evaluate(async () => {
        // Exercise real HTMLMediaElement playback state. A canvas stream keeps
        // these checks independent of codecs, downloaded media, and fake getters.
        const streams: MediaStream[] = [];
        const createStream = () => {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 16;
            const context = canvas.getContext('2d')!;
            let frame = 0;
            const draw = () => {
                context.fillStyle = ++frame % 2 ? '#16364c' : '#507b85';
                context.fillRect(0, 0, canvas.width, canvas.height);
            };
            draw();
            const stream = canvas.captureStream(25);
            setInterval(draw, 40);
            streams.push(stream);
            return stream;
        };
        const createVideo = () => {
            const video = document.createElement('video');
            video.className = 'htmlvideoplayer';
            video.muted = true;
            video.playsInline = true;
            video.style.cssText = 'position:absolute;width:16px;height:16px;top:0;left:0;pointer-events:none';
            document.body.appendChild(video);
            return video;
        };
        const video = createVideo();
        video.srcObject = createStream();
        await video.play();
        (window as any).__localPlaybackTest = {video, streams, createStream, createVideo};
        window.__demo.ignorePlay = true;
    });
    await expect.poll(() => page.evaluate(() => {
        const video = document.querySelector<HTMLVideoElement>('video.htmlvideoplayer')!;
        return !video.paused && !video.ended && video.readyState >= 2;
    })).toBe(true);
    await page.keyboard.press('ArrowDown');
    await expect(panel(page)).toHaveAttribute('data-kind', kind);
    await page.keyboard.press('ArrowRight');
    await expect(panel(page).locator('.ipep-tv-title')).toHaveText(selected[kind].name);
}

async function requestPlayback(page: Page, kind: keyof typeof selected = 'episode') {
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__demo.nativePlayRequests.length)).toBe(1);
    await expect(panel(page).getByRole('button', {name: selected[kind].busy})).toBeDisabled();
}

async function changeLocalPlayback(page: Page, id: string, options: {replaceElement?: boolean, paused?: boolean} = {}) {
    await page.evaluate(async ({id, replaceElement, paused}) => {
        const state = (window as any).__localPlaybackTest;
        const oldVideo: HTMLVideoElement = state.video;
        oldVideo.pause();
        const video: HTMLVideoElement = replaceElement ? state.createVideo() : oldVideo;
        // Replacing the element while retaining the source also needs to be
        // recognised: Jellyfin may recreate its local player between items.
        video.srcObject = replaceElement ? oldVideo.srcObject : state.createStream();
        if (replaceElement) oldVideo.remove();
        state.video = video;
        document.querySelector<HTMLElement>('.btnUserRating')!.dataset.id = id;
        if (!paused) await video.play();
    }, {id, ...options});
}

async function contextCalls(page: Page) {
    return page.evaluate(() => window.__demo.calls.filter((call: any) => call.path?.endsWith('/PlaybackContext')).length);
}

for (const kind of ['episode', 'channel'] as const) {
    test(`local ${kind} playback closes promptly while the server still reports the previous item`, async ({page}) => {
        await selectNextItem(page, kind);
        await requestPlayback(page, kind);
        await changeLocalPlayback(page, selected[kind].id, {replaceElement: kind === 'channel'});
        await expect(panel(page)).toHaveCount(0, {timeout: 1500});
        await expect(page.locator('html')).not.toHaveClass(/ipep-tv-preview-open/);
        expect(await page.evaluate(() => window.__demo.playingItemId)).toBe(selected[kind].previous);
        expect(await page.evaluate(() => window.__demo.playRequests)).toEqual([]);
        const callsAfterClose = await contextCalls(page);
        // Remain closed beyond another server poll, then allow a fresh Down.
        await page.waitForTimeout(750);
        await expect(panel(page)).toHaveCount(0);
        expect(await contextCalls(page)).toBe(callsAfterClose);
        await page.keyboard.press('ArrowDown');
        await expect(panel(page).locator('.ipep-tv-title')).toHaveText(selected[kind].name);
        await expect(panel(page).getByRole('button', {name: `Return to ${kind}`, exact: true})).toBeFocused();
    });
}

test('selected metadata with the original stream still playing does not close the preview', async ({page}) => {
    await selectNextItem(page);
    await requestPlayback(page);
    const callsBefore = await contextCalls(page);
    await page.evaluate(() => {
        document.querySelector<HTMLElement>('.btnUserRating')!.dataset.id = 'episode-3';
    });
    await expect.poll(() => contextCalls(page)).toBeGreaterThan(callsBefore);
    await expect(panel(page).getByRole('button', {name: selected.episode.busy})).toBeDisabled();
    expect(await page.evaluate(() => {
        const state = (window as any).__localPlaybackTest;
        return state.video.srcObject === state.streams[0] && !state.video.paused && state.video.readyState >= 2;
    })).toBe(true);
});

test('a selected replacement source stays open while paused and closes when playback starts', async ({page}) => {
    await selectNextItem(page);
    await requestPlayback(page);
    await changeLocalPlayback(page, selected.episode.id, {paused: true});
    const callsBefore = await contextCalls(page);
    await expect.poll(() => contextCalls(page)).toBeGreaterThan(callsBefore);
    await expect(panel(page).getByRole('button', {name: selected.episode.busy})).toBeDisabled();
    expect(await page.evaluate(() => (window as any).__localPlaybackTest.video.paused)).toBe(true);
    await page.evaluate(async () => { await (window as any).__localPlaybackTest.video.play(); });
    await expect(panel(page)).toHaveCount(0, {timeout: 1500});
    await expect(page.locator('html')).not.toHaveClass(/ipep-tv-preview-open/);
});

test('a hung server playback report does not block closing after local playback starts', async ({page}) => {
    await selectNextItem(page);
    await page.evaluate(() => {
        const ajax = window.ApiClient.ajax;
        window.ApiClient.ajax = async function (request: any) {
            const path = new URL(request.url, location.origin).pathname;
            if (path.endsWith('/PlaybackContext')) {
                window.__demo.calls.push({method: 'ajax', path});
                return new Promise(() => {});
            }
            return ajax.call(this, request);
        };
    });
    await requestPlayback(page);
    await expect.poll(() => contextCalls(page)).toBe(1);
    await changeLocalPlayback(page, selected.episode.id);
    await expect(panel(page)).toHaveCount(0, {timeout: 1500});
    await expect(page.locator('html')).not.toHaveClass(/ipep-tv-preview-open/);
    expect(await contextCalls(page)).toBe(1);
});

test('Up cancels local confirmation without leaving timers or navigation capture behind', async ({page}) => {
    await selectNextItem(page);
    await requestPlayback(page);
    await page.keyboard.press('ArrowUp');
    await expect(panel(page)).toHaveCount(0);
    const callsAfterClose = await contextCalls(page);
    await changeLocalPlayback(page, selected.episode.id);
    await page.clock.install();
    await page.clock.runFor(21000);
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveClass(/ipep-tv-preview-open/);
    expect(await contextCalls(page)).toBe(callsAfterClose);
    await page.keyboard.press('ArrowRight');
    expect(await page.evaluate(() => window.__demo.playerCommands)).toEqual(['ArrowRight']);
    expect(await page.evaluate(() => window.__demo.nativePlayRequests.length)).toBe(1);
});
