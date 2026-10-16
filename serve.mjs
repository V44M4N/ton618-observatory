import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';
const root = path.resolve(fileURLToPath(new URL('./dist/', import.meta.url)));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };
const port = Number(process.env.TON618_PORT || 6180);
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.resolve(root, '.' + relative);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end('Forbidden'); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' }); res.end(data);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(port, '127.0.0.1', () => {
  const address = `http://127.0.0.1:${port}`;
  console.log(`TON 618 Observatory: ${address}`);
  if (process.env.TON618_OPEN === '1' && process.platform === 'darwin') spawn('open', [address], { stdio: 'ignore' });
}).on('error', err => { console.error(`Could not open the observatory: ${err.message}`); process.exit(1); });
