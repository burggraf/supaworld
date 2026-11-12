# Phase 1 verification

Verified locally on 2026-11-12 with real runtime build `b4397a9a-urls-v1`, Playwright Chromium 158.0.8127.18, Linux x64, and Node 24.22.1. These checks use disposable browser profiles and actual WASM services, not service mocks.

## Results

- Svelte/TypeScript and accessibility diagnostics: no errors or warnings. Formatting checks pass.
- Unit suite: 14 tests pass for catalog transactions, immutable identity, name/identifier handling, and backup validation.
- Browser suite: five scenarios pass, covering the lightweight/responsive catalog; three isolated projects and cross-tab ownership; all five services and RLS; recovery from injected failures; and real renderer crashes.
- SQL, Auth users, and Storage object bytes survive stop/reopen, physical backup/restore, and renderer termination. The service round-trip includes an object larger than 5 MiB.
- Interrupted first provisioning retries the same catalog entry. Failed downloads, corrupt archives, simulated insufficient quota, changed credentials, missing completion markers, and interrupted deletion preserve existing projects.
- The compressed production deployment passes MIME/CSP/isolation checks, offline reload and creation, actual browser-process reopen, missing-cache recovery, and refusal to update while another tab owns a project. No unexpected project-data network writes or uncaught page errors were recorded.
- Downloading and preparing the retained runtime from a fresh directory succeeds. The sibling upstream checkout remains unchanged.
- `npm audit --omit=dev` reports no vulnerabilities in production dependencies.

The quota check injects an insufficient storage estimate; it does not fill a real disk. Chromium is the automated reference browser. Manual testing on current Chrome/Edge and other desktop platforms remains useful; Safari, Firefox, and mobile runtime execution are unsupported. Full-browser retained-memory profiling has not been performed.

## Reference timings

The 17:32 UTC sample used a 4-vCPU AMD EPYC 7452 virtual machine with 16 GB RAM, the Chromium version above, and an unthrottled development server over loopback. Runtime preparation includes the local download, integrity checks, and cache writes. End-user Internet download time is additional and depends on the connection.

| Operation                                          | Observed time |
| -------------------------------------------------- | ------------: |
| Cold project creation, including preparation       |       13.29 s |
| Shared runtime preparation within that creation    |        1.89 s |
| Initial database provisioning within that creation |        3.64 s |
| Service migrations, running concurrently           |   5.51–6.76 s |
| Warm project reopen                                |        1.48 s |
| Create another blank project                       |       14.13 s |
| Switch between existing projects                   |        2.38 s |
| Graceful shutdown                                  |        0.60 s |

After three additional reopen/close cycles, zero project ownership locks and zero Workers remained. Worker termination notifications settled within 2 ms of the final measurement. This does not establish a total-memory bound.

Initial investigation thresholds on this reference machine are 60 seconds for cold creation, 5 seconds for warm reopen/switch, and 5 seconds for shutdown. These are local regression targets rather than promises for arbitrary networks, devices, or project sizes; CI does not enforce wall-clock timing thresholds.

## Payload

The pinned runtime inventory contains PostgreSQL, PostgREST, Auth, Storage, Realtime, their images/template, and the browser runtime code. Compute is excluded.

| Shared runtime   |       Bytes | Decimal MB |
| ---------------- | ----------: | ---------: |
| Uncompressed     | 234,580,496 |     234.58 |
| gzip level 9     |  56,718,283 |      56.72 |
| Brotli quality 9 |  42,562,500 |      42.56 |

The initial app JavaScript and CSS together are approximately 157 KB with Brotli / 171 KB with gzip, plus HTML, icons, the manifest, and the small service worker. Backup code loads separately. The catalog does not request the WASM inventory. Runtime download and caching happen when a project opens or offline preparation is requested.

## Reproduce

See README for the full validation commands. For an optional local timing sample, run an isolated development server:

```sh
VITE_TEST_API=1 npm run dev -- --port 5175 --host 127.0.0.1
# A second terminal:
node tests/performance.mjs
```

This writes `.cache/performance.json` with reference-machine information, startup/switch/shutdown timings, runtime provisioning timings, and settled Worker/ownership counts. The test hook is only enabled explicitly and is absent from the Tailscale/production build.
