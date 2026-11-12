# Runtime integration

The runtime is pinned in `runtime/upstream.lock.json` to supabase/supa-wasm commit `b4397a9a1797a384496ade0bd2f975c0e610ee63`. The application records build `b4397a9a-urls-v1` and the template stamp in every project. It retains the original secret, database password, service list, and seed SQL because upstream checks those inputs before opening a completed store.

## Packaging

`scripts/prepare-runtime.mjs` normally downloads a checksum-pinned archive from the application’s private `runtime-b4397a9a-urls-v1` release. This retains the working build independently of expiring upstream Actions artifacts. The archive contains runtime code and a clean upstream database template, never a visitor’s project data. `GH_TOKEN` only needs read access to the application repository for this path.

A source build validates the pinned guest archive checksums, uses the exact upstream source commit and esbuild version, and reconstructs deterministic tar images. The one integration patch replaces the page host’s three hard-coded `/dist/` Worker paths with a compile-time immutable runtime base. The upstream working tree is never edited. Guest code, SQL, and provisioning behavior are otherwise unchanged.

The generated directory contains the page, kernel, process, and probe bundles; PostgreSQL WASM, libraries, and template; Auth and PostgREST WASM; Storage WASM/image; Realtime’s BEAM WASM/release; a checksummed manifest; and upstream notices. Compute, its VM/images, the demo, and test-only guests are excluded.

Generated binaries stay outside Git. `npm run runtime:pack` makes a deterministic distribution archive and checksum in `.cache/distributions/`. A changed runtime, patch, or provisioning input must receive a new build ID and a compatibility decision; do not replace assets at an existing immutable URL.

## Browser ownership

The page owns the upstream API and asks it to boot its own kernel. Workers hold the kernel/process implementation. The manager does not pre-boot an embedder-owned kernel, so upstream’s `stop()` can flush, release its store, and terminate all Workers.

A named project uses `supa-wasm/supaworld-<uuid>` in OPFS. Upstream owns its `pg/`, `keep.*`, and completion marker. Its exclusive Web Lock uses the same `supa-wasm/<storeName>` string. The app uses separate operation locks, always stopping a stack before taking its store lock for maintenance. It never takes that store lock before asking upstream to start it.

A sleeping stack still owns its project. A failed stop can retain the store and a memoized failed stop promise, so the manager blocks further opens and requires page recovery rather than assuming a retry released ownership.

## SQL and SDK

`src/lib/runtime/pgwire.ts` adapts the upstream test client’s wire/SCRAM helpers under its MIT notice, with a production connection wrapper. It authenticates with SCRAM-SHA-256 and verifies the server proof. It captures backend PID/secret for cancellation on a separate loopback connection, limits retained rows/bytes and frame size, and reads through ReadyForQuery. Connections have deadlines, statement timeouts, and explicit termination. No arbitrary SQL RPC is installed in the public REST API.

The Supabase SDK receives the stack’s custom fetch and WebSocket implementations. Requests are limited to that stack’s virtual origin, and session work is aborted when closing. Admin clients disable session persistence, auto-refresh, and URL detection. Clients have project/session-specific keys. The UI never presents the virtual URL as an externally reachable endpoint.

## Cache and network

`prepareArtifacts()` verifies each asset before cache insertion, revalidates cached bytes before use, and coordinates downloads with an origin-wide lock. Failed/cancelled download tasks are settled before the operation returns, preventing old progress callbacks from updating a later project. The custom service worker serves those shared immutable assets from a separate versioned cache. Application-shell updates never clear runtime caches or OPFS/IndexedDB.

The runtime’s internal HTTP/WebSocket traffic goes through the in-browser kernel. Visitors download static assets; project data does not need to be sent to a backend. The production acceptance script checks for unexpected network writes.

The upstream repository currently has internal visibility. The retained release is private as well. Public redistribution and the complete compiled dependency notice set should be reviewed before a public website launch.
