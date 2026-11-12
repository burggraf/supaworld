// End-to-end checks against the actual compressed static deployment, with no test-only app API.
import { chromium, expect } from '@playwright/test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const origin = process.env.PRODUCTION_URL ?? 'http://127.0.0.1:4173';
const profile = await mkdtemp(join(tmpdir(), 'supaworld-production-'));
await mkdir('.cache', { recursive: true });
const options = { headless: true, viewport: { width: 1440, height: 1000 } };
let context;
const errors = [];
const writes = [];
function observe(page) {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method())) writes.push(`${r.method()} ${r.url()}`);
  });
}
async function create(page, name) {
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Project name', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByRole('heading', { name: `${name}.`, exact: true })).toBeVisible({
    timeout: 180_000,
  });
}
async function query(page, sql, value) {
  await page
    .getByRole('navigation', { name: 'Project', exact: true })
    .getByRole('button', { name: 'SQL editor', exact: true })
    .click();
  await page.getByRole('textbox', { name: 'SQL query' }).fill(sql);
  await page.getByRole('button', { name: 'Run query', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Run query', exact: true })).toBeEnabled({
    timeout: 90_000,
  });
  await expect(page.getByRole('cell', { name: value, exact: true })).toBeVisible();
}
try {
  context = await chromium.launchPersistentContext(profile, options);
  let page = context.pages()[0];
  observe(page);
  const head = await context.request.head(`${origin}/runtime/b4397a9a-urls-v1/auth.wasm`, {
    headers: { 'Accept-Encoding': 'br' },
  });
  expect(head.headers()['content-encoding']).toBe('br');
  expect(head.headers()['content-type']).toBe('application/wasm');
  expect(head.headers()['cross-origin-embedder-policy']).toBe('require-corp');
  await page.goto(origin);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  expect(await page.evaluate(() => window.__SUPAWORLD_TEST__)).toBeUndefined();
  await create(page, 'Offline observatory');
  const original = new URL(page.url()).hash;
  await page.screenshot({ path: '.cache/production-overview.png', fullPage: true });
  await query(
    page,
    "CREATE TABLE public.notes(body text); INSERT INTO public.notes VALUES ('survives-offline'); SELECT body FROM public.notes;",
    'survives-offline',
  );
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open project', exact: true })).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'SQL query' })).toBeVisible({ timeout: 120_000 });
  await query(page, 'SELECT body FROM public.notes', 'survives-offline');
  await page.getByRole('button', { name: 'All projects', exact: true }).first().click();
  await create(page, 'Made offline');
  await query(page, 'SELECT 42 AS answer', '42');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open project', exact: true })).toBeVisible();
  await context.close();
  context = await chromium.launchPersistentContext(profile, options);
  await context.setOffline(true);
  page = context.pages()[0];
  observe(page);
  await page.goto(`${origin}/${original.replace('/overview', '/sql')}`);
  await expect(page.getByRole('textbox', { name: 'SQL query' })).toBeVisible({ timeout: 120_000 });
  await query(page, 'SELECT body FROM public.notes', 'survives-offline');
  // Install a waiting update while a real stack is owned by another page.
  await context.setOffline(false);
  const other = await context.newPage();
  observe(other);
  await other.goto(origin);
  await expect(other.getByRole('button', { name: 'New project', exact: true })).toBeEnabled();
  await other.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js?update-check=1');
  });
  await expect(other.getByRole('button', { name: 'Update app', exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await other.getByRole('button', { name: 'Update app', exact: true }).click();
  await expect(other.getByRole('alert')).toContainText('Close projects in all Supaworld tabs');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open project', exact: true })).toBeVisible();
  await other.getByRole('button', { name: 'Update app', exact: true }).click();
  await expect(other.getByRole('button', { name: 'Update app', exact: true })).not.toBeVisible({
    timeout: 30_000,
  });
  await other.close();
  // Missing cache entries give a recoverable offline error, preserving project files.
  await page.evaluate(async () => {
    const cache = await caches.open('supaworld-runtime-b4397a9a-urls-v1');
    await cache.delete('/runtime/b4397a9a-urls-v1/auth.wasm');
  });
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open project', exact: true })).toBeEnabled();
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Offline observatory.', exact: true }),
  ).toBeVisible({ timeout: 120_000 });
  await query(page, 'SELECT body FROM public.notes', 'survives-offline');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open project', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  expect(writes).toEqual([]);
  console.log(
    JSON.stringify(
      {
        staticCompression: true,
        crossOriginIsolation: true,
        productionTestApiAbsent: true,
        offlineReload: true,
        offlineCreate: true,
        browserReopen: true,
        updateOwnershipGuard: true,
        missingOfflineAssetRecovery: true,
        projectDataNetworkWrites: writes.length,
        uncaughtErrors: errors.length,
      },
      null,
      2,
    ),
  );
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
