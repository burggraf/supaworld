import { writable } from 'svelte/store';
import { APP_BASE } from '../runtime/config';
export const pwaState = writable({ available: false, update: false, offline: false });
let registration: ServiceWorkerRegistration | undefined;
export async function registerPwa() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  try {
    registration = await navigator.serviceWorker.register(`${APP_BASE}sw.js`, { scope: APP_BASE });
    const update = () =>
      pwaState.update((s) => ({
        ...s,
        available: !!navigator.serviceWorker.controller,
        update: !!registration?.waiting,
      }));
    registration.addEventListener('updatefound', () => {
      const worker = registration?.installing;
      worker?.addEventListener('statechange', update);
    });
    navigator.serviceWorker.addEventListener('controllerchange', update);
    await navigator.serviceWorker.ready;
    update();
  } catch {
    /* Online use remains available if installation is blocked. */
  }
}
// One worker provides offline use and response isolation on headerless static hosts.
export async function prepareIsolation(): Promise<boolean> {
  if (!import.meta.env.PROD || !isSecureContext || !('serviceWorker' in navigator)) return true;
  const key = `supaworld:${APP_BASE}:isolation-reload`;
  if (crossOriginIsolated) {
    sessionStorage.removeItem(key);
    return true;
  }
  await registerPwa();
  if (!registration?.active) return true;
  if (!navigator.serviceWorker.controller) {
    await new Promise<void>((resolve) => {
      const changed = () => {
        clearTimeout(timer);
        navigator.serviceWorker.removeEventListener('controllerchange', changed);
        resolve();
      };
      const timer = setTimeout(changed, 10_000);
      navigator.serviceWorker.addEventListener('controllerchange', changed);
      if (navigator.serviceWorker.controller) changed();
    });
  }
  if (navigator.serviceWorker.controller && !sessionStorage.getItem(key)) {
    sessionStorage.setItem(key, '1');
    location.reload();
    return false;
  }
  return true;
}
export async function activateUpdate() {
  const held = (await navigator.locks.query()).held ?? [];
  if (
    held.some(
      (l) =>
        l.name?.startsWith('supa-wasm/') ||
        l.name?.startsWith('supaworld/project/') ||
        l.name?.startsWith('supaworld/runtime/'),
    )
  )
    throw new Error('Close projects in all Supaworld tabs before applying this update.');
  if (!registration?.waiting) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), {
    once: true,
  });
  registration.waiting.postMessage({ type: 'ACTIVATE_UPDATE' });
}
