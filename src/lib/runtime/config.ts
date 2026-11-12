export const RUNTIME_BUILD = 'b4397a9a-relative-v2';
// Same guest binaries, SQL, template, and provisioning fingerprint. Only host Worker URLs differ.
export const COMPATIBLE_RUNTIME_BUILDS = [RUNTIME_BUILD, 'b4397a9a-urls-v1'];
export const APP_BASE = import.meta.env.BASE_URL;
export const RUNTIME_BASE = `${APP_BASE}runtime/${RUNTIME_BUILD}`;
export const RUNTIME_CACHE = `supaworld-runtime-${RUNTIME_BUILD}`;
export const SERVICES = ['postgrest', 'auth', 'storage', 'realtime'] as const;
