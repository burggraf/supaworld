import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
const root = resolve(process.env.DIST_DIR ?? resolve(import.meta.dirname, '../dist'));
const base = process.env.BASE_PATH ?? '/';
const headerless = process.env.HEADERLESS === '1';
const csp = JSON.parse(await readFile(resolve(root, 'csp.json'), 'utf8')).policy;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.tar': 'application/x-tar',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
createServer(async (req, res) => {
  if (!headerless) {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', csp);
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  try {
    const requestPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (!requestPath.startsWith(base)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const path = '/' + requestPath.slice(base.length);
    let file = resolve(root, `.${path === '/' ? '/index.html' : path}`);
    if (!file.startsWith(root + sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const type = types[extname(file)] ?? 'application/octet-stream';
    const enc = headerless ? '' : (req.headers['accept-encoding'] ?? '');
    for (const [token, suffix] of [
      ['br', '.br'],
      ['gzip', '.gz'],
    ])
      if (
        new RegExp(`(?:^|[, ])${token}(?:[, ;]|$)`).test(enc) &&
        !new RegExp(`${token};\\s*q=0(?:[,. ]|$)`).test(enc) &&
        (await stat(file + suffix).catch(() => null))
      ) {
        file += suffix;
        res.setHeader('Content-Encoding', token);
        break;
      }
    res.setHeader('Content-Type', type);
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader(
      'Cache-Control',
      path.startsWith('/runtime/') || path.startsWith('/assets/')
        ? 'public,max-age=31536000,immutable'
        : 'no-cache',
    );
    res.setHeader('Content-Length', String((await stat(file)).size));
    if (req.method === 'HEAD') res.end();
    else await pipeline(createReadStream(file), res);
  } catch {
    res.writeHead(500);
    res.end('Unable to serve file');
  }
}).listen(Number(process.env.PORT ?? 4173), process.env.HOST ?? '127.0.0.1', () =>
  console.log(`Supaworld static preview: http://localhost:${process.env.PORT ?? 4173}`),
);
