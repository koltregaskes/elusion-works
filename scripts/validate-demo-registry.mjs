import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const demosRoot = join(root, "demos");
const indexPath = join(demosRoot, "index.html");
const sitemapPath = join(root, "sitemap.xml");
const payloadRoot = join(demosRoot, "cyberpunk-messenger");
const manifestPath = join(payloadRoot, "release-manifest.json");
const indexHtml = readFileSync(indexPath, "utf8");
const sitemapXml = readFileSync(sitemapPath, "utf8");

const fail = (message) => {
  console.error(`Demo registry validation failed: ${message}`);
  process.exitCode = 1;
};

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

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
if (uniqueCards.size !== cardSlugs.length) fail("demos/index.html contains duplicate demo cards");
if (uniqueSitemap.size !== sitemapSlugs.length) fail("sitemap.xml contains duplicate demo routes");

for (const slug of demoFolders) {
  if (!uniqueCards.has(slug)) fail(`demo folder '${slug}' is missing from demos/index.html`);
  if (!uniqueSitemap.has(slug)) fail(`demo folder '${slug}' is missing from sitemap.xml`);
}
for (const slug of uniqueCards) {
  if (!demoFolders.includes(slug)) fail(`demos/index.html links unknown demo '${slug}'`);
}
for (const slug of uniqueSitemap) {
  if (!demoFolders.includes(slug)) fail(`sitemap.xml links unknown demo '${slug}'`);
}

const countLabel = indexHtml.match(/aria-label="Open the (\d+)-item Demo Index"/)?.[1];
const countBadge = indexHtml.match(/class="ew-index-count"[^>]*>(\d+)</)?.[1];
if (Number(countLabel) !== demoFolders.length) {
  fail(`header label says ${countLabel ?? "nothing"} but ${demoFolders.length} demo folders exist`);
}
if (Number(countBadge) !== demoFolders.length) {
  fail(`header badge says ${countBadge ?? "nothing"} but ${demoFolders.length} demo folders exist`);
}

if (!existsSync(manifestPath)) {
  fail("Cyberpunk Messenger release-manifest.json is missing");
} else {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const listedFiles = new Map(manifest.files.map((file) => [file.path, file]));
  const payloadFiles = listFiles(payloadRoot)
    .map((path) => relative(payloadRoot, path).split(sep).join("/"))
    .filter((path) => path !== "DESIGN.md" && path !== "release-manifest.json")
    .sort();

  for (const path of payloadFiles) {
    if (!listedFiles.has(path)) fail(`unlisted Cyberpunk Messenger payload '${path}' may be stale`);
  }
  for (const path of listedFiles.keys()) {
    if (!payloadFiles.includes(path)) fail(`release manifest references missing payload '${path}'`);
  }

  for (const [path, expected] of listedFiles) {
    const absolutePath = join(payloadRoot, path);
    if (!existsSync(absolutePath)) continue;
    const contents = readFileSync(absolutePath);
    const sha256 = createHash("sha256").update(contents).digest("hex");
    const bytes = statSync(absolutePath).size;
    if (bytes !== expected.bytes) fail(`payload '${path}' is ${bytes} bytes, expected ${expected.bytes}`);
    if (sha256 !== expected.sha256) fail(`payload '${path}' hash does not match the release manifest`);
  }

  const routeHtml = readFileSync(join(payloadRoot, "index.html"), "utf8");
  const javascript = payloadFiles
    .filter((path) => path.endsWith(".js"))
    .map((path) => readFileSync(join(payloadRoot, path), "utf8"))
    .join("\n");
  const stylesheets = payloadFiles
    .filter((path) => path.endsWith(".css"))
    .map((path) => readFileSync(join(payloadRoot, path), "utf8"))
    .join("\n");
  const references = `${routeHtml}\n${javascript}\n${stylesheets}`;
  for (const path of listedFiles.keys()) {
    if (path === "index.html") continue;
    const basename = path.split("/").at(-1);
    if (!references.includes(basename)) {
      fail(`manifest payload '${path}' is not referenced by the shipped route`);
    }
  }
}

if (!process.exitCode) {
  console.log(
    `Demo registry valid: ${demoFolders.length} folders, cards and sitemap routes; ` +
    `${JSON.parse(readFileSync(manifestPath, "utf8")).files.length} Cyberpunk payload files verified.`
  );
}
