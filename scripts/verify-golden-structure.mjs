import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const goldenRoot = path.join(root, 'demos', 'golden');
const routes = [
  ['index.html', 'https://elusionworks.com/demos/golden/'],
  ['about.html', 'https://elusionworks.com/demos/golden/about.html'],
  ['breed-guide.html', 'https://elusionworks.com/demos/golden/breed-guide.html'],
  ['gallery.html', 'https://elusionworks.com/demos/golden/gallery.html'],
  ['contact.html', 'https://elusionworks.com/demos/golden/contact.html'],
  ['privacy.html', 'https://elusionworks.com/demos/golden/privacy.html'],
  ['terms.html', 'https://elusionworks.com/demos/golden/terms.html'],
  ['sitemap.html', 'https://elusionworks.com/demos/golden/sitemap.html'],
];
const forbiddenClaims = [
  'hello@goldenencyclopedia.com',
  'editorial@goldenencyclopedia.com',
  'press@goldenencyclopedia.com',
  '5 Heriot Row',
  'Six writers, vets & trainers',
  'Independently funded',
];

const failures = [];
const htmlByFile = new Map();

for (const [file, canonical] of routes) {
  const source = await readFile(path.join(goldenRoot, file), 'utf8');
  htmlByFile.set(file, source);

  const canonicals = [...source.matchAll(/<link\s+rel="canonical"\s+href="([^"]+)"/gi)];
  if (canonicals.length !== 1 || canonicals[0][1] !== canonical) {
    failures.push(`${file}: expected one canonical for ${canonical}`);
  }
  if (!/<meta\s+name="description"\s+content="[^"]+"/i.test(source)) {
    failures.push(`${file}: missing meta description`);
  }
  if (!/<link\s+rel="icon"\s+href="\.\.\/\.\.\/assets\/favicon\.svg"\s+type="image\/svg\+xml">/i.test(source)) {
    failures.push(`${file}: missing shared Elusion Works favicon`);
  }
  if (!/<main\b[^>]*\bid="main-content"[^>]*>/i.test(source)) {
    failures.push(`${file}: missing #main-content skip-link target`);
  }
  if (/href\s*=\s*["']#["']/i.test(source)) {
    failures.push(`${file}: contains placeholder href="#"`);
  }
  for (const claim of forbiddenClaims) {
    if (source.toLowerCase().includes(claim.toLowerCase())) {
      failures.push(`${file}: contains unsupported claim "${claim}"`);
    }
  }
}

const chrome = await readFile(path.join(goldenRoot, 'chrome.js'), 'utf8');
if (!/class="skip-link"\s+href="#main-content"/.test(chrome)) {
  failures.push('chrome.js: missing shared skip link');
}
if (!/id="mobileMenu"[^>]*\shidden/.test(chrome)) {
  failures.push('chrome.js: closed mobile menu is not removed from the accessibility tree');
}
if (!/function bindDialog\(/.test(chrome) || !/bindDialog,/.test(chrome)) {
  failures.push('chrome.js: shared focus-safe dialog controller is missing');
}

for (const file of ['index.html', 'breed-guide.html']) {
  const source = htmlByFile.get(file);
  if (!/role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="videoModalTitle"/.test(source)) {
    failures.push(`${file}: media preview lacks dialog semantics`);
  }
  if (!/aria-controls="videoModal"\s+aria-expanded="false"/.test(source)) {
    failures.push(`${file}: media trigger lacks dialog state attributes`);
  }
}

const gallery = htmlByFile.get('gallery.html');
if (!/id="lightbox"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="lbCap"/.test(gallery)) {
  failures.push('gallery.html: lightbox lacks labelled dialog semantics');
}
if (!/aria-haspopup="dialog"\s+aria-controls="lightbox"/.test(gallery)) {
  failures.push('gallery.html: tiles do not expose their dialog relationship');
}

const rootSitemap = await readFile(path.join(root, 'sitemap.xml'), 'utf8');
const goldenSitemap = await readFile(path.join(goldenRoot, 'sitemap.xml'), 'utf8');
for (const [, canonical] of routes) {
  if (!rootSitemap.includes(`<loc>${canonical}</loc>`)) {
    failures.push(`root sitemap: missing ${canonical}`);
  }
  if (!goldenSitemap.includes(`<loc>${canonical}</loc>`)) {
    failures.push(`Golden sitemap: missing ${canonical}`);
  }
}

const robots = await readFile(path.join(root, 'robots.txt'), 'utf8');
if (!robots.includes('https://elusionworks.com/sitemap.xml')
    || !robots.includes('https://elusionworks.com/demos/golden/sitemap.xml')) {
  failures.push('robots.txt: missing root or Golden sitemap declaration');
}

const home = htmlByFile.get('index.html');
if (!home.includes('hero_video_720p.mp4') || home.includes('hero_video.mp4')) {
  failures.push('index.html: expected only the optimised 720p hero video');
}
for (const oversized of [
  'hero_cinematic_clean_highres.png',
  'studio_full_body_clean_highres.png',
  'abstract_gold_background_highres.png',
  'hero_main_dog_crop_3x.png',
]) {
  if ([...htmlByFile.values(), chrome].some((source) => source.includes(oversized))) {
    failures.push(`shipped Golden source references oversized media ${oversized}`);
  }
}

const videoSize = (await stat(path.join(goldenRoot, 'assets', 'golden', 'hero_video_720p.mp4'))).size;
if (videoSize > 700_000) {
  failures.push(`optimised hero video exceeds 700 KB (${videoSize} bytes)`);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Golden structure verified: ${routes.length} routes, no unsupported claims/placeholders, complete sitemaps, ${videoSize}-byte hero video.`);
