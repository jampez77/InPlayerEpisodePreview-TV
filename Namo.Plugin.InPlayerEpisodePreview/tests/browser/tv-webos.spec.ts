import {expect, test, type Page} from '@playwright/test';

// webOS 6 uses Chromium 79. This is a targeted CSS compatibility check, not a
// complete TV emulator: ignore declarations that engine cannot apply while
// retaining its supported Grid layout and gap behavior.
async function useWebOs6Css(page: Page) {
    await page.route('**/Web/InPlayerPreview.js', async route => {
        const response = await route.fetch();
        const body = (await response.text()).replace(/\b(?:inset|aspect-ratio)\s*:[^;{}]*;/g, '');
        await route.fulfill({response, body});
    });
    await page.goto('/demo/index.html#/video');
    await page.evaluate(() => {
        const removeFlexGap = (rules: CSSRuleList) => {
            Array.from(rules).forEach(rule => {
                if (rule instanceof CSSStyleRule && /^(inline-)?flex$/.test(rule.style.display)) {
                    rule.style.removeProperty('gap');
                    rule.style.removeProperty('row-gap');
                    rule.style.removeProperty('column-gap');
                }
                if ('cssRules' in rule) removeFlexGap((rule as CSSGroupingRule).cssRules);
            });
        };
        Array.from(document.styleSheets).forEach(sheet => removeFlexGap(sheet.cssRules));
    });
}

async function remotePress(page: Page, keyCode: number, key = 'Unidentified') {
    return page.evaluate(({keyCode, key}) => {
        const target = document.activeElement!;
        const down = new KeyboardEvent('keydown', {keyCode, key, bubbles: true, cancelable: true});
        target.dispatchEvent(down);
        target.dispatchEvent(new KeyboardEvent('keyup', {keyCode, key, bubbles: true, cancelable: true}));
        return down.defaultPrevented;
    }, {keyCode, key});
}

test('webOS 6 legacy remote keys open an onscreen preview without modern CSS support', async ({page}) => {
    await page.setViewportSize({width: 1920, height: 1080});
    await useWebOs6Css(page);
    expect(await remotePress(page, 40, 'Down')).toBe(true);
    const panel = page.locator('#tvEpisodePreview');
    await expect(panel).toHaveAttribute('data-state', 'episode');
    await expect(panel.locator('.ipep-tv-title')).toHaveText('The Glass Station');
    // toBeVisible alone accepts a rendered element entirely below the screen.
    await expect.poll(async () => {
        const box = await panel.boundingBox();
        return box ? Math.abs(box.y + box.height - 1080) : Infinity;
    }).toBeLessThanOrEqual(1);
    const bounds = await panel.boundingBox();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x).toBeCloseTo(0, 0);
    expect(bounds!.width).toBeCloseTo(1920, 0);
    const artwork = await panel.locator('.ipep-tv-image-frame').boundingBox();
    expect(artwork).not.toBeNull();
    expect(artwork!.width / artwork!.height).toBeCloseTo(16 / 9, 1);

    expect(await remotePress(page, 39)).toBe(true);
    await expect(panel.locator('.ipep-tv-title')).toHaveText('Across the Quiet Water');
    expect(await remotePress(page, 37)).toBe(true);
    await expect(panel.locator('.ipep-tv-title')).toHaveText('The Glass Station');
    expect(await remotePress(page, 38)).toBe(true);
    await expect(panel).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__demo.playerCommands)).toEqual([]);
});
