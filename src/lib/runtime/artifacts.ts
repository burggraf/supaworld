import { RUNTIME_BASE, RUNTIME_BUILD, RUNTIME_CACHE } from './config';
import type { RuntimeManifest } from './types';
const required = [
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
let manifestPromise: Promise<RuntimeManifest> | undefined;
export async function manifest() {
  return (manifestPromise ??= fetch(`${RUNTIME_BASE}/manifest.json`)
    .then(async (r) => {
      if (!r.ok)
        throw new Error(
          'Runtime files are unavailable. Please check your connection or the site deployment.',
        );
      const data = (await r.json()) as RuntimeManifest;
      if (
        data.buildId !== RUNTIME_BUILD ||
        typeof data.templateStamp !== 'string' ||
        !Array.isArray(data.files) ||
        data.files.length !== required.length ||
        new Set(data.files.map((f) => f.name)).size !== required.length ||
        !data.files.every(
          (f) =>
            required.includes(f.name) &&
            Number.isSafeInteger(f.size) &&
            f.size >= 0 &&
            f.size < 100_000_000 &&
            /^[0-9a-f]{64}$/.test(f.sha256),
        )
      )
        throw new Error('Incompatible or damaged runtime manifest.');
      return data;
    })
    .catch((e) => {
      manifestPromise = undefined;
      throw e;
    }));
}
export async function verifyDigest(bytes: ArrayBuffer, expected: string) {
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  if (digest !== expected)
    throw new Error('Downloaded file failed its integrity check. Please retry.');
}
export async function prepareArtifacts(
  progress: (done: number, total: number, label: string) => void,
  signal?: AbortSignal,
) {
  return navigator.locks.request(`supaworld/runtime/${RUNTIME_BUILD}`, { signal }, async () => {
    const data = await manifest();
    const cache = await caches.open(RUNTIME_CACHE);
    const files = [...data.files];
    const total = files.reduce((n, f) => n + f.size, 0);
    let done = 0;
    const cancel = new AbortController();
    const combined = signal ? AbortSignal.any([signal, cancel.signal]) : cancel.signal;
    let failure: unknown;
    const outcomes = await Promise.allSettled(
      Array.from({ length: 2 }, async () => {
        try {
          for (;;) {
            const file = files.shift();
            if (!file) return;
            combined.throwIfAborted();
            const path = `${RUNTIME_BASE}/${file.name}`;
            let cached = await cache.match(path);
            if (cached) {
              try {
                const bytes = await cached.arrayBuffer();
                if (bytes.byteLength !== file.size) throw new Error('Length mismatch');
                await verifyDigest(bytes, file.sha256);
              } catch {
                await cache.delete(path);
                cached = undefined;
              }
            }
            if (!cached) {
              progress(done, total, `Downloading ${file.name}`);
              const r = await fetch(path, { signal: combined, cache: 'reload' });
              if (!r.ok)
                throw new Error(
                  `Could not download ${file.name}. Check your connection and retry.`,
                );
              const bytes = await r.arrayBuffer();
              await verifyDigest(bytes, file.sha256);
              if (bytes.byteLength !== file.size) throw new Error('Runtime file length mismatch.');
              const headers = new Headers(r.headers);
              headers.delete('content-encoding');
              headers.set('content-length', String(bytes.byteLength));
              await cache.put(path, new Response(bytes, { headers }));
            }
            combined.throwIfAborted();
            done += file.size;
            progress(
              done,
              total,
              cached ? 'Using verified cached runtime' : `Downloaded ${file.name}`,
            );
          }
        } catch (error) {
          failure ??= error;
          cancel.abort();
          throw error;
        }
      }),
    );
    if (outcomes.some((r) => r.status === 'rejected')) throw failure;
    await cache.put(
      `${RUNTIME_BASE}/manifest.json`,
      new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } }),
    );
    return data;
  });
}
export async function offlineReady() {
  try {
    const data = await manifest();
    const c = await caches.open(RUNTIME_CACHE);
    return (await Promise.all(data.files.map((f) => c.match(`${RUNTIME_BASE}/${f.name}`)))).every(
      Boolean,
    );
  } catch {
    return false;
  }
}
let loadPromise: Promise<void> | undefined;
export async function loadHost() {
  if (window.supa) return;
  return (loadPromise ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${RUNTIME_BASE}/page.js`;
    script.onload = () =>
      window.supa ? resolve() : reject(new Error('Runtime host did not initialize.'));
    script.onerror = () => {
      loadPromise = undefined;
      script.remove();
      reject(new Error('Could not load the browser runtime.'));
    };
    document.head.append(script);
  }));
}
