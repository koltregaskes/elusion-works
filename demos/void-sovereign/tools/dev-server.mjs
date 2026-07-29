/* Static dev server for the Elusion Works site.

   The site is plain static files, but Void Sovereign cannot be opened from the
   filesystem: it is ES modules under a `script-src 'self'` CSP, so it has to be
   served over HTTP. Two details matter for the dev loop and are why this exists
   rather than `python -m http.server`:

     - `.mjs` and `.js` must be served as `text/javascript`, or the browser
       refuses the module.
     - `cache-control: no-store`, so an edit is picked up on reload. Stale
       shader or module caches produce baffling "my fix did nothing" sessions.

   Usage:  node demos/void-sovereign/tools/dev-server.mjs [--port 8899]
   Serves the repo root, so sibling demos and shared assets resolve too.
*/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// tools/ -> void-sovereign/ -> demos/ -> repo root
const ROOT = path.resolve(HERE, '../../..');

const argv = process.argv.slice(2);
const portArg = argv.indexOf('--port');
const PORT = Number(
  (portArg >= 0 && argv[portArg + 1]) || process.env.PORT || 8899,
);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain' }).end('400 bad request');
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';

  const file = path.join(ROOT, pathname);
  // Refuse anything that escapes the served root.
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    res.writeHead(403, { 'content-type': 'text/plain' }).end('403 forbidden');
    return;
  }

  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('404 ' + pathname);
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(buf);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    process.stderr.write(
      `port ${PORT} is already in use — another dev server is probably running.\n`,
    );
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`Elusion Works dev server: http://127.0.0.1:${PORT}/\n`);
  process.stdout.write(`Void Sovereign:           http://127.0.0.1:${PORT}/demos/void-sovereign/\n`);
});
