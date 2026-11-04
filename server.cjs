/* Optional static-file preview server. Runtime message delivery belongs to the C# host. */
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pipeline } = require('node:stream');
const { scanMedia } = require('./scripts/media-manifest.cjs');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg', '.otf': 'font/otf', '.woff2': 'font/woff2' };
function createLedServer(options = {}) {
  const root = path.resolve(options.root || __dirname);
  const dtaqRoot = path.resolve(options.dtaqRoot || path.join(root, '../dtaq'));
  function send(res, code, payload) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(payload)); }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); send(res, 405, { error: 'Method not allowed' }); return; }
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch { send(res, 400, { error: '잘못된 URL입니다.' }); return; }
    try {
      if (pathname === '/dtaq') { res.writeHead(302, { Location: '/dtaq/' + new URL(req.url, 'http://localhost').search }); res.end(); return; }
      if (pathname === '/api/media' && req.method === 'GET') { send(res, 200, scanMedia(path.join(root, 'commonfiles'))); return; }
      const kiosk = pathname === '/dtaq' || pathname.startsWith('/dtaq/');
      const base = kiosk ? dtaqRoot : root;
      let relative = kiosk ? pathname.slice('/dtaq'.length) : pathname;
      if (!relative || relative.endsWith('/')) relative += 'index.html';
      const parts = relative.split('/');
      if (parts.some(part => part.startsWith('.') || part.includes('\\') || part.includes(':') || part.includes('\0'))) { send(res, 403, { error: '접근할 수 없는 경로입니다.' }); return; }
      const filename = path.resolve(base, '.' + relative);
      if (!filename.startsWith(base + path.sep)) { send(res, 403, { error: '접근할 수 없는 경로입니다.' }); return; }
      // Only public web assets are served, never source scripts, README or Git data.
      const contentType = MIME[path.extname(filename).toLowerCase()];
      if (!contentType) { send(res, 404, { error: '파일을 찾을 수 없습니다.' }); return; }
      const real = await fsp.realpath(filename), realBase = await fsp.realpath(base);
      if (!real.startsWith(realBase + path.sep)) { send(res, 403, { error: '접근할 수 없는 경로입니다.' }); return; }
      const stat = await fsp.stat(real);
      if (!stat.isFile()) { send(res, 404, { error: '파일을 찾을 수 없습니다.' }); return; }
      const headers = { 'Content-Type': contentType, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
      let start = 0, end = stat.size - 1, code = 200;
      if (req.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if (!match || (!match[1] && !match[2])) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); res.end(); return; }
        if (!match[1]) start = Math.max(0, stat.size - Number(match[2]));
        else { start = Number(match[1]); if (match[2]) end = Math.min(Number(match[2]), end); }
        if (start > end || start >= stat.size || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); res.end(); return; }
        headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`; code = 206;
      }
      headers['Content-Length'] = stat.size === 0 ? 0 : end - start + 1;
      res.writeHead(code, headers);
      if (req.method === 'HEAD' || stat.size === 0) res.end();
      else pipeline(fs.createReadStream(real, { start, end }), res, () => {});
    } catch (error) {
      if (!res.headersSent) send(res, ['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : 500, { error: '파일 또는 서버 설정을 확인해주세요.' });
      else res.end();
    }
  });
  return server;
}
if (require.main === module) {
  const port = Number(process.env.PORT || 8090), host = process.env.HOST || '127.0.0.1';
  const server = createLedServer();
  server.listen(port, host, () => { console.log(`LED preview: http://${host}:${port}/`); console.log(`DTaQ: http://${host}:${port}/dtaq/`); });
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `포트 ${port}을 사용 중입니다. PORT 환경변수로 다른 포트를 지정해주세요.` : error.message); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(); });
}
module.exports = { createLedServer };
