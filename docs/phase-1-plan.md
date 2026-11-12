# Supaworld: phase 1 implementation plan

- Date: 2026-11-12
- Status: proposed implementation plan; application not yet implemented
- Repository: [burggraf/supaworld](https://github.com/burggraf/supaworld)
- Upstream inspected: `../supa-wasm`, commit [`b4397a9a1797a384496ade0bd2f975c0e610ee63`](https://github.com/supabase/supa-wasm/tree/b4397a9a1797a384496ade0bd2f975c0e610ee63)

Jump to [scope](#4-phase-1-scope), [architecture](#6-application-architecture), [lifecycle](#8-lifecycle-locking-and-recovery), [backups](#9-backup-and-restore), [deployment](#11-runtime-build-and-static-deployment), [milestones](#13-implementation-milestones), or [acceptance criteria](#14-verification-and-release-acceptance).

## 1. Outcome and product boundary

Build a static, client-only website where someone can create a local Supabase project, use it, close the site, and return to the same data. They can keep multiple projects, switch between them, rename them, export and restore backups, and permanently remove projects they no longer need.

A project contains its own PostgreSQL database, Auth data, Storage objects, service configuration, and credentials. PostgreSQL, PostgREST, Auth, Storage, and Realtime execute in the browser through supa-wasm. The website does not provision hosted Supabase resources or require a Supabase account, Docker, or a local server on the visitor's machine.

The phase 1 experience is a project manager with a small database workspace. Phase 2 adds applications that consume these projects and the wider development environment. Although upstream already includes Compute, phase 1 will not expose it or ship its guest images.

The application is local to a browser profile and website origin. It does not synchronize between browsers or devices. The site must explain this at first use and on the storage screen. Runtime activity requires an open application tab/window; installing a PWA does not make the database an always-running background server.

## 2. Decisions to build around

- **UI:** Svelte 5 and TypeScript, bundled by Vite as a client-only SPA. Use ordinary Svelte components and runes for presentation state; keep persistence and lifecycle services independent of components. No server rendering or SvelteKit server routes are needed. See the [Svelte documentation](https://svelte.dev/docs/svelte/v5-migration-guide) and [Vite guide](https://vite.dev/guide/).
- **Components and styling:** shadcn-svelte components checked into `src/lib/components/ui`, Tailwind CSS 4 through `@tailwindcss/vite`, and shared theme tokens. Configure `$lib` consistently in Vite, TypeScript, and `components.json`; point the component generator at the actual SPA stylesheet. Follow the [shadcn-svelte Vite setup](https://www.shadcn-svelte.com/docs/installation/vite) and [Tailwind Vite integration](https://tailwindcss.com/docs/installation/using-vite).
- **Navigation:** hash routes such as `#/projects/<id>/sql`, so deep links work on a basic static host. Persist the last selection per tab and last successful project as a reopening preference. A URL selects a project; it never carries credentials.
- **Runtime:** a pinned build of the upstream browser host behind a Supaworld adapter. Multiple saved projects, one active stack per page. Different tabs may run different projects; the same project has one owner across tabs.
- **Persistence:** IndexedDB for the project catalog, credentials, preferences, and SQL drafts; supa-wasm's existing OPFS stores for database files and Storage objects. Never place database contents in localStorage or IndexedDB as a second persistence implementation.
- **Packaging:** npm with a committed lockfile and Node 24 for development/builds, consistent with the inspected upstream browser package. Resolve and pin compatible dependency versions when scaffolding; do not depend on floating versions in CI.
- **Hosting:** static files on HTTPS, at a stable origin, with cross-origin isolation headers and support for large WASM assets. No application backend is part of phase 1.
- **PWA:** prepare the architecture for one service worker; ship the reliable SPA first. Installation and verified offline operation are an optional final phase 1 milestone, described below.

## 3. What the upstream inspection establishes

These are findings from the pinned checkout, not assumptions about a published SDK. The upstream tests were inspected, not executed during preparation of this plan.

1. **The browser implementation already exists.** `browser/src/host/page.ts` exposes `window.supa`; `supa.stack.start()` returns keys, a custom `fetch`, a WebSocket transport, lifecycle methods, and status information. Supabase client integration is demonstrated by the Auth, Storage, Realtime, and `supabase-js` tests. Reuse this host rather than the native Rust bundle. Sources: [browser README](https://github.com/supabase/supa-wasm/blob/b4397a9a1797a384496ade0bd2f975c0e610ee63/browser/README.md), [API](https://github.com/supabase/supa-wasm/blob/b4397a9a1797a384496ade0bd2f975c0e610ee63/browser/src/api.ts).
2. **One stack can run on a page.** The current implementation rejects a second start while a stack is active. Switching must stop and release the previous stack before starting the next. Keeping several projects saved does not require several kernels. Source: [stack implementation](https://github.com/supabase/supa-wasm/blob/b4397a9a1797a384496ade0bd2f975c0e610ee63/browser/src/stack/stack.ts).
3. **Named persistence is available.** `persist: name` uses `supa-wasm/<name>` in the origin's OPFS. It retains database files and Storage objects. Without `persist`, a temporary store is eventually removed. Named projects require an explicit, stable `jwtSecret`. Sources: [store implementation](https://github.com/supabase/supa-wasm/blob/b4397a9a1797a384496ade0bd2f975c0e610ee63/browser/src/kernel/store.ts), [store naming](https://github.com/supabase/supa-wasm/blob/b4397a9a1797a384496ade0bd2f975c0e610ee63/browser/src/stores.ts).
4. **Reopening depends on immutable provisioning inputs.** A completed store rejects a different provisioning fingerprint, including changes to service SQL, seed SQL, derived passwords, service selection, or template stamp. A failed first provisioning can be retried, but a completed project must never be silently reset. The detailed `persist` contract and implementation are authoritative where older nearby comments suggest reprovisioning. Source: [StackOptions and persistence contract](https://github.com/supabase/supa-wasm/blob/b4397a9a1797a384496ade0bd2f975c0e610ee63/browser/src/api.ts#L410).
5. **Cross-tab ownership is already enforced.** The runtime holds the exclusive Web Lock `supa-wasm/<storeName>` until `stop()` releases it or the page ends. Sleeping retains ownership. A competing start waits briefly and then fails. Deletion and backup tools must cooperate with that exact lock. Source: [host leases](https://github.com/supabase/supa-wasm/blob/b4397a9a1797a384496ade0bd2f975c0e610ee63/browser/src/host/lease.ts).
6. **The supported runtime is currently desktop Chromium.** It needs cross-origin isolation, shared WebAssembly memory, Worker atomics, JSPI, exnref, OPFS, and Web Locks. Check capabilities rather than merely parsing the user agent. Treat Safari, Firefox, and mobile execution as unsupported until separately validated. Sources: [browser requirements](https://github.com/supabase/supa-wasm/blob/b4397a9a1797a384496ade0bd2f975c0e610ee63/browser/README.md), [support checks](https://github.com/supabase/supa-wasm/blob/b4397a9a1797a384496ade0bd2f975c0e610ee63/browser/demo/support.ts).
7. **Integration requires packaging work.** The browser package is private, its build produces classic script bundles, Worker URLs currently use `/dist/*`, and WASM/template/image assets come from separate CI artifacts. There is no ready-made public package to assume. Artifact downloads need repository access and can expire. Sources: [package](https://github.com/supabase/supa-wasm/blob/b4397a9a1797a384496ade0bd2f975c0e610ee63/browser/package.json), [build](https://github.com/supabase/supa-wasm/blob/b4397a9a1797a384496ade0bd2f975c0e610ee63/browser/build.mjs), [artifact retrieval](https://github.com/supabase/supa-wasm/blob/b4397a9a1797a384496ade0bd2f975c0e610ee63/browser/fetch-fixtures.sh).
8. **A stack URL is virtual.** Requests work through `stack.fetch` and `stack.WebSocket`. Copying the URL into an ordinary browser tab, `curl`, or an external application does not reach this stack. Upstream's fetch falls back to network fetch for other origins; the application adapter should restrict project API requests to the selected project's virtual origin. Source: [front door implementation](https://github.com/supabase/supa-wasm/blob/b4397a9a1797a384496ade0bd2f975c0e610ee63/browser/src/host/front.ts).
9. **Durability has substantial upstream test coverage.** Tests cover acknowledged writes surviving reload and renderer termination, objects over five megabytes, interrupted provisioning, conflicting tabs, and recovery after kernel termination. Supaworld still needs its own tests around catalog consistency, project switching, deletion, and backups. Source: [persistence acceptance tests](https://github.com/supabase/supa-wasm/blob/b4397a9a1797a384496ade0bd2f975c0e610ee63/browser/tests/persistence.spec.ts).

The upstream repository currently reports **internal** visibility. The new repository is private. Before a public website release, establish an approved, reproducible way to distribute the runtime and its bundled dependencies, retaining required notices. Visitors must never need GitHub access or a build credential to download runtime assets.

## 4. Phase 1 scope

### Required for the first release

- Create a blank project with a name and generated immutable ID.
- List and search saved projects, showing last use and current local status.
- Open, switch, stop, rename, and permanently delete a project.
- Reopen data after reload, closing/reopening the browser, and recoverable crashes.
- Keep project data, credentials, SDK sessions, SQL drafts, and UI results separated.
- Show browser compatibility, storage availability, download/startup progress, and useful recovery actions.
- Provide an overview, SQL console, and small read-only schema/table browser.
- Show service status and an adapter-aware Supabase client example.
- Export a complete project backup and restore it into a new local project.
- Build a static deployment and test it with the real WASM runtime.

All five underlying services are included in the project runtime. Phase 1 does not require building full management screens for each service: Auth, Storage, and Realtime functionality is verified through integration tests and a small diagnostics action.

### Optional after the required flow is reliable

- PWA installation and explicitly prepared offline operation.
- Duplicate project as a convenience around backup/restore.
- A sample dataset, saved SQL snippets, richer result filtering, and basic Auth/Storage inspectors.

### Phase 2 and later

Application source files, code execution, terminals, package installation, app preview frames, Compute guests, development servers, Git integration, AI coding tools, application deployment, remote database connections, cloud synchronization, collaboration, and multiple simultaneous stacks in one page.

A complete Supabase Studio clone, cloud project provisioning, outbound email, OAuth provider setup, and production-grade tenant isolation are also outside phase 1.

## 5. Main user journeys and screens

### First visit and project list

Load the lightweight UI before loading the runtime. Explain that projects are saved in this browser. Show **Create project** and **Import backup** as the primary actions.

Run a capability check before project creation: secure context, cross-origin isolation, shared WASM memory, JSPI, a small worker feature probe, Web Locks, and an actual small OPFS/IndexedDB write-and-delete probe. Distinguish an unsupported browser from misconfigured hosting or blocked storage. Unsupported environments should still show the catalog and recovery/export options where their storage capabilities permit.

Render project cards or rows with name, short ID, last opened time, and status. Provide a project switcher in the workspace header, a searchable list, and an overflow menu for rename, export, and delete. Display names are editable and may repeat; IDs disambiguate them.

### Create and open

The creation dialog asks for a name only, trimmed and limited to 1–80 characters. The application generates credentials locally and uses a fixed phase 1 service configuration. No region picker, cloud password setup, or account sign-in is necessary.

Show understandable stages: preparing files, creating database, preparing services, ready. Download progress may show bytes when measurable; provisioning shows stage and elapsed time. Upstream provides timings and gates, not a complete stream of progress events, so do not invent a percentage for work that cannot be measured.

After initialization, open the overview and run a small readiness query. A lazily provisioned project can be ready while unused services are sleeping; label those states accurately.

### Work inside a project

Use a shadcn-svelte sidebar and tabs for **Overview**, **Database**, **SQL**, and **Settings**. Use Dialog/Alert Dialog for creation and deletion, Command/Popover for switching, Table for data, and persistent inline errors for recovery. Toasts are appropriate for small completed actions, not the only record of a failed database operation.

The overview shows project identity, database readiness, service states, local storage information, and connection guidance. The Database screen lists schemas, tables, columns, and a bounded page of rows. The SQL screen supports execution, errors, bounded results, and a per-project draft. Settings holds rename, backup, storage information, and deletion.

Keep focus handling, keyboard navigation, visible labels, light/dark themes, and reduced motion in the first UI pass. A responsive layout is useful even though executing the stack on mobile is not a phase 1 support promise.

### Switch projects

Persist the current editor draft, close subscriptions and database sessions, settle or explicitly cancel in-flight work, stop the old stack, and then open the chosen project. Show the transition and disable conflicting actions. If the new project fails to start, preserve both projects and offer to retry or reopen the previous one.

Never relabel results from project A as project B. Every asynchronous request carries its project ID and runtime generation, and the UI discards results that arrive after that generation is no longer active.

### Rename and delete

Renaming changes catalog metadata only. It must not change the OPFS directory, JWT secret, service settings, or provisioning fingerprint.

Deletion names the project and explains that its local database, users, files, and credentials will be removed. Offer export before confirmation. Use an explicit destructive confirmation, with typed-name confirmation for populated projects. Deletion completes only after the runtime is closed, the exact project store is removed, and catalog-owned records are cleaned up. A project open in another tab remains protected.

## 6. Application architecture

The Svelte UI calls a `ProjectManager`. The manager coordinates a `ProjectRepository` backed by IndexedDB, a `RuntimeAdapter` backed by supa-wasm, and a `BackupService` that operates on stopped stores. A `StorageMonitor` and an `ArtifactManager` provide storage and download state. Components do not directly manipulate OPFS or `window.supa`.

The runtime host stays on the page and already delegates database processes to Workers. Do not wrap it in an additional Worker without first changing and validating upstream's page assumptions. Keep the global upstream API private to the adapter as an integration detail.

Proposed application-facing contract, to be implemented rather than assumed to exist upstream:

```ts
interface RuntimeAdapter {
  open(project: ProjectConfig): Promise<ProjectSession>;
  close(): Promise<void>;
  status(): RuntimeStatus;
  subscribe(listener: (status: RuntimeStatus) => void): () => void;
}

interface ProjectSession {
  readonly projectId: string;
  readonly generation: number;
  query(sql: string, options?: QueryOptions): Promise<QueryResult>;
  createClient(role: "anon" | "admin"): ProjectClient;
  dispose(): Promise<void>;
}
```

`ProjectClient` is an application wrapper that owns the SDK client and its cleanup. `ProjectSession.dispose()` drains/cancels owned work before the adapter closes the stack. UI navigation cannot bypass this lifecycle.

### Runtime and SDK integration

- Start with `persist`, the saved secret, the saved provisioning inputs, explicit artifact URLs, and all four service names: `postgrest`, `auth`, `storage`, `realtime`; PostgreSQL is the database beneath them.
- Use lazy startup by default. `waitForReady: false` can expose the handle for progress, but wait for `stack.ready` and the readiness query before accepting user operations.
- Let upstream own boot, sleep, and teardown. Do not pre-boot an unrelated kernel, which changes the runtime's cleanup ownership.
- Create Supabase clients with the selected stack's `fetch` and `WebSocket` transport. Use a virtual origin derived from the immutable project ID, such as `https://<uuid>.supaworld.invalid`.
- Give any persisted end-user SDK session a project-specific storage key. Admin clients disable session persistence, token refresh, and URL session detection. Dispose listeners and refresh timers when switching.
- Keep admin credentials inside the trusted workspace. Examples intended for future applications use the anon key and explain that the browser adapter must be supplied. They are not promises of an externally reachable endpoint.
- Read upstream `gates()`, `kernel()`, and `timings` for status. Poll at a modest rate only while needed, and stop UI polling when the view is hidden. Do not run health queries repeatedly just to draw a status badge; that would prevent idle sleep.

### SQL and schema access

The inspected API does not expose a general `query()` method. Prove a browser PostgreSQL protocol adapter over `stack.connect(5432)` in the first milestone. Upstream's [test client](https://github.com/supabase/supa-wasm/blob/b4397a9a1797a384496ade0bd2f975c0e610ee63/browser/tests/pgwire.ts) demonstrates SCRAM authentication and the simple-query flow; it is reference material, not a production dependency to import unchanged.

Use a short-lived admin connection for console and catalog queries. Apply server-side statement timeouts, handle protocol errors through `ReadyForQuery`, bound displayed rows and bytes, and close sessions before a switch. Query cancellation must use a validated PostgreSQL cancellation path or report its limitation; abandoning a UI promise does not prove the database stopped executing. Do not split SQL on semicolons with a string operation.

Each console execution owns its connection until it completes. Support explicit transaction blocks submitted together in one execution; interactive transactions spanning separate Run actions are deferred. Close the connection after a run, rolling back any transaction left uncommitted, and make that behavior clear in the SQL workspace.

Default result display limits can start at 1,000 rows and 1 MiB, subject to validation. Consume or terminate the protocol response safely when truncating results. Paginate table browsing, quote identifiers correctly, and treat database strings as text, never rendered HTML. DDL executed through the console should refresh schema listings and notify PostgREST to reload its schema cache when necessary.

Avoid installing a general-purpose `SECURITY DEFINER` SQL function in the public REST API solely to build the UI. User-created tables and samples should be created after normal PostgreSQL startup: upstream's persistence tests specifically note RLS limitations for tables created during single-user provisioning.

## 7. Project identity and data model

Use an application-owned, versioned IndexedDB database. The project list must load without starting PostgreSQL.

```ts
interface ProjectRecord {
  id: string;                    // crypto.randomUUID(), immutable
  name: string;                  // editable display name
  storeName: string;             // "supaworld-" + id, immutable
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
  runtimeBuildId: string;        // exact upstream + patch + artifact build
  provisioningVersion: number;
  provisioning: {
    services: Array<"postgrest" | "auth" | "storage" | "realtime">;
    seedSql: string;             // initially empty; preserve exact value
    templateStamp: string;
    credentialRef: string;
  };
  lifecycle: "creating" | "ready" | "importing" | "deleting" | "error";
  operationId: string | null;
  revision: number;
  lastError: { code: string; message: string } | null;
}
```

Store credentials in a separate object store, committed transactionally with the project record: a cryptographically random JWT secret of sufficient length, the stable database password/configuration, and any other inputs necessary to reproduce provisioning. Separating them reduces accidental display/logging; it does not encrypt them or isolate them from JavaScript on the same origin.

Additional stores hold project-scoped drafts/preferences and schema migration metadata. Transient states such as opening, running, sleeping, stopping, or locked elsewhere are derived from the current runtime and ownership, not trusted because a previous session saved them.

Use `supaworld-<uuid>` for names inside upstream's allowed store-name format. The runtime owns `OPFS/supa-wasm/<storeName>`, including `pg/`, `keep.*`, and its `ready` marker. Preserve these internals as opaque runtime data; do not rename PostgreSQL files or reinterpret journal formats in the UI.

IndexedDB and OPFS cannot participate in one transaction. Every operation spanning them must have a durable intent and an idempotent recovery path:

- A `creating` record with saved credentials can resume first provisioning with the same inputs.
- A `ready` record whose store or completion marker is missing becomes a recovery error. It must not automatically create an empty replacement.
- A `deleting` record is a tombstone; recovery finishes deletion before permitting a new open.
- An interrupted import remains unpublished until verified; cleanup is limited to its allocated staging store.
- Unknown `supaworld-*` OPFS stores are surfaced as recovery candidates. Never delete them as routine cache cleanup. If credentials/catalog data are missing, do not pretend the original secret can be reconstructed from the database.

Use transactional catalog revisions to prevent stale updates from another tab. Each metadata migration has an explicit schema version. Handle blocked IndexedDB upgrades by asking other open app tabs to reload after closing their work.

## 8. Lifecycle, locking, and recovery

Keep the main runtime state machine explicit:

```text
idle -> opening(project) -> ready(project) -> closing(project) -> idle
                   |                |                 |
                   +--------------> error <----------+
```

Sleeping is a substate of an open project; it still owns its store. Creation, import, export, and deletion are manager operations with durable catalog state where required. Serialize runtime transitions so rapid clicks cannot start overlapping stacks.

### Locking protocol

Use an application operation lock such as `supaworld/project/<id>/operation` to serialize lifecycle changes across Supaworld tabs. Re-read catalog state after acquiring it. The upstream runtime separately acquires `supa-wasm/<storeName>` when starting.

Do not acquire upstream's store lock and then call `stack.start()` while holding it; that would deadlock. For offline maintenance, stop the runtime first, then acquire the upstream store lock and hold it during backup, import writes, or deletion. Use a consistent ordering of application operation lock followed by store lock. Keep IndexedDB transactions short rather than awaiting runtime work inside them.

Do not hold operation locks for two projects during a switch: finish closing the old project and release its operation lock before acquiring the target's. Use bounded or nonblocking acquisition for a busy project so the UI can explain the conflict instead of waiting indefinitely.

Use `BroadcastChannel` to refresh the catalog and show which tab owns a project. Messages carry IDs, revisions, and status, never secrets. Broadcast messages and heartbeats are advisory; Web Locks determine actual ownership. Phase 1 does not forcibly steal a live lock. A crashed page releases its lock through the browser, with bounded retries for handles still closing.

### Create

1. Validate storage/features and ensure the chosen immutable runtime assets are available.
2. Allocate ID, store name, and credentials. Atomically commit the `creating` record and its credentials before starting any runtime work.
3. Close any currently active project through the normal switch flow.
4. Start the named store with the recorded configuration; await provisioning and readiness.
5. Commit `ready` and last-opened metadata, then display the workspace.
6. On failure, keep the intent, credentials, and useful error. Retry with those exact inputs; do not allocate a new secret or delete another project's data.

### Close and switch

1. Serialize the request; save the current draft and prevent new operations in that session.
2. Finish or explicitly cancel queries, abort API requests, consume/cancel response bodies, unsubscribe Realtime channels, and close protocol connections.
3. Await `stack.stop()`, including the flush, Worker teardown, and lock release. Inspect its failure/result rather than declaring success after calling it.
4. Clear old SDK clients and publish a new generation before opening the target.
5. Start the target from its persisted configuration and only commit it as active after readiness.

A failed shutdown blocks further opens in that page until recovery. Upstream memoizes the stop promise, and a failed flush may leave the lock and store attached; repeatedly calling the same `stop()` is not a reliable retry strategy. The adapter must expose a recovery state and validate a recovery/reload path during the initial spike. Never release ownership while a Worker can still write.

Do not depend on asynchronous `beforeunload` work for durability. Graceful close is valuable when available; abrupt termination is handled by the runtime's recovery behavior. A timed-out mutation may have committed even if the UI did not receive its response, so avoid automatic replay of arbitrary SQL or writes.

### Delete

After confirmation, acquire the application operation lock. If the project is locally active, close it. Acquire the exact upstream store lock; if another tab owns it, leave the project intact and explain how to release it. Record a deletion tombstone, recursively remove only that project's OPFS directory, then remove its credentials, SDK session, drafts, and catalog records. Broadcast completion.

If deletion is interrupted or fails, retain the tombstone and expose **Retry deletion**. Treat an already absent directory as success. Never clear the entire OPFS root, all IndexedDB databases, or shared runtime caches to remove one project.

## 9. Backup and restore

Make complete local backups part of the required phase 1 release because the browser holds the only working copy. This is new application functionality; the inspected stack has no project-level export/import API.

Use a versioned `.supaworld-backup` archive with:

- A manifest containing archive format version, original project metadata, runtime build ID, provisioning inputs, credentials, and file inventory.
- A complete copy of the stopped project's OPFS store, including the completion marker and all database/object-store journal and backing files.
- File lengths and cryptographic digests for detecting truncation or corruption.

Export holds the project operation lock, closes the runtime cleanly, acquires the upstream store lock, and streams files to the selected destination. Do not copy a live database. Prefer a streaming writer in supported Chromium; enforce a measured size limit if a Blob download fallback would hold the entire archive in memory. Let the user reopen the project after export.

The export UI explains that the file contains database data, local users, objects, and credentials. Encryption and password-protected archives are separate future features; do not imply an unencrypted backup is protected.

Restore validates the archive before publishing a project. Reject unsupported versions, missing files, invalid digests, duplicate entries, path traversal, absolute paths, and excessive file counts or expanded size. Check available capacity and handle quota errors during extraction. Never trust a path or project ID supplied by the archive to choose an existing destination.

Allocate a fresh local ID and store name, write under an `importing` record, and preserve the original provisioning credentials and inputs. A restored copy intentionally retains those credentials for compatibility; newly created blank projects receive independent random credentials. The local ID, virtual origin, and SDK session namespace distinguish the restored copy.

After extraction, require a valid completion marker and the full validated file inventory before allowing a normal restore to boot; upstream empties an unsealed store when it opens it. Release the maintenance store lock before asking the runtime to open it. Verify that the store was reopened without provisioning, execute a readiness query, and check representative data before marking it ready. Failure leaves the original projects untouched. New local identity and cross-origin restore behavior must be proven with the pinned runtime in milestone 0.

These are physical backups tied to the recorded runtime/data format. They are not advertised as `pg_dump` files or universally importable into hosted Supabase. Restoring an unsupported runtime build should preserve the archive and report the required version, never silently upgrade or reset it.

## 10. Storage and local security behavior

Browser storage is per origin and can be subject to eviction or quota limits. Use `navigator.storage.estimate()`, `persisted()`, and a user-initiated `persist()` request to show the current state. Persistence being granted does not protect against users clearing site data. See [browser storage behavior](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).

Show origin-wide usage and quota as estimates. Compute per-project sizes separately from file sizes when a project is safely closed; label them approximate. Runtime caches share the origin's storage budget. Catch actual write failures even if the earlier estimate showed room, and never automatically delete projects to free space.

Changing domain, protocol, or port changes the storage origin. Choose the long-term origin before inviting users to keep important work. A later origin change needs an explicit export/import migration path.

The entire workspace is trusted local administration. Project separation prevents accidental mixing; it does not make projects mutually untrusted tenants within one origin. Mask secrets by default, reveal/copy on deliberate action, and redact keys, tokens, SQL values, and user data from diagnostics. Do not load third-party scripts into the workspace.

Use a restrictive content security policy compatible with the tested WASM/Worker pipeline. Keep scripts, styles, icons, and runtime assets same-origin where practical, allow the WASM compilation mechanism actually needed, and avoid unrestricted dynamic code execution. Render project names, query results, and error text safely.

Supabase Auth users belong to each local project; they are not Supaworld website accounts. The upstream browser configuration auto-confirms local sign-ups because it has no mail server. Phase 1 must describe this behavior and avoid implying that email delivery or arbitrary external integrations are supported.

## 11. Runtime build and static deployment

### Reproducible runtime preparation

Create `runtime/upstream.lock.json` containing the source commit, application patch revision, guest input identities, exact artifact references/checksums, template stamp, and produced build ID. Keep runtime binaries out of the Git repository.

The preparation script checks out/downloads the pinned source into a build cache, obtains matching artifacts, validates every digest, applies a small documented integration patch, and emits `public/runtime/<buildId>/`. CI must work from a clean checkout of this repository; `../supa-wasm` is an optional local development source, never a deployment dependency.

The initial patch should make page/kernel/process/probe Worker URLs resolve inside the immutable runtime directory. Passing `StackOptions.artifacts` alone does not change upstream's hard-coded Worker paths. Validate the actual classic-script build and include bundled SQL and third-party notices. Prefer an upstreamable configuration change over copying large portions of runtime logic into this repository.

Include the browser host bundles and the Postgres, PostgREST, Auth, Storage, and Realtime assets: `postgres.wasm`, `pg.tar`, `template.tar`, `template.stamp`, `postgrest.wasm`, `auth.wasm`, `storage.wasm`, `storage-image.tar`, `beam.wasm`, and `realtime-release.tar`. Exclude Compute VM/filesystem artifacts and test-only guests. Tree-shake or otherwise avoid unused Compute code only where verified safe.

Upstream's artifact-fetching helper currently also fetches Compute assets and discovers matching CI runs. Adapt the useful identity checks into a deterministic phase 1 acquisition script rather than using expiring CI downloads or “latest successful run” URLs in the visitor's browser. Retain a durable copy of the selected build artifacts for reproducible releases.

### Deployment contract

Serve the page and applicable Worker resources with:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```

Validate `crossOriginIsolated` in the page and Workers. The isolation requirements are documented in [MDN's crossOriginIsolated reference](https://developer.mozilla.org/en-US/docs/Web/API/Window/crossOriginIsolated). Serve WASM with the correct MIME type and test compression, content lengths, and error responses on the chosen host.

Measure actual compressed and uncompressed sizes before choosing a hosting provider. Upstream comments already describe individual fixtures in the tens of megabytes, so an otherwise convenient host may reject its largest file. The release gate is a real production artifact upload and runtime smoke test. Use a header-capable static host as the default; choose the provider after this audit rather than assuming a small-asset hosting limit will fit.

Keep runtime assets immutable and cacheable by build ID. Revalidate the application entrypoint and service-worker script so updates can be discovered. The lightweight project-list screen should not download WASM until the user opens or creates a project. Runtime preparation/downloads are shared across projects, not duplicated per database.

GitHub Pages is a possible secondary target: upstream demonstrates isolation through a service worker and a first-load reload. It requires additional testing and must share one worker implementation with PWA caching; do not install a separate competing root-scope `coi-sw.js`. Source: [upstream isolation worker](https://github.com/supabase/supa-wasm/blob/b4397a9a1797a384496ade0bd2f975c0e610ee63/browser/coi-sw.js).

### Updates and compatibility

Keep the runtime build fixed throughout the first release. Application UI updates must continue opening projects with their recorded provisioning inputs. Changes to UI code or a display name must not alter the seed or secrets.

Do not implement automatic database/runtime upgrades in phase 1. A future build change requires a compatibility decision, backup, tested migration or restore route, and retention of any still-needed runtime assets. A project made with an unsupported build gets a clear compatibility state and backup access. Loading different upstream global bundles into the same page is not a safe version-switching strategy; use a deliberate reload/versioned entrypoint if multi-version support is later introduced.

## 12. Optional PWA milestone

Use `vite-plugin-pwa` with a single custom worker and `injectManifest` so runtime caching and update coordination are explicit. Provide a web app manifest, icons, and install guidance. The plugin supports a custom worker and prompting for updates; see [injectManifest](https://vite-pwa-org.netlify.app/guide/inject-manifest) and [update prompts](https://vite-pwa-org.netlify.app/guide/prompt-for-update).

Precache the small application shell. Manage large runtime assets in separate versioned caches with an explicit inventory, progress, cancellation, and quota/error handling. Do not glob all WASM/tar files into the default precache or assume service-worker precache limits fit them.

Provide **Prepare for offline use**. Mark a runtime version offline-ready only after every required asset has been fetched, verified, and cached. A cached shell alone is insufficient. A first visit without internet cannot initialize an uncached runtime; show this state plainly. Project data remains in OPFS/IndexedDB, not the service-worker cache.

Preserve isolation headers on cached responses. If supporting a headerless host, combine isolation handling and caching in the same worker and test its one-time bootstrap reload without loops.

An update prompts the user. Before activation/reload, save drafts and close owned stacks. Coordinate with other app tabs; do not activate in a way that mixes new host code with old Workers/assets in an active session. Avoid unconditional `skipWaiting` and automatic reload during writes. Clean old shell caches separately from runtime caches; retain runtime assets referenced by saved projects or active sessions.

PWA acceptance: after preparation, disconnect the network, close and reopen the installed app, open an existing project, switch projects, create a blank project using the cached runtime, query data, and export a backup. Test interrupted downloads, insufficient storage, missing cache entries, and an update while another tab owns a project. If this milestone is omitted, ship the SPA with accurate online-loading behavior and no offline promise.

## 13. Implementation milestones

Complete milestones 0–5 for the required phase 1 release. Milestone 6 is optional. Estimate delivery dates after milestone 0 establishes artifact availability, cold-start cost, SQL integration, and recovery behavior.

### Milestone 0: prove the integration and persistence contract

Build a minimal client-only Svelte/Vite harness with the pinned runtime and real deployment headers. Package assets without Compute, inventory sizes, and prove capability detection on current stable desktop Chromium. Validate the PostgreSQL query adapter, status reporting, and failed-stop behavior.

Create A and B with different credentials. Put different rows, Auth users, and Storage objects into them. Close/reopen and alternate between them. Verify the same-store lock conflict in a second tab, a real crash/reload, a closed-store physical backup restored under a new local ID, and a refused provisioning mismatch that leaves the original store intact.

**Exit:** evidence of isolated persistent projects and a reproducible runtime build from a clean app checkout. Resolve missing artifacts, required patches, backup compatibility, and a static host's file/header constraints before building the full UI.

### Milestone 1: application shell and catalog

Scaffold Svelte/Vite/TypeScript; configure Tailwind, shadcn-svelte, aliases, formatting, type checks, and hash routes. Implement IndexedDB schema/migrations, feature checks, storage status, project list, create dialog, and the workspace shell. Add keyboard/focus behavior and dark mode.

**Exit:** a responsive, accessible catalog loads independently of runtime assets and survives reload. Metadata/credential transactions and error states work without relying on mock success paths.

### Milestone 2: full project lifecycle

Implement the runtime adapter, serialized lifecycle manager, create/open/close/switch/rename/delete flows, generation checks, cross-tab coordination, and recovery of interrupted catalog/OPFS operations. Ensure background views and subscriptions do not keep stopped projects alive.

**Exit:** create at least three projects, write distinct data, rename, switch repeatedly, reload, and delete one while the other two remain unchanged. Interrupted creation/deletion and competing tabs are recoverable.

### Milestone 3: useful project workspace

Implement overview/service status, SQL execution, query limits/timeouts and error handling, per-project drafts, schema/table inspection, and adapter-aware client guidance. Add integration coverage for REST, Auth, Storage, and Realtime, including RLS under different local users.

**Exit:** the user can create a table, insert/query rows, inspect them, and verify the underlying Supabase services. No results, sessions, or realtime events leak across a switch.

### Milestone 4: backup and durability hardening

Implement streamed export, validated staged restore, storage pressure handling, catalog reconciliation, and recovery UI. Audit all deletion paths and ensure export works for a stopped project even if its runtime cannot currently start, where the underlying files remain readable; mark such an archive as recovery data rather than a verified clean backup.

**Exit:** a complete backup restores database rows, Auth users, and Storage object bytes; corrupt or incompatible imports preserve all existing projects. Quota failures and abrupt termination do not trigger silent resets.

### Milestone 5: static release and documentation

Produce a clean static build, configure real headers and caching, validate deployment artifact limits, and smoke-test the production-served files. Document supported browsers, storage locality, backups, runtime limitations, build reproducibility, and recovery. Complete runtime distribution/notice requirements before making the website public.

**Exit:** a new visitor can complete the entire required flow on the deployed static site. Confirm project operations need no application backend and project data/credentials are not sent to the host.

### Milestone 6: optional installation and offline use

Implement the manifest, single service worker, runtime download inventory, offline preparation, and coordinated updates described in section 12.

**Exit:** pass the offline and update acceptance scenarios with real artifacts and persistent browser profiles.

## 14. Verification and release acceptance

Use focused unit tests for lifecycle transitions, stale-result rejection, catalog migrations, lock ordering, archive validation, and recovery intents. Use Svelte component tests for form behavior and destructive-action states where useful. Mocks can test UI behavior but do not prove database persistence.

Use Playwright with real WASM artifacts for integration and end-to-end tests. Run expensive runtime cases with conservative concurrency. Use persistent browser profiles where a fresh page alone would not prove reopen behavior. Test a production build as well as development mode; include current stable Chrome/Edge on the supported desktop platforms before claiming support.

The required acceptance suite must demonstrate:

1. **Fresh visit:** useful UI appears before runtime download; missing capabilities or headers produce actionable messages.
2. **Create and use:** a blank project runs real PostgreSQL, REST, Auth, Storage, and Realtime without a hosted Supabase project.
3. **Isolation:** three projects retain different rows, local users, objects, credentials, and SDK session namespaces across repeated A/B/C switches.
4. **Durability:** acknowledged transactions and completed object uploads survive graceful close, reload, browser reopen, and forced page/renderer termination.
5. **Ownership:** two tabs can use different projects; attempts to open, export, or delete a store owned elsewhere fail safely. Closing/crashing the owner permits recovery.
6. **Switch races:** rapid clicks, pending queries, open subscriptions, and late responses cannot start overlapping stacks or update another project's screen.
7. **Rename:** data and store identity remain unchanged.
8. **Deletion:** deleting active and inactive projects removes only the chosen store and its app records; cancellation changes nothing; interrupted deletion can finish.
9. **Recovery:** incomplete first provisioning is retried with saved credentials; missing/corrupt stores and fingerprint mismatches never become silent empty projects.
10. **Backups:** stopped-store export/import preserves representative rows, users, policies, and large object bytes; invalid paths, checksums, versions, and quota failures never overwrite existing projects.
11. **SQL behavior:** errors, result limits, timeouts, cancellation, DDL refresh, and open transactions behave predictably during navigation and shutdown.
12. **Release:** correct headers/MIME types, immutable asset resolution, no hidden backend dependency, no credentials in logs/URLs, and no unexpected network calls containing project data.
13. **Resource cleanup:** repeated open/switch/close cycles leave no orphan Workers, locks, sockets, timers, or steadily growing retained memory. Measure browser behavior rather than applying native bundle benchmarks.
14. **Usability:** keyboard-only create/switch/export/delete, focus restoration, visible progress, readable errors, and supported viewport layouts work.

Record cold download, cold provisioning, warm reopen, switch, and shutdown timings, along with artifact sizes and memory observations on a named reference machine. Establish performance budgets from milestone 0 measurements; upstream's native CLI timings and memory figures are not browser guarantees. Keep potentially long startup operations cancelable where the runtime supports it and always show the stage and elapsed time.

CI should run formatting, linting, `svelte-check`/TypeScript, focused unit tests, a static build, and a representative real-runtime smoke suite. Run the longer crash, quota, backup, and multi-tab scenarios on the integration/release pipeline. Preserve diagnostic artifacts with secrets and user data redacted.

## 15. Proposed repository structure

This is the intended layout once implementation starts. Only the planning documentation and repository housekeeping files exist at this point.

```text
src/
  App.svelte
  main.ts
  app.css
  lib/
    components/ui/             # shadcn-svelte components
    components/projects/       # catalog, switcher, lifecycle dialogs
    components/workspace/      # overview, schema browser, SQL, settings
    projects/                  # model, IndexedDB repository, manager, recovery
    runtime/                   # adapter, SQL transport, SDK client ownership
    storage/                   # quota monitoring, archives, validation
    platform/                  # capabilities, locks, tab coordination
    navigation/                # hash routes and selected project
  sw.ts                        # optional PWA worker
runtime/
  upstream.lock.json
  patches/
scripts/
  prepare-runtime.mjs
  verify-runtime.mjs
public/
  runtime/<buildId>/           # generated assets, ignored by Git
tests/
  unit/
  e2e/
docs/
  phase-1-plan.md
  runtime-integration.md       # add after milestone 0
  deployment.md               # add with the release pipeline
  recovery.md                  # add with tested recovery behavior
```

## 16. Remaining decisions and phase 2 handoff

The implementation can begin with the defaults above. Milestone 0 must settle runtime artifact retention/access, exact integration patches, SQL cancellation support, backup limits/compatibility, and the deployment host/domain. Whether to ship the optional PWA milestone is a product decision after the core lifecycle is reliable.

The main risks are loss of access to matching upstream artifacts, changes to the experimental runtime, storage pressure, incomplete cross-tab cleanup, and incompatible provisioning inputs. The plan addresses these through a pinned distribution, explicit compatibility records, operation intents, real-runtime testing, and complete local backups.

For phase 2, retain immutable project IDs, versioned runtime configuration, and the `ProjectSession` boundary. Future app definitions can reference a project ID without changing how database storage is owned. Application execution will need a separate trust boundary, narrowly scoped messaging/network access, and anon/user credentials instead of workspace admin credentials. Design that sandbox and app-to-project bridge in phase 2; do not execute arbitrary application JavaScript in the phase 1 manager's origin.
