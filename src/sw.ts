/// <reference lib="webworker" />
import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(
  ({ request, url }) => request.mode === 'navigate' && url.origin === self.location.origin,
  createHandlerBoundToURL('/index.html'),
);
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('message', (event) => {
  if (event.data?.type === 'ACTIVATE_UPDATE') void self.skipWaiting();
});
// Runtime caches are intentionally separate from Workbox's app shell and never purged on update.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    url.origin !== self.location.origin ||
    !url.pathname.startsWith('/runtime/') ||
    event.request.method !== 'GET'
  )
    return;
  const build = url.pathname.split('/')[2];
  event.respondWith(
    (async () => {
      const cache = await caches.open(`supaworld-runtime-${build}`);
      return (await cache.match(event.request)) ?? fetch(event.request);
    })(),
  );
});
