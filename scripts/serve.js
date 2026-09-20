import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve('dist');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/book-club-vote-analyzer(?=\/|$)/, '');
    const target = resolve(root, '.' + (path.endsWith('/') ? path + 'index.html' : path));
    if (!target.startsWith(root + sep)) throw new Error('Invalid path');
    if (!(await stat(target)).isFile()) throw new Error('Not a file');
    res.writeHead(200, { 'Content-Type': mime[extname(target)] ?? 'text/plain', 'Cache-Control': 'no-store' });
    res.end(await readFile(target));
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(4173, '127.0.0.1', () => console.log('Book Buzz: http://127.0.0.1:4173/book-club-vote-analyzer/'));
