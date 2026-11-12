# Static deployment

Run `npm ci && npm run build`. The build verifies/downloads the retained runtime and writes a complete static site to `dist/`. No runtime backend, database server, or API proxy is required on the host.

Use a stable HTTPS origin. Switching domain, scheme, or port gives visitors a different browser storage origin. Keep a previous origin available for export if migrating later.

## Required host behavior

- Serve the generated isolation headers on the document and Worker resources: COOP `same-origin`, COEP `require-corp`, and CORP `same-origin`.
- Serve WASM as `application/wasm`, JavaScript as a script MIME type, and the manifest as `application/manifest+json`.
- Serve `.br` or `.gz` representations with the correct `Content-Encoding` and `Vary: Accept-Encoding`, retaining the original MIME type. Generating compressed files alone does not configure the host to use them.
- Keep `/runtime/<buildId>/` and hashed `/assets/` files immutable. Revalidate the HTML entrypoint and `sw.js`.
- Support files of at least 71 MB and a site artifact containing the raw and compressed runtime. Check the current build’s actual sizes; small per-file hosting limits will not fit.
- Route navigation to `/index.html` as needed. App routes use fragments, so a basic static host works without server-side routing.

The build emits `_headers` with isolation, caching, and a CSP compatible with the tested Worker/WASM pipeline. The early theme script is authorized by an exact hash. Third-party scripts are not allowed. Hosts must honor that header file or translate it into their own configuration.

## Included static preview

```sh
npm run build
npm run preview
# Another terminal:
node tests/production.mjs
```

The preview serves the existing `dist/` files at port 4173, selects Brotli/gzip, and applies the generated CSP and isolation headers. It is also the reference deployment used by the automated offline/browser-reopen check.

## Nginx example

Use this behind your TLS termination, substituting the site path. Copy the exact CSP from `dist/csp.json` into your deployment configuration as an additional header; it changes if inline boot code changes.

```nginx
server {
    listen 80;
    server_name supaworld.example;
    root /srv/supaworld/dist;
    index index.html;

    add_header Cross-Origin-Opener-Policy same-origin always;
    add_header Cross-Origin-Embedder-Policy require-corp always;
    add_header Cross-Origin-Resource-Policy same-origin always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy same-origin always;
    # add_header Content-Security-Policy "<exact generated policy>" always;

    include mime.types;
    gzip_static on;
    gzip_vary on;
    # Optional when the Brotli static module is installed:
    # brotli_static on;

    location / { try_files $uri $uri/ =404; }
    location = /sw.js { expires -1; }
    location = /index.html { expires -1; }
    location /assets/ { expires 1y; }
    location /runtime/ { expires 1y; }
}
```

Ensure your MIME configuration includes `application/wasm wasm;`. Do not add duplicate MIME declarations if already present. Keep the isolation/CSP headers inherited in every location; Nginx `add_header` inheritance changes if overriding them in a child location.

GitHub Pages requires an isolation bootstrap worker that this release does not provide. The current PWA worker expects real host headers. Use a header-capable host for this version.

## CI

The workflow uses the repository token to fetch the retained private runtime release, checks formatting/types/unit tests, runs the real Chromium suite, builds the site, and tests the compressed production deployment with offline browser restarts. It retains browser failure evidence. The workflow does not publish a public website.

For a runtime update, prepare a new build ID, package it with `npm run runtime:pack`, publish the archive/checksum to a new private runtime release, and commit the new lock only after compatibility has been evaluated. Never replace an existing build in place or remove an asset version referenced by saved projects.
