import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const baseUrl = (process.env.GOLDEN_BASE_URL || 'http://127.0.0.1:4173/demos/golden/').replace(/\/?$/, '/');
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined;
const screenshotDir = process.env.GOLDEN_SCREENSHOT_DIR || '';
const routes = [
  '',
  'about.html',
  'breed-guide.html',
  'gallery.html',
  'contact.html',
  'privacy.html',
  'terms.html',
  'sitemap.html',
];
const widths = [320, 360, 375, 390, 414, 430, 1440];
const failures = [];
const browser = await chromium.launch({ executablePath, headless: true });

function expectedCanonical(route) {
  return `https://elusionworks.com/demos/golden/${route}`;
}

for (const width of widths) {
  const context = await browser.newContext({
    viewport: { width, height: width === 1440 ? 1000 : 844 },
    colorScheme: width === 1440 ? 'dark' : 'light',
  });

  for (const route of routes) {
    const page = await context.newPage();
    const consoleMessages = [];
    const failedRequests = [];
    const badResponses = [];
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        consoleMessages.push(`${message.type()}: ${message.text()}`);
      }
    });
    page.on('pageerror', (error) => consoleMessages.push(`pageerror: ${error.message}`));
    page.on('requestfailed', (request) => {
      failedRequests.push(`${request.url()} (${request.failure()?.errorText || 'unknown'})`);
    });
    page.on('response', (response) => {
      if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`);
    });

    const url = `${baseUrl}${route}`;
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
    const snapshot = await page.evaluate(() => ({
      canonical: [...document.querySelectorAll('link[rel="canonical"]')].map((node) => node.href),
      descriptions: [...document.querySelectorAll('meta[name="description"]')].map((node) => node.content),
      placeholderLinks: document.querySelectorAll('a[href="#"]').length,
      mainTargets: document.querySelectorAll('main#main-content').length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      brokenImages: [...document.images]
        .filter((image) => image.getAttribute('src') && (!image.complete || image.naturalWidth === 0))
        .map((image) => image.currentSrc || image.src),
      text: document.body.innerText,
    }));

    const label = `${width}px ${route || 'index.html'}`;
    if (response?.status() !== 200) failures.push(`${label}: HTTP ${response?.status() || 0}`);
    if (snapshot.canonical.length !== 1 || snapshot.canonical[0] !== expectedCanonical(route)) {
      failures.push(`${label}: incorrect canonical ${JSON.stringify(snapshot.canonical)}`);
    }
    if (snapshot.descriptions.length !== 1 || !snapshot.descriptions[0]) {
      failures.push(`${label}: missing meta description`);
    }
    if (snapshot.placeholderLinks !== 0) failures.push(`${label}: placeholder links found`);
    if (snapshot.mainTargets !== 1) failures.push(`${label}: expected one #main-content`);
    if (snapshot.overflow > 1) failures.push(`${label}: horizontal overflow ${snapshot.overflow}px`);
    if (snapshot.brokenImages.length) failures.push(`${label}: broken images ${snapshot.brokenImages.join(', ')}`);
    if (consoleMessages.length) failures.push(`${label}: ${consoleMessages.join(' | ')}`);
    if (failedRequests.length) failures.push(`${label}: failed requests ${failedRequests.join(' | ')}`);
    if (badResponses.length) failures.push(`${label}: bad responses ${badResponses.join(' | ')}`);
    for (const forbidden of [
      'hello@goldenencyclopedia.com',
      'editorial@goldenencyclopedia.com',
      'press@goldenencyclopedia.com',
      '5 Heriot Row',
    ]) {
      if (snapshot.text.includes(forbidden)) failures.push(`${label}: unsupported public claim ${forbidden}`);
    }
    await page.close();
  }
  await context.close();
}

const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });
const page = await context.newPage();
await page.goto(baseUrl, { waitUntil: 'networkidle' });

const internalLinks = new Set();
for (const route of routes) {
  await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle' });
  const hrefs = await page.locator('a[href]').evaluateAll((links) => links.map((link) => link.href));
  for (const href of hrefs) {
    const target = new URL(href);
    if (target.origin === new URL(baseUrl).origin) {
      target.hash = '';
      internalLinks.add(target.href);
    }
  }
}
for (const href of internalLinks) {
  const response = await context.request.get(href);
  if (!response.ok()) failures.push(`internal link: ${response.status()} ${href}`);
}

await page.goto(baseUrl, { waitUntil: 'networkidle' });
await page.keyboard.press('Tab');
if (await page.locator(':focus').getAttribute('href') !== '#main-content') {
  failures.push('keyboard: skip link is not the first focus target');
}
await page.keyboard.press('Enter');
if (await page.evaluate(() => document.activeElement?.id) !== 'main-content') {
  failures.push('keyboard: skip link did not focus main content');
}

