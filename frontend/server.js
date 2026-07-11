import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const port = Number(process.env.FRONTEND_PORT || 5173);
const root = resolve('frontend/src');

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8'
};

createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  let path = normalize(url.pathname === '/' ? '/index.html' : url.pathname);
  let fullPath = resolve(join(root, path));
  if (!fullPath.startsWith(root)) {
    response.writeHead(403);
    return response.end('Forbidden');
  }
  try {
    if (statSync(fullPath).isDirectory()) {
      fullPath = join(fullPath, 'index.html');
    }
    const content = readFileSync(fullPath);
    response.writeHead(200, {
      'Content-Type': types[extname(fullPath)] || 'text/plain; charset=utf-8'
    });
    response.end(content);
  } catch {
    const content = readFileSync(join(root, 'index.html'));
    response.writeHead(200, { 'Content-Type': types['.html'] });
    response.end(content);
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Frontend listening on http://127.0.0.1:${port}`);
});
