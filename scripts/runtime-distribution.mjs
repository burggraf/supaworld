// Produce an immutable archive for a private GitHub release or another artifact store.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const lock = JSON.parse(await readFile(join(root, 'runtime/upstream.lock.json'), 'utf8'));
await mkdir(join(root, '.cache/distributions'), { recursive: true });
const name = `supaworld-runtime-${lock.buildId}.tar.gz`;
const file = join(root, '.cache/distributions', name);
execFileSync('tar', [
  '--sort=name',
  '--mtime=@0',
  '--owner=0',
  '--group=0',
  '--numeric-owner',
  '-C',
  join(root, 'public/runtime'),
  '-czf',
  file,
  lock.buildId,
]);
const sha256 = createHash('sha256')
  .update(await readFile(file))
  .digest('hex');
await writeFile(file + '.sha256', `${sha256}  ${name}\n`);
console.log(JSON.stringify({ file, name, sha256 }));
