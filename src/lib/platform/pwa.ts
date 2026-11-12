import { writable } from 'svelte/store';
export const pwaState = writable({ available: false, update: false, offline: false });
let registration: ServiceWorkerRegistration | undefined;
export async function registerPwa() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  try {
    registration = await navigator.serviceWorker.register('/sw.js');
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