await page.click('#menuBtn');
if (await page.evaluate(() => document.activeElement?.id) !== 'menuClose') {
  failures.push('mobile menu: initial focus is not inside the dialog');
}
await page.keyboard.press('Shift+Tab');
if (!await page.evaluate(() => document.getElementById('mobileMenu').contains(document.activeElement))) {
  failures.push('mobile menu: reverse tab escaped the dialog');
}
await page.keyboard.press('Escape');
if (await page.evaluate(() => document.activeElement?.id) !== 'menuBtn') {
  failures.push('mobile menu: focus did not return to the trigger');
}

await page.click('#searchBtn');
if (await page.evaluate(() => document.activeElement?.id) !== 'searchInput') {
  failures.push('search: input did not receive initial focus');
}
await page.fill('#searchInput', 'grooming');
if (await page.locator('#searchResults li').count() < 1) failures.push('search: grooming returned no result');
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
if (await page.evaluate(() => document.activeElement?.id) !== 'searchBtn') {
  failures.push('search: focus did not return to the trigger');
}
if (!await page.locator('#searchOverlay').evaluate((node) => node.hidden)) {
  failures.push('search: overlay remained exposed after close');
}

await page.click('#watchVideo');
if (await page.evaluate(() => document.activeElement?.id) !== 'vmClose') {
  failures.push('media dialog: close control did not receive initial focus');
}
await page.keyboard.press('Tab');
if (!await page.evaluate(() => document.getElementById('videoModal').contains(document.activeElement))) {
  failures.push('media dialog: tab escaped the dialog');
}
await page.keyboard.press('Escape');
if (await page.evaluate(() => document.activeElement?.id) !== 'watchVideo') {
  failures.push('media dialog: focus did not return to its trigger');
}

await page.locator('#gallery').scrollIntoViewIfNeeded();
const beforeScroll = await page.locator('#homeCarousel').evaluate((node) => node.scrollLeft);
await page.click('#carNext');
await page.waitForTimeout(500);
const afterScroll = await page.locator('#homeCarousel').evaluate((node) => node.scrollLeft);
if (afterScroll <= beforeScroll) failures.push('homepage carousel: next control did not move the rail');

const mobileVideo = await page.locator('#heroVideo').evaluate((video) => video.currentSrc);
if (mobileVideo) failures.push(`mobile media: unexpected video request ${mobileVideo}`);

await page.goto(`${baseUrl}gallery.html`, { waitUntil: 'networkidle' });
await page.click('[data-filter="portrait"]');
if (await page.locator('.gp-tile').count() !== 5) failures.push('gallery: portrait filter count changed');
await page.click('[data-filter="all"]');
await page.click('[data-view="grid"]');
if (!await page.locator('#grid').evaluate((node) => node.classList.contains('gp-grid-fixed'))) {
  failures.push('gallery: grid view did not activate');
}
const firstTile = page.locator('.gp-tile').first();
await firstTile.click();
await page.waitForFunction(() => document.getElementById('lightbox').classList.contains('open'));
if (await page.evaluate(() => document.activeElement?.id) !== 'lbClose') {
  failures.push('lightbox: close control did not receive initial focus');
}
const firstCount = await page.locator('#lbCount').textContent();
await page.keyboard.press('ArrowRight');
if (await page.locator('#lbCount').textContent() === firstCount) failures.push('lightbox: ArrowRight did not advance');
await page.keyboard.press('Escape');
if (!await page.evaluate(() => document.activeElement?.classList.contains('gp-tile'))) {
  failures.push('lightbox: focus did not return to the opened tile');
}

await page.goto(`${baseUrl}contact.html`, { waitUntil: 'networkidle' });
await page.fill('#cName', 'Demo QA');
await page.fill('#cEmail', 'demo@example.com');
await page.fill('#cMsg', 'Checking the non-sending demo interaction.');
await page.click('button[type="submit"]');
if (!/no message was sent/i.test(await page.locator('#cOk').textContent())) {
  failures.push('contact demo: submit did not return the non-sending confirmation');
}

if (screenshotDir) {
  await mkdir(screenshotDir, { recursive: true });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(screenshotDir, 'golden-home-390.png'), fullPage: false });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(screenshotDir, 'golden-home-1440.png'), fullPage: false });
}

await context.close();
await browser.close();

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Golden browser verified: ${routes.length * widths.length} route/viewport checks, ${internalLinks.size} internal links, plus keyboard, search, media, gallery, carousel and contact interactions.`);
