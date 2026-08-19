import { createServer, request as httpRequest } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const port = Number(process.env.FRONTEND_PORT || 5173);
const host = process.env.FRONTEND_HOST || '127.0.0.1';
const backendPort = Number(process.env.BACKEND_PORT || 3001);
const root = resolve('frontend/src');

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png'
};

function proxyApi(request, response) {
  const proxyRequest = httpRequest({
    hostname: '127.0.0.1',
    port: backendPort,
    path: request.url,
    method: request.method,
    headers: request.headers
  }, (proxyResponse) => {
    response.writeHead(proxyResponse.statusCode || 502, proxyResponse.headers);
    proxyResponse.pipe(response);
  });
  proxyRequest.on('error', () => {
    response.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({
      success: false,
      error: { code: 'BACKEND_UNAVAILABLE', message: '后台服务暂时不可用，请稍后重试。' }
    }));
  });
  request.pipe(proxyRequest);
}

createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    proxyApi(request, response);
    return;
  }
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
}).listen(port, host, () => {
  console.log(`Frontend listening on http://${host}:${port}`);
});
