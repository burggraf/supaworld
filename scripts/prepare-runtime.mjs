import { readFile, writeFile, mkdir, cp, access, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const lock = JSON.parse(await readFile(join(root, 'runtime/upstream.lock.json'), 'utf8'));
const out = join(root, 'public/runtime', lock.buildId);
const exists = (p) =>
  access(p).then(
    () => true,
    () => false,
  );
if (await exists(join(out, 'manifest.json'))) {
  const manifest = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));
  if (
    (
      await Promise.all(
        manifest.files.map(async (f) => {
          try {
            const bytes = await readFile(join(out, f.name));
            return (
              bytes.length === f.size &&
              createHash('sha256').update(bytes).digest('hex') === f.sha256
            );
          } catch {
            return false;
          }
        }),
      )
    ).every(Boolean)
  ) {
    console.log(`Runtime ${lock.buildId} already prepared.`);
    process.exit(0);
  }
}
// The application release retains the exact runtime independently of expiring upstream CI artifacts.
if (
  lock.distribution &&
  !process.env.SUPAWORLD_UPSTREAM_SOURCE &&
  !process.env.SUPAWORLD_BUILD_FROM_SOURCE
) {
  const distCache = join(root, '.cache/distributions');
  await mkdir(distCache, { recursive: true });
  const archive = join(distCache, lock.distribution.name);
  if (!(await exists(archive))) {
    const url = `https://github.com/${lock.distribution.repository}/releases/download/${lock.distribution.tag}/${lock.distribution.name}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Cannot download retained runtime: HTTP ${response.status}`);
    await writeFile(archive, new Uint8Array(await response.arrayBuffer()));
  }
  const sha = createHash('sha256')
    .update(await readFile(archive))
    .digest('hex');
  if (sha !== lock.distribution.sha256) throw new Error('Runtime distribution checksum mismatch.');
  await mkdir(join(root, 'public/runtime'), { recursive: true });
  execFileSync('tar', ['-xzf', archive, '-C', join(root, 'public/runtime')]);
  const manifest = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));
  if (manifest.buildId !== lock.buildId) throw new Error('Wrong runtime distribution.');
  console.log(`Verified and unpacked runtime ${lock.buildId} from its retained release.`);
  process.exit(0);
}
const cache = join(root, '.cache/runtime', lock.commit);
const source = join(cache, 'source');
await mkdir(cache, { recursive: true });
if (!(await exists(join(source, 'browser/src/host/page.ts')))) {
  const local = process.env.SUPAWORLD_UPSTREAM_SOURCE;
  if (local) {
    const sha = execFileSync('git', ['-C', resolve(local), 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    if (sha !== lock.commit) throw new Error(`Local upstream must be at ${lock.commit}`);
    await mkdir(source, { recursive: true });
    // Read committed files so local edits cannot silently change a pinned build.
    const archive = execFileSync(
      'git',
      [
        '-C',
        resolve(local),
        'archive',
        lock.commit,
        'browser/src',
        'bundle/sql',
        'bundle/licenses',
        'LICENSE',
      ],
      { maxBuffer: 32 * 1024 * 1024 },
    );
    execFileSync('tar', ['-x', '-C', source], { input: archive });
  } else {
    const checkout = join(cache, 'checkout');
    if (!(await exists(join(checkout, '.git'))))
      execFileSync(
        'gh',
        ['repo', 'clone', lock.repository, checkout, '--', '--no-checkout', '--filter=blob:none'],
        { stdio: 'inherit' },
      );
    execFileSync('git', ['-C', checkout, 'fetch', '--depth=1', 'origin', lock.commit], {
      stdio: 'inherit',
    });
    execFileSync('git', ['-C', checkout, 'checkout', '--detach', lock.commit], {
      stdio: 'inherit',
    });
    await mkdir(source, { recursive: true });
    for (const path of ['browser/src', 'bundle/sql', 'bundle/licenses', 'LICENSE'])
      await cp(join(checkout, path), join(source, path), { recursive: true });
  }
}
// This one integration patch is applied to the build cache, never to the upstream checkout.
const page = join(source, 'browser/src/host/page.ts');
let text = await readFile(page, 'utf8');
for (const name of ['kernel', 'process', 'probe']) {
  const before = `absolute("/dist/${name}.js")`;
  const after = `absolute(SUPAWORLD_RUNTIME_BASE + "/${name}.js")`;
  if (!text.includes(before) && !text.includes(after))
    throw new Error(`Worker URL patch no longer matches: ${name}`);
  text = text.replace(before, after);
}
await writeFile(page, text);
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const [guest, spec] of Object.entries(lock.archives)) {
  const dir = join(cache, `guest-${guest}`);
  const archive = join(dir, `${guest}-dist.tar`);
  await mkdir(dir, { recursive: true });
  if (!(await exists(archive)))
    execFileSync(
      'gh',
      [
        'run',
        'download',
        String(lock.runId),
        '--repo',
        lock.repository,
        '--name',
        `guest-${guest}`,
        '--dir',
        dir,
      ],
      { stdio: 'inherit' },
    );
  const digest = createHash('sha256')
    .update(await readFile(archive))
    .digest('hex');
  if (digest !== spec.sha256) throw new Error(`Checksum mismatch for ${guest}; refusing to build`);
  execFileSync('tar', ['-xf', archive, '-C', cache]);
}
const dist = (g) => join(cache, g, 'dist');
for (const [guest, file, name] of [
  ['postgres', 'postgres.wasm', 'postgres.wasm'],
  ['postgres', 'template.tar.zst.stamp', 'template.stamp'],
  ['postgrest', 'postgrest.wasm', 'postgrest.wasm'],
  ['auth', 'auth.wasm', 'auth.wasm'],
  ['storage', 'storage.wasm', 'storage.wasm'],
  ['realtime', 'realtime.wasm', 'beam.wasm'],
])
  await cp(join(dist(guest), file), join(out, name));
execFileSync('zstd', [
  '-dqf',
  join(dist('postgres'), 'template.tar.zst'),
  '-o',
  join(out, 'template.tar'),
]);
for (const [guest, name, paths] of [
  ['postgres', 'pg.tar', ['share', 'lib']],
  ['storage', 'storage-image.tar', ['runtime']],
  ['realtime', 'realtime-release.tar', ['release']],
]) {
  execFileSync('tar', [
    '--sort=name',
    '--mtime=@0',
    '--owner=0',
    '--group=0',
    '--numeric-owner',
    '-C',
    dist(guest),
    '-cf',
    join(out, name),
    ...paths,
  ]);
}
const buildOptions = {
  entryPoints: Object.fromEntries(
    [
      ['kernel', 'kernel/main'],
      ['process', 'process/main'],
      ['probe', 'probe/main'],
    ].map(([key, path]) => [key, join(source, `browser/src/${path}.ts`)]),
  ),
  outdir: out,
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  loader: { '.sql': 'text' },
};
await build(buildOptions);
await build({
  ...buildOptions,
  entryPoints: { page: join(source, 'browser/src/host/page.ts') },
  // Resolve against the actual classic script URL, including a Pages repository prefix.
  banner: {
    js: 'var __SUPAWORLD_RUNTIME_BASE__ = new URL(".", document.currentScript.src).href.replace(/\\/$/, "");',
  },
  define: { SUPAWORLD_RUNTIME_BASE: '__SUPAWORLD_RUNTIME_BASE__' },
});
await cp(join(source, 'bundle/licenses'), join(out, 'licenses'), { recursive: true });
await cp(join(source, 'LICENSE'), join(out, 'licenses/supa-wasm-LICENSE'));
const names = [
  'page.js',
  'kernel.js',
  'process.js',
  'probe.js',
  'postgres.wasm',
  'pg.tar',
  'template.tar',
  'template.stamp',
  'postgrest.wasm',
  'auth.wasm',
  'storage.wasm',
  'storage-image.tar',
  'beam.wasm',
  'realtime-release.tar',
];
const files = await Promise.all(
  names.map(async (name) => {
    const bytes = await readFile(join(out, name));
    return { name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }),
);
await writeFile(
  join(out, 'manifest.json'),
  JSON.stringify(
    {
      buildId: lock.buildId,
      commit: lock.commit,
      templateStamp: (await readFile(join(out, 'template.stamp'), 'utf8')).trim(),
      files,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `Prepared ${lock.buildId}: ${(files.reduce((n, f) => n + f.size, 0) / 1e6).toFixed(1)} MB, all five services, no Compute.`,
);
