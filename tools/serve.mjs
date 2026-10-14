// Локальный сервер без зависимостей: node tools/serve.mjs [порт] [--open]
// Нужен, потому что браузеры не запускают ES-модули с file://.
// Слушает только этот компьютер (127.0.0.1); если порт занят — берёт следующий свободный.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const open = args.includes('--open');
let port = parseInt(args.find((a) => /^\d+$/.test(a)) || process.env.PORT || '8000', 10);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
};

process.on('uncaughtException', (err) => console.error('[serve] ошибка:', err.message));

const server = http.createServer((req, res) => {
  let p;
  try {
    p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400); res.end('Bad request'); return;
  }
  if (p.endsWith('/')) p += 'index.html';
  const file = path.resolve(root, '.' + p);
  const rel = path.relative(root, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) { res.writeHead(403); res.end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Не найдено: ' + p); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(file).on('error', () => res.end()).pipe(res);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && port < 8100) {
    console.log(`Порт ${port} занят, пробую ${port + 1}…`);
    port += 1;
    setTimeout(() => server.listen(port, '127.0.0.1'), 50);
  } else {
    console.error('[serve] не удалось запустить сервер:', err.message);
    process.exitCode = 1;
  }
});

server.listen(port, '127.0.0.1', () => {
  const url = `http://localhost:${port}/`;
  console.log(`Презентация: ${url}`);
  console.log(`Окно спикера: ${url}presenter.html`);
  console.log('Остановить — Ctrl+C (или закройте это окно)');
  if (open) {
    const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    exec(cmd, () => {});
  }
});
