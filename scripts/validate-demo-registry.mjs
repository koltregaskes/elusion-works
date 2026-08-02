import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const demosRoot = join(root, "demos");
const indexPath = join(demosRoot, "index.html");
const sitemapPath = join(root, "sitemap.xml");
const indexHtml = readFileSync(indexPath, "utf8");
const sitemapXml = readFileSync(sitemapPath, "utf8");

const fail = (message) => {
  console.error(`Demo registry validation failed: ${message}`);
  process.exitCode = 1;
};

const demoFolders = readdirSync(demosRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !entry.name.startsWith("_"))
  .map((entry) => entry.name)
  .filter((slug) => existsSync(join(demosRoot, slug, "index.html")))
  .sort();

const cardSlugs = [...indexHtml.matchAll(/class="ew-plate-link" href="([^"/]+)\//g)]
  .map((match) => match[1])
  .sort();
const sitemapSlugs = [...sitemapXml.matchAll(/<loc>https:\/\/elusionworks\.com\/demos\/([^<]+)\/<\/loc>/g)]
  .map((match) => match[1])
  .sort();

const uniqueCards = new Set(cardSlugs);
const uniqueSitemap = new Set(sitemapSlugs);
const integrationSlugs = ["ashfall", "cyberpunk-messenger"];
if (uniqueCards.size !== cardSlugs.length) fail("demos/index.html contains duplicate demo cards");
if (uniqueSitemap.size !== sitemapSlugs.length) fail("sitemap.xml contains duplicate demo routes");

for (const slug of demoFolders) {
  if (!uniqueCards.has(slug)) fail(`demo folder '${slug}' is missing from demos/index.html`);
}
for (const slug of uniqueCards) {
  if (!demoFolders.includes(slug)) fail(`demos/index.html links unknown demo '${slug}'`);
}
for (const slug of integrationSlugs) {
  if (!demoFolders.includes(slug)) fail(`required integrated demo '${slug}' has no folder`);
  if (!uniqueCards.has(slug)) fail(`required integrated demo '${slug}' has no card`);
  if (!uniqueSitemap.has(slug)) fail(`required integrated demo '${slug}' has no sitemap route`);
}

const countLabel = indexHtml.match(/aria-label="Open the (\d+)-item Demo Index"/)?.[1];
const countBadge = indexHtml.match(/class="ew-index-count"[^>]*>(\d+)</)?.[1];
if (Number(countLabel) !== demoFolders.length) {
  fail(`header label says ${countLabel ?? "nothing"} but ${demoFolders.length} demo folders exist`);
}
if (Number(countBadge) !== demoFolders.length) {
  fail(`header badge says ${countBadge ?? "nothing"} but ${demoFolders.length} demo folders exist`);
}

if (!process.exitCode) {
  console.log(`Demo registry valid: ${demoFolders.length} folders, cards and sitemap routes.`);
}
