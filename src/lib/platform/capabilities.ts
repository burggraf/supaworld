export interface Capability {
  label: string;
  ok: boolean;
  detail?: string;
}
export async function checkCapabilities(): Promise<Capability[]> {
  const wasm = WebAssembly as typeof WebAssembly & { promising?: unknown; Suspending?: unknown };
  const checks: Capability[] = [
    { label: 'Secure connection', ok: globalThis.isSecureContext === true },
    {
      label: 'Cross-origin isolation',
      ok: globalThis.crossOriginIsolated === true,
      detail: 'The host must send COOP and COEP headers.',
    },
    { label: 'Shared WebAssembly memory', ok: false },
    {
      label: 'WebAssembly JSPI',
      ok: typeof wasm.promising === 'function' && typeof wasm.Suspending === 'function',
      detail: 'Use a recent desktop Chrome or Edge.',
    },
    { label: 'Project ownership locks', ok: typeof navigator.locks?.request === 'function' },
    { label: 'Browser file storage', ok: false },
    { label: 'Project catalog', ok: false },
  ];
  try {
    checks[2]!.ok =
      new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true }).buffer instanceof
      SharedArrayBuffer;
  } catch {
    /* unsupported */
  }
  try {
    const root = await navigator.storage.getDirectory();
    const name = `.supaworld-probe-${crypto.randomUUID()}`;
    const f = await root.getFileHandle(name, { create: true });
    const w = await f.createWritable();
    await w.write('ok');
    await w.close();
    await root.removeEntry(name);
    checks[5]!.ok = true;
  } catch {
    /* unavailable */
  }
  try {
    const { getPreference, setPreference } = await import('../projects/repository');
    await setPreference('storage-probe', true);
    checks[6]!.ok = (await getPreference('storage-probe')) === true;
  } catch {
    /* unavailable */
  }
  if (checks[2]!.ok && checks[3]!.ok) {
    try {
      const probe = new Worker(new URL('./probe-worker.ts', import.meta.url), { type: 'module' });
      const supported = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          probe.terminate();
          resolve(false);
        }, 5000);
        probe.onmessage = (e) => {
          clearTimeout(timer);
          probe.terminate();
          resolve(e.data === true);
        };
        probe.onerror = () => {
          clearTimeout(timer);
          probe.terminate();
          resolve(false);
        };
      });
      checks.push({ label: 'Worker atomics and WebAssembly exceptions', ok: supported });
    } catch {
      checks.push({ label: 'Worker atomics and WebAssembly exceptions', ok: false });
    }
  }
  return checks;
}
export async function storageStatus() {
  const estimate = await navigator.storage?.estimate?.();
  return {
    usage: estimate?.usage ?? 0,
    quota: estimate?.quota ?? 0,
    persistent: (await navigator.storage?.persisted?.()) ?? false,
  };
}
