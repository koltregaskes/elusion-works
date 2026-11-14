import assert from 'node:assert/strict';

export const showreelRoutes = new Set(['turbofan-teardown','cinematic-dive','voxel-battle','living-scene','wrecking-ball','octopus-jar','drivable-town'].map(slug => `demos/${slug}/index.html`));

// Exercise real controls within the existing route audit, without another browser or job.
export async function verifyShowreelControls(page, route) {
  if (route.includes('/turbofan-teardown/')) {
    await page.locator('#explode').fill('700');
    assert.equal(await page.locator('#explode').inputValue(), '700');
    await page.locator('#explode').press('ArrowRight');
    assert.ok(Number(await page.locator('#explode').inputValue()) > 700);
  } else if (route.includes('/cinematic-dive/')) {
    await page.locator('#magnet').click();
    assert.match(await page.locator('#toast').textContent(), /No reservation/);
    await page.evaluate(() => scrollTo(0, 0));
  } else if (route.includes('/voxel-battle/')) {
    await page.locator('#bPlay').click();
    assert.equal(await page.locator('#bPlay').textContent(), 'Play');
    await page.locator('#bRestart').click();
  } else if (route.includes('/living-scene/')) {
    await page.locator('[data-m="2"]').click();
    await page.waitForFunction(() => document.getElementById('moodName').textContent === 'Moonlit night');
    await page.locator('[data-m="0"]').click();
    await page.locator('#hideBtn').click();
    assert.equal(await page.locator('#ui').evaluate(el => el.inert), true);
    assert.equal(await page.locator('[data-m="0"]').isVisible(), false);
    await page.locator('#showUI').click();
    assert.equal(await page.locator('#ui').evaluate(el => el.inert), false);
    assert.equal(await page.locator('[data-m="0"]').isVisible(), true);
  } else if (route.includes('/wrecking-ball/')) {
    await page.locator('#mass').fill('1000');
    assert.equal(await page.locator('#massVal').textContent(), '1000 kg');
    await page.locator('#reset').click();
  } else if (route.includes('/octopus-jar/')) {
    await page.locator('#phaseBtns button').nth(3).click();
    await page.waitForFunction(() => document.getElementById('h-phase').textContent.includes('climb'));
  } else if (route.includes('/drivable-town/')) {
    await page.locator('[data-key="KeyE"]').click();
    assert.equal(await page.evaluate(() => window.__town.player.walking), true);
    await page.locator('[data-key="KeyC"]').click();
    assert.equal(await page.locator('[data-key="KeyW"]').isVisible(), true);
  }
}
