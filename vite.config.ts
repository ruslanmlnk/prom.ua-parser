import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const attachFetchProxy = (middlewares: any) => {
  middlewares.use('/api/fetch', async (req: any, res: any) => {
    try {
      const requestUrl = new URL(req.url || '', 'http://localhost');
      const target = requestUrl.searchParams.get('url');

      if (!target) {
        res.statusCode = 400;
        res.end('Missing url');
        return;
      }

      const targetUrl = new URL(target);
      if (!['http:', 'https:'].includes(targetUrl.protocol)) {
        res.statusCode = 400;
        res.end('Unsupported protocol');
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
      res.statusCode = response.status;
      res.setHeader('content-type', response.headers.get('content-type') || 'text/html; charset=utf-8');
      res.end(text);
    } catch (error) {
      res.statusCode = 502;
      res.end(error instanceof Error ? error.message : 'Proxy request failed');
    }
  });
};

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        react(),
        {
          name: 'prom-fetch-proxy',
          configureServer(server) {
            attachFetchProxy(server.middlewares);
          },
          configurePreviewServer(server) {
            attachFetchProxy(server.middlewares);
          },
        },
      ],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
