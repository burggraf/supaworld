// Optional local measurements. Run against an isolated VITE_TEST_API=1 dev server.
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, totalmem, platform, arch } from 'node:os';
const browser = await chromium.launch();
const page = await browser.newPage();
try {
  await page.goto(process.env.PERFORMANCE_URL ?? 'http://127.0.0.1:5175');
  await page.getByRole('button', { name: 'Create your first project' }).waitFor();
  const result = await page.evaluate(async () => {
    const manager = window.__SUPAWORLD_TEST__;
    if (!manager) throw new Error('Use an isolated VITE_TEST_API=1 development server.');
    const measurements = {};
    async function measure(label, action) {
      const start = performance.now();
      const value = await action();
      measurements[label] = Math.round(performance.now() - start);
      return value;
    }
    const start = performance.now();
    let preparationMs;
    const unsubscribe = manager.state.subscribe((state) => {
      if (preparationMs === undefined && state.stage === 'Creating the database and services')
        preparationMs = Math.round(performance.now() - start);
    });
    const first = await measure('coldCreateMs', () => manager.create('Measurement A'));
    unsubscribe();
    const coldRuntimeTimings = { ...manager.activeStack.timings };
    await measure('shutdownMs', () => manager.close());
    await measure('warmReopenMs', () => manager.open(first));
    const second = await measure('secondProjectCreateMs', () => manager.create('Measurement B'));
    await measure('switchMs', () => manager.open(first));
    await manager.close();
    for (let i = 0; i < 3; i++) {
      await manager.open(first);
      await manager.close();
    }
    const held = (await navigator.locks.query()).held ?? [];
    const ownedLocksAfterClose = held.filter(
      (l) => l.name?.startsWith('supa-wasm/') || l.name?.startsWith('supaworld/project/'),
    ).length;
    await manager.delete(first);
    await manager.delete(second);
    return {
      measurements: { ...measurements, preparationMs },
      coldRuntimeTimings,
      ownedLocksAfterClose,
    };
  });
  // Worker termination notifications arrive after the page's stop promise settles.
  const stoppedAt = Date.now();
  await expect.poll(() => page.workers().length, { timeout: 10_000 }).toBe(0);
  result.workerNotificationsSettledMs = Date.now() - stoppedAt;
  result.workersAfterClose = page.workers().length;
  const report = {
    measuredAt: new Date().toISOString(),
    browser: browser.version(),
    reference: {
      platform: platform(),
      arch: arch(),
      cpu: cpus()[0].model,
      vcpus: cpus().length,
      ramBytes: totalmem(),
    },
    ...result,
    note: 'Unthrottled local development server; timings are observations, not performance guarantees. Preparation includes asset download, hashing, and cache writes. Worker/total-browser memory is not measured.',
  };
  await mkdir('.cache', { recursive: true });
  await writeFile('.cache/performance.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
