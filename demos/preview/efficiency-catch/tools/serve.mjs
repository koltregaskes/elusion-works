// A small static server for checking this demo locally: node demos/efficiency-catch/tools/serve.mjs [port]
// Unlike python's http.server it answers Range requests, which a browser needs before it will jump about in a video. GitHub Pages does the same.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.m4a': 'audio/mp4' };
export function serve(root, port = 0) {
  const server = http.createServer((req, res) => {
    let file = path.normalize(path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname))); if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404).end('Not found'); return; }
    const size = fs.statSync(file).size, type = TYPES[path.extname(file)] || 'application/octet-stream', range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range) { const start = range[1] ? Number(range[1]) : size - Number(range[2]), end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1; if (!(start >= 0 && start <= end)) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return; }
      res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 }); fs.createReadStream(file, { start, end }).pipe(res); return; }
    res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': size }); fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })));
}
if (import.meta.url === `file://${process.argv[1]}`) { const { url } = await serve(path.resolve(new URL('../../..', import.meta.url).pathname), Number(process.argv[2]) || 8773); console.log(`serving the repo at ${url} (the film page is ${url}/demos/efficiency-catch/)`); }
