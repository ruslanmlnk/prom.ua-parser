import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { createServer } from 'node:http';

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
const rootDir = resolve('dist');

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const sendText = (res, statusCode, text, contentType = 'text/plain; charset=utf-8') => {
  res.writeHead(statusCode, { 'content-type': contentType });
  res.end(text);
};

const proxyFetch = async (req, res) => {
  try {
    const requestUrl = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
    const target = requestUrl.searchParams.get('url');

    if (!target) {
      sendText(res, 400, 'Missing url');
      return;
    }

    const targetUrl = new URL(target);
    if (!['http:', 'https:'].includes(targetUrl.protocol)) {
      sendText(res, 400, 'Unsupported protocol');
      return;
    }

    const response = await fetch(targetUrl, {
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });

    const text = await response.text();
    res.writeHead(response.status, {
      'content-type': response.headers.get('content-type') || 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(text);
  } catch (error) {
    sendText(res, 502, error instanceof Error ? error.message : 'Proxy request failed');
  }
};

const serveFile = (res, filePath) => {
  const type = mimeTypes[extname(filePath).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'content-type': type });
  createReadStream(filePath).pipe(res);
};

const resolveStaticPath = (pathname) => {
  const decodedPath = decodeURIComponent(pathname);
  const safePath = normalize(decodedPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(rootDir, safePath);

  if (!filePath.startsWith(rootDir)) return null;
  if (existsSync(filePath) && statSync(filePath).isFile()) return filePath;
  return null;
};

createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (requestUrl.pathname === '/api/fetch') {
    await proxyFetch(req, res);
    return;
  }

  const staticPath = resolveStaticPath(requestUrl.pathname);
  if (staticPath) {
    serveFile(res, staticPath);
    return;
  }

  const indexPath = join(rootDir, 'index.html');
  if (existsSync(indexPath)) {
    serveFile(res, indexPath);
    return;
  }

  sendText(res, 500, 'Build not found. Run npm run build first.');
}).listen(port, host, () => {
  console.log(`Server listening on http://${host}:${port}`);
});
