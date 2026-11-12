// Exercise the actual Pages build under a subpath on a host with no isolation headers.
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const url = process.env.PAGES_URL ?? 'http://127.0.0.1:4175/supaworld/';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
const writes = [];
const requests = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('request', (r) => {
  requests.push(r.url());
  if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method())) writes.push(r.method() + ' ' + r.url());
});
async function create(name) {
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Project name', { exact: true }).fill(name);
  await d.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByRole('heading', { name: `${name}.`, exact: true })).toBeVisible({
    timeout: 180_000,
  });
}
async function query(sql, value) {
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
  const head = await context.request.head(url);
  expect(head.status()).toBe(200);
  expect(head.headers()['cross-origin-embedder-policy']).toBeUndefined();
  await page.goto(url);
  await expect(page.getByRole('button', { name: 'Create your first project' })).toBeEnabled({
    timeout: 30_000,
  });
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  expect(await page.evaluate(() => window.__SUPAWORLD_TEST__)).toBeUndefined();
  expect(requests.filter((u) => new URL(u).pathname.includes('/runtime/'))).toEqual([]);
  await create('Pages alpha');
  const original = page.url();
  await page.getByRole('button', { name: 'Check services', exact: true }).click();
  await expect(page.locator('.diagnostic-row')).toHaveCount(5, { timeout: 120_000 });
  await expect(page.locator('.diagnostic-row span')).toHaveText([
    'Ready',
    'Ready',
    'Ready',
    'Ready',
    'Ready',
  ]);
  await query(
    "CREATE TABLE public.notes(body text); INSERT INTO public.notes VALUES ('pages-persisted'); SELECT body FROM public.notes;",
    'pages-persisted',
  );
  expect(requests.some((u) => u.endsWith('/auth.wasm.gz'))).toBe(true);
  const bad = requests.filter(
    (u) =>
      new URL(u).origin === new URL(url).origin &&
      !new URL(u).pathname.startsWith(new URL(url).pathname),
  );
  expect(bad).toEqual([]);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open project', exact: true })).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'SQL query' })).toBeVisible({ timeout: 120_000 });
  await query('SELECT body FROM public.notes', 'pages-persisted');
  await page.getByRole('button', { name: 'All projects', exact: true }).first().click();
  await create('Pages beta offline');
  await query('SELECT 42 AS answer', '42');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open project', exact: true })).toBeVisible();
  await page.goto(original);
  await expect(page.getByRole('heading', { name: 'Pages alpha.', exact: true })).toBeVisible({
    timeout: 120_000,
  });
  await query('SELECT body FROM public.notes', 'pages-persisted');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open project', exact: true })).toBeVisible();
  await expect.poll(() => page.workers().length).toBe(0);
  expect(errors).toEqual([]);
  expect(writes).toEqual([]);
  console.log(
    JSON.stringify(
      {
        url,
        headerlessIsolation: true,
        repositorySubpath: true,
        allFiveServices: true,
        compressedRuntime: true,
        offlineCreateAndSwitch: true,
        noProjectDataNetworkWrites: true,
        uncaughtErrors: errors.length,
      },
      null,
      2,
    ),
  );
} catch (e) {
  await mkdir('.cache', { recursive: true });
  await page.screenshot({ path: '.cache/pages-failure.png', fullPage: true }).catch(() => {});
  console.error(
    await page
      .locator('body')
      .innerText()
      .catch(() => ''),
  );
  throw e;
} finally {
  await browser.close();
}
