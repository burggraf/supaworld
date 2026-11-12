/// <reference lib="webworker" />
import { precacheAndRoute, createHandlerBoundToURL, addPlugins } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};
const base = new URL(self.registration.scope).pathname;
function isolated(response: Response) {
  if (!response || response.type === 'opaque' || response.status === 0) return response;
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
addPlugins([
  {
    cachedResponseWillBeUsed: async ({ cachedResponse }: { cachedResponse?: Response }) =>
      cachedResponse && isolated(cachedResponse),
    fetchDidSucceed: async ({ response }: { response: Response }) => isolated(response),
  },
]);
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(
  ({ request, url }) =>
    request.mode === 'navigate' &&
    url.origin === self.location.origin &&
    url.pathname.startsWith(base),
  createHandlerBoundToURL(`${base}index.html`),
);
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('message', (event) => {
  if (event.data?.type === 'ACTIVATE_UPDATE') void self.skipWaiting();
});
// Runtime caches are intentionally separate from Workbox's app shell and never purged on update.
registerRoute(
  ({ url }) => url.origin === self.location.origin && url.pathname.startsWith(`${base}runtime/`),
  async ({ request, url }) => {
    const build = url.pathname.slice(`${base}runtime/`.length).split('/')[0];
    const cache = await caches.open(`supaworld-runtime-${build}`);
    return isolated((await cache.match(request)) ?? (await fetch(request)));
  },
);
registerRoute(
  ({ url }) => url.origin === self.location.origin && url.pathname.startsWith(base),
  async ({ request }) => isolated(await fetch(request)),
);
