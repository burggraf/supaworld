# Recovery and backups

Do not clear site storage as a troubleshooting step if you need the projects in it. Projects are local to the exact origin, including its protocol and port, and the current browser profile.

## Opening was interrupted

A new project’s catalog entry and credentials are committed before provisioning starts. Open the same entry again to retry with those saved settings. Upstream may rebuild an incomplete first provisioning; it does not reset a completed store when its fingerprint differs.

If opening fails, the catalog keeps the project and error. A completed project with missing files or a missing completion marker is refused rather than replaced with an empty database. Restore an exported backup to recover it.

## A project is open elsewhere

Stop it in the owning tab, or close that tab. Sleeping retains ownership. After a crash, the browser releases its Web Lock and may need a few seconds to release file handles. Retry after that. The app does not forcibly steal a live lock.

## Closing failed

The app blocks further opens in that page because upstream may still hold files and ownership. Keep any error details, then reload the page and reopen the same project. This is a crash recovery path; writes without an acknowledged result may or may not have committed. Check before repeating a mutation.

## Deletion or import was interrupted

Deletion records a tombstone before removing files. On the next visit, the app attempts to finish it with the project’s operation/store locks. A failed deletion remains listed and can be retried. Only the selected project’s directory and catalog-owned records are removed.

An interrupted import stays in `importing` and cannot be started. Delete that incomplete restore through Project settings, then import the original backup again. Existing projects are never used as import destinations. A restore is marked ready only after opening without reprovisioning and passing a real query.

Unlisted `supaworld-*` stores are reported and retained. Missing catalog credentials cannot be reconstructed from a PostgreSQL directory. Keep the files for manual recovery and restore a complete backup if available.

## Export and restore

Export from Project settings or the project card menu. Export stops an active project, acquires its store lock, and copies the complete stopped store. Use the browser’s save picker for streaming output. If no picker is available, downloads are limited to 256 MiB to bound memory use.

The `.supaworld-backup` format is a magic prefix, a length-prefixed JSON manifest, and the inventory’s file bytes in order. The manifest includes format/runtime versions, provisioning credentials, file sizes, and SHA-256 hashes. Files are streamed to the destination; checksums are computed one bounded file at a time. Phase 1 limits are 1 GiB total / 128 MiB per file.

Import allocates a fresh project ID and OPFS directory, validates every path, size, checksum, service configuration, and completion marker, and starts it with the original provisioning settings before marking it ready. A restored copy intentionally preserves its backup’s credentials while using a new virtual origin and SDK namespace.

Backups are unencrypted and contain local user data and credentials. Keep them somewhere appropriate. They are physical snapshots of this runtime, not `pg_dump` files or direct hosted-Supabase imports.

A stopped but incomplete store may be exported as a **recovery archive**. Normal import rejects such an archive to prevent upstream from clearing an unsealed store. Preserve it for manual recovery; this release does not attempt journal repair.

## Offline and application updates

Use the production app, wait for its service worker, and prepare the full runtime from Storage & offline. A cached shell alone cannot create a database. Offline readiness depends on all required assets remaining in the browser cache. Browser storage controls can remove caches independently of project files.

An update closes the current project, then refuses to activate while another tab owns a project or is preparing runtime files. Close those projects/operations and apply the update again. Existing runtime versions and project data are retained.
