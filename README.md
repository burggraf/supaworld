# Supaworld

Your Supabase projects, at home in your browser.

Supaworld is a static, client-only Svelte application powered by [supa-wasm](https://github.com/supabase/supa-wasm). PostgreSQL 17, PostgREST, Auth, Storage, and Realtime run in Web Workers. Project data is saved in this browser’s origin-private file system; the project catalog and credentials live in IndexedDB.

The UI uses **Svelte 5, Vite, TypeScript, shadcn-svelte, and Tailwind CSS 4**. There is no application backend or hosted Supabase account to configure.

## Run locally

Use Node 24+ and npm. The build downloads a checksum-pinned public runtime release; no GitHub credentials are needed. GitHub CLI is only needed when rebuilding from internal upstream artifacts.

```sh
npm ci
npm run runtime:prepare
npm run dev
```

Open `http://localhost:5173`. Use recent desktop Chrome or Edge. The development server sends the cross-origin isolation headers required by the runtime.

To rebuild the runtime directly from the pinned upstream checkout instead of downloading the retained distribution:

```sh
SUPAWORLD_UPSTREAM_SOURCE=../supa-wasm npm run runtime:prepare
# Or fetch the pinned upstream source and artifacts:
SUPAWORLD_BUILD_FROM_SOURCE=1 npm run runtime:prepare
```

An already prepared, verified runtime is reused. Remove `public/runtime/` before forcing a rebuild. Source builds require `git`, `gh`, GNU `tar`, `zstd`, and access to the internal upstream repository. See [runtime integration](docs/runtime-integration.md).

## What works

- Create and search multiple projects; open, switch, stop, rename, and delete them.
- Keep separate databases, local Auth users, Storage objects, and credentials.
- Recover acknowledged writes after reload or closing/reopening the browser.
- Execute SQL, inspect bounded results, cancel a query, and browse tables and columns.
- Inspect service status and check all five services through the real SDK/transports.
- Export complete physical backups and restore them as separate projects.
- Install the production app and work offline after its shell and runtime have been cached.
- Check storage usage, request persistent storage, and see browser compatibility information.

One stack runs per page. Different tabs can run different projects; the same project has one owner across tabs. Switching closes the previous stack and frees its Workers before starting the next.

Projects belong to the website origin and this browser profile. Clearing site data removes them. Export a backup to keep an independent copy or move a project to another browser. Backups contain data and credentials and are unencrypted.

## Build and serve static files

```sh
npm run build
npm run preview
```

The production preview is at `http://localhost:4173`. It serves the files in `dist/`, including precompressed Brotli/gzip assets, isolation headers, and the generated content security policy. It performs no database or application processing.

The public app is at [burggraf.github.io/supaworld](https://burggraf.github.io/supaworld/). GitHub Actions tests and deploys the Pages build after changes to `main`.

For GitHub Pages, run `npm run build:pages`. It uses `/supaworld/`, a single isolation/offline service worker, and explicit gzip runtime downloads (about 57 MB on first use). A first visit reloads once to establish browser isolation.

For other hosts, deploy the default `dist/` build to an HTTPS static host that supports response headers and large assets. The generated `_headers` file describes the header contract; [deployment instructions](docs/deployment.md) include an Nginx example. Hosts with small per-file limits need a different asset-distribution arrangement.

The lightweight shell loads before WASM. Opening the first project verifies and caches the shared runtime. In the production app, use **Storage & offline → Prepare offline** to explicitly prepare all services. The service worker never caches database contents or deletes project data. Updates prompt before activation and require open projects in other tabs to be stopped.

## Verification

```sh
npm run check          # Svelte/TypeScript and accessibility diagnostics
npm run format:check   # Repository formatting
npm test               # Catalog and backup validation tests
npx playwright install chromium
npm run test:e2e       # Real WASM, SDK, multiple tabs, backups, and UI
npm run build
npm run preview        # Keep running in a second terminal
node tests/production.mjs
```

The production check verifies compression and CSP, offline reload and project creation, persistence across actual browser-process restarts, absence of the development test API, and no network writes carrying project data. The development suite uses an explicit `VITE_TEST_API=1` hook on its isolated port 5174. Normal development and production builds omit it. See [verification results and payload](docs/verification.md) for measured evidence and remaining test limits.

## Current limits

- Desktop Chromium only; JSPI, shared WebAssembly memory, OPFS, Web Locks, and cross-origin isolation are required. Safari, Firefox, and mobile execution are not supported.
- SQL display is capped at 1,000 rows / 1 MiB, with a 16 MiB per-protocol-message limit and a 30-second default statement timeout. Submit an entire transaction block in one run; uncommitted transactions roll back when that run closes its connection. Interactive COPY is unsupported.
- Phase 1 backups support 1 GiB total, 128 MiB per file, and a 256 MiB Blob fallback when a streaming save-file picker is unavailable. Physical backups require the recorded runtime version.
- No automatic database/runtime upgrades. A changed provisioning fingerprint is refused, preserving the existing store.
- Supabase URLs are virtual and require this project’s custom fetch/WebSocket adapter. External applications and `curl` cannot connect to the browser stack directly.
- Auth sign-ups are locally auto-confirmed. Email delivery, external OAuth, cloud sync, and production tenant isolation are outside this release.
- PWA installation does not keep a database running after the app closes.

Application hosting, Compute, terminals, package installation, and the full development environment belong to phase 2. The [phase 1 design](docs/phase-1-plan.md) explains the original scope. See [recovery](docs/recovery.md) for interrupted operations and backups.
