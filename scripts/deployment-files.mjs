import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
  (m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`,
);
const csp = `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' ${hashes.join(' ')}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'`;
if (process.env.VITE_PAGES === '1') {
  // Pages ignores _headers. Protect the document with a meta policy there.
  await writeFile(
    new URL('../dist/index.html', import.meta.url),
    html.replace('<head>', `<head>\n<meta http-equiv="Content-Security-Policy" content="${csp}">`),
  );
  await writeFile(new URL('../dist/.nojekyll', import.meta.url), '');
}
await writeFile(
  new URL('../dist/_headers', import.meta.url),
  `/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Resource-Policy: same-origin
  X-Content-Type-Options: nosniff
  Referrer-Policy: same-origin
  Content-Security-Policy: ${csp}
/runtime/*
  Cache-Control: public, max-age=31536000, immutable
/assets/*
  Cache-Control: public, max-age=31536000, immutable
/index.html
  Cache-Control: no-cache
/sw.js
  Cache-Control: no-cache
`,
);
await writeFile(new URL('../dist/csp.json', import.meta.url), JSON.stringify({ policy: csp }));
