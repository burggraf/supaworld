import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzip, brotliCompress, constants } from 'node:zlib';
import { promisify } from 'node:util';
const gz = promisify(gzip),
  br = promisify(brotliCompress);
async function* walk(dir) {
  for (const f of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, f.name);
    if (f.isDirectory()) yield* walk(path);
    else yield path;
  }
}
let raw = 0,
  compressed = 0;
for await (const path of walk(new URL('../dist/', import.meta.url).pathname)) {
  if (!/\.(wasm|tar|js|css|html|json|svg|webmanifest)$/.test(path)) continue;
  const bytes = await readFile(path);
  if (bytes.length < 1024) continue;
  const [g, b] = await Promise.all([
    gz(bytes, { level: 9 }),
    br(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }),
  ]);
  await writeFile(path + '.gz', g);
  await writeFile(path + '.br', b);
  raw += bytes.length;
  compressed += b.length;
}
console.log(
  `Precompressed static files: ${(raw / 1e6).toFixed(1)} MB raw / ${(compressed / 1e6).toFixed(1)} MB Brotli.`,
);
