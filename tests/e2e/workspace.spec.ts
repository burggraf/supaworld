import { test, expect, type Page } from '@playwright/test';
async function create(page: Page, name: string) {
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Project name', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByRole('heading', { name: `${name}.`, exact: true })).toBeVisible({
    timeout: 180_000,
  });
}
async function sql(page: Page, text: string) {
  await page
    .getByRole('navigation', { name: 'Project', exact: true })
    .getByRole('button', { name: 'SQL editor', exact: true })
    .click();
  await page.getByRole('textbox', { name: 'SQL query' }).fill(text);
  await page.getByRole('button', { name: 'Run query', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Run query', exact: true })).toBeEnabled({
    timeout: 90_000,
  });
}
async function api<T>(page: Page, fn: string): Promise<T> {
  return page.evaluate(async (source) => {
    const manager = (window as unknown as { __SUPAWORLD_TEST__: unknown }).__SUPAWORLD_TEST__;
    if (!manager) throw new Error('Test API unavailable');
    return await new Function('manager', `return (async()=>{${source}})()`)(manager);
  }, fn) as Promise<T>;
}

test('lightweight catalog, keyboard dialogs, and responsive layout', async ({ page }) => {
  const runtimeRequests: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.startsWith('/runtime/')) runtimeRequests.push(r.url());
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Create your first project' })).toBeEnabled();
  expect(runtimeRequests).toEqual([]);
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog')).toContainText('Find your project');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveClass('dark');
  await page.reload();
  await expect(page.locator('html')).toHaveClass('dark');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Storage and offline', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Make yourself at home.' })).toBeVisible();
});

test('three isolated projects, SQL, rename, table browser, cross-tab ownership, backup, and deletion', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await create(page, 'Atlas');
  await sql(
    page,
    "CREATE TABLE public.notes(id int PRIMARY KEY, body text); INSERT INTO public.notes VALUES (1, 'atlas-only'); SELECT body FROM public.notes;",
  );
  await expect(page.getByRole('cell', { name: 'atlas-only', exact: true })).toBeVisible();
  const first = await api<string>(page, 'return manager.current.activeId');
  await page.getByRole('button', { name: 'All projects', exact: true }).first().click();
  await create(page, 'Birch');
  await sql(
    page,
    "CREATE TABLE public.notes(id int PRIMARY KEY, body text); INSERT INTO public.notes VALUES (1, 'birch-only'); SELECT body FROM public.notes;",
  );
  const second = await api<string>(page, 'return manager.current.activeId');
  await page.getByRole('button', { name: 'All projects', exact: true }).first().click();
  await create(page, 'Cedar');
  await sql(
    page,
    "CREATE TABLE public.notes(id int PRIMARY KEY, body text); INSERT INTO public.notes VALUES (1, 'cedar-only'); SELECT body FROM public.notes;",
  );
  const third = await api<string>(page, 'return manager.current.activeId');
  await api(page, `await manager.open('${first}');`);
  await page.goto(`/#/projects/${first}/sql`);
  await sql(page, 'SELECT body FROM public.notes');
  await expect(page.getByRole('cell', { name: 'atlas-only', exact: true })).toBeVisible();
  // A reload without stop exercises PostgreSQL recovery and the page-owned lock being released.
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'SQL query' })).toBeVisible({ timeout: 120_000 });
  await sql(page, 'SELECT body FROM public.notes');
  await expect(page.getByRole('cell', { name: 'atlas-only', exact: true })).toBeVisible();
  const other = await context.newPage();
  await other.goto('/');
  const conflict = await api<string>(
    other,
    `try{await manager.open('${first}');return '';}catch(e){return e.message;}`,
  );
  expect(conflict).toMatch(/another page or tab/);
  const deletion = await api<string>(
    other,
    `try{await manager.delete('${first}');return '';}catch(e){return e.message;}`,
  );
  expect(deletion).toMatch(/another tab/);
  await api(
    other,
    `await manager.open('${second}');const q=await manager.query('SELECT body FROM public.notes');if(q.rows[0][0]!=='birch-only')throw new Error('Wrong project data');await manager.close();`,
  );
  await other.close();
  await api(page, `await manager.rename('${first}','Atlas renamed');`);
  await page
    .getByRole('navigation', { name: 'Project', exact: true })
    .getByRole('button', { name: 'Database', exact: true })
    .click();
  await page.getByRole('button', { name: 'public.notes', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'atlas-only', exact: true })).toBeVisible();
  // Exercise the user-facing file import/export without requiring an operating-system picker.
  await page.evaluate(() =>
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }),
  );
  await page
    .getByRole('navigation', { name: 'Project', exact: true })
    .getByRole('button', { name: 'Project settings', exact: true })
    .click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup', exact: true }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  await page.getByRole('button', { name: 'All projects', exact: true }).first().click();
  await page.getByLabel('Import project backup').setInputFiles(path!);
  await expect(
    page.getByRole('heading', { name: 'Atlas renamed (restored).', exact: true }),
  ).toBeVisible({ timeout: 180_000 });
  await sql(page, 'SELECT body FROM public.notes');
  await expect(page.getByRole('cell', { name: 'atlas-only', exact: true })).toBeVisible();
  const imported = await api<string>(page, 'return manager.current.activeId');
  expect(imported).not.toBe(first);
  await api(page, `await manager.delete('${second}');await manager.open('${third}');`);
  await page.goto(`/#/projects/${third}/sql`);
  await sql(page, 'SELECT body FROM public.notes');
  await expect(page.getByRole('cell', { name: 'cedar-only', exact: true })).toBeVisible();
  await api(page, `await manager.close();`);
  await page.getByRole('button', { name: 'All projects', exact: true }).first().click();
  await page.getByRole('button', { name: 'Actions for Cedar', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete project', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Delete permanently' })).toBeDisabled();
  await dialog.getByLabel('Type Cedar to confirm').fill('Cedar');
  await dialog.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(page.getByRole('button', { name: 'Open Cedar', exact: true })).not.toBeVisible();
  const names = await api<string[]>(
    page,
    'await manager.refresh();return manager.current.projects.map(p=>p.name)',
  );
  expect(names.sort()).toEqual(['Atlas renamed', 'Atlas renamed (restored)'].sort());
});

test('all five services, RLS, durable Auth users and objects, cancellation, and bounded results', async ({
  page,
  browser,
}) => {
  const cdp = await browser.newBrowserCDPSession();
  const liveWorkers = async () =>
    (await cdp.send('Target.getTargets')).targetInfos
      .filter((t) => t.type === 'worker')
      .map((t) => t.url)
      .sort();
  await page.goto('/');
  await create(page, 'Service lab');
  // Confirm that this measures real running Workers before using it for cleanup.
  expect((await liveWorkers()).length).toBeGreaterThan(0);
  const result = await api<any>(
    page,
    `
  const client=await manager.client('admin');
  const created=await client.auth.admin.createUser({email:'local@example.test',password:'local-password-123',email_confirm:true});if(created.error)throw created.error;
  const bucket=await client.storage.createBucket('acceptance');if(bucket.error)throw bucket.error;
  const object=new Uint8Array(5*1024*1024+123);for(let i=0;i<object.length;i++)object[i]=i%251;
  const uploaded=await client.storage.from('acceptance').upload('large.bin',object);if(uploaded.error)throw uploaded.error;
  await manager.query("CREATE TABLE public.private_notes(owner uuid NOT NULL DEFAULT auth.uid(), body text); ALTER TABLE public.private_notes ENABLE ROW LEVEL SECURITY; CREATE POLICY own ON public.private_notes TO authenticated USING(owner=auth.uid()) WITH CHECK(owner=auth.uid()); GRANT ALL ON public.private_notes TO authenticated; NOTIFY pgrst, 'reload schema';");
  const user=await manager.client('anon');const login=await user.auth.signInWithPassword({email:'local@example.test',password:'local-password-123'});if(login.error)throw login.error;
  let insert;for(let i=0;i<20;i++){insert=await user.from('private_notes').insert({body:'private'});if(!insert.error)break;await new Promise(r=>setTimeout(r,200));}if(insert.error)throw insert.error;
  const otherUser=await client.auth.admin.createUser({email:'other@example.test',password:'local-password-123',email_confirm:true});if(otherUser.error)throw otherUser.error;
  const other=await manager.client('anon');const otherLogin=await other.auth.signInWithPassword({email:'other@example.test',password:'local-password-123'});if(otherLogin.error)throw otherLogin.error;
  const denied=await other.from('private_notes').select();if(denied.error)throw denied.error;
  const diagnostics=await manager.diagnostics();const id=manager.current.activeId;
  await manager.close();await manager.open(id);
  const restored=await manager.client('admin');const users=await restored.auth.admin.listUsers();const objectAgain=await restored.storage.from('acceptance').download('large.bin');if(objectAgain.error)throw objectAgain.error;
  const backup=await manager.export(id);const imported=await manager.import(new File([backup],'roundtrip.supaworld-backup'));if(imported===id)throw new Error('Restore reused the original ID');const restoredCopy=await manager.client('admin');const copyObject=await restoredCopy.storage.from('acceptance').download('large.bin');if(copyObject.error)throw copyObject.error;const copyUsers=await restoredCopy.auth.admin.listUsers();if(copyUsers.data.users.length!==2)throw new Error('Auth users missing from backup');const restoredBytes=new Uint8Array(await copyObject.data.arrayBuffer());const intact=restoredBytes.length===object.length&&restoredBytes.every((v,i)=>v===object[i]);
  const bounded=await manager.query('SELECT generate_series(1, 1500) AS n');
  const cancel=new AbortController();const pending=manager.query('SELECT pg_sleep(20)',cancel.signal);setTimeout(()=>cancel.abort(),1000);const cancelled=await pending;
  return {diagnostics,denied:denied.data,users:users.data.users.length,intact,bounded:{rows:bounded.rows.length,truncated:bounded.truncated},cancelled:cancelled.error?.code};
 `,
  );
  expect(result.diagnostics.every((r: any) => r.ok)).toBe(true);
  expect(result.denied).toEqual([]);
  expect(result.users).toBe(2);
  expect(result.intact).toBe(true);
  expect(result.bounded).toEqual({ rows: 1000, truncated: true });
  expect(result.cancelled).toBe('57014');
  await api(page, 'await manager.close();');
  // Browser-owned target enumeration avoids stale Playwright worker handles after termination.
  await expect.poll(liveWorkers).toEqual([]);
  expect(
    await api<number>(
      page,
      "return (await navigator.locks.query()).held.filter(l=>l.name?.startsWith('supa-wasm/')).length",
    ),
  ).toBe(0);
  if (page.workers().length)
    console.log(
      'Closed Worker handles retained by Playwright:',
      page.workers().map((w) => w.url()),
    );
  await cdp.detach();
});

test('failed downloads, corrupt backups, quota failures, fingerprint guards, and deletion recovery preserve data', async ({
  page,
}) => {
  await page.goto('/');
  await page.route('**/runtime/**/auth.wasm', (route) =>
    route.fulfill({ status: 503, body: 'injected download failure' }),
  );
  const failure = await api<string>(
    page,
    "try{await manager.create('Recovery lab');return '';}catch(e){return e.message;}",
  );
  expect(failure).toContain('Could not download auth.wasm');
  expect(page.workers().length).toBe(0);
  const id = await api<string>(page, 'return manager.current.projects[0].id');
  await page.unroute('**/runtime/**/auth.wasm');
  const result = await api<any>(
    page,
    `
  const id='${id}';
  async function get(store,key){const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('supaworld',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});try{return await new Promise((resolve,reject)=>{const r=db.transaction(store).objectStore(store).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}finally{db.close();}}
  async function put(store,value){const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('supaworld',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});try{await new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value);tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});}finally{db.close();}}
  await manager.open(id);await manager.query("CREATE TABLE public.kept(body text); INSERT INTO public.kept VALUES ('still-here');");
  const backup=await manager.export(id);
  const last=new Uint8Array(await backup.slice(-1).arrayBuffer());last[0]^=255;
  let corrupt='';try{await manager.import(new File([backup.slice(0,-1),last],'corrupt.supaworld-backup'));}catch(e){corrupt=e.message;}
  if(manager.current.projects.length!==1)throw new Error('Corrupt restore left a catalog entry');
  const root=await (await navigator.storage.getDirectory()).getDirectoryHandle('supa-wasm');
  let stores=0;for await(const name of root.keys())if(name.startsWith('supaworld-'))stores++;
  if(stores!==1)throw new Error('Corrupt restore left project files');
  const estimate=navigator.storage.estimate;let quota='';
  Object.defineProperty(navigator.storage,'estimate',{configurable:true,value:async()=>({usage:100,quota:101})});
  try{await manager.import(new File([backup],'quota.supaworld-backup'));}catch(e){quota=e.message;}finally{Object.defineProperty(navigator.storage,'estimate',{configurable:true,value:estimate});}
  const credentials=await get('credentials',id);await put('credentials',{...credentials,jwtSecret:'0'.repeat(64)});
  let fingerprint='';try{await manager.open(id);}catch(e){fingerprint=e.message;}
  await put('credentials',credentials);await manager.open(id);
  const afterFingerprint=await manager.query('SELECT body FROM public.kept');await manager.close();
  const project=await get('projects',id);const directory=await root.getDirectoryHandle(project.storeName);
    const marker=await (await (await directory.getFileHandle('ready')).getFile()).arrayBuffer();await directory.removeEntry('ready');
  let missing='';try{await manager.open(id);}catch(e){missing=e.message;}
  const writable=await (await directory.getFileHandle('ready',{create:true})).createWritable();await writable.write(marker);await writable.close();
  await manager.open(id);const afterMarker=await manager.query('SELECT body FROM public.kept');await manager.close();
  await put('projects',{...await get('projects',id),lifecycle:'deleting',operationId:crypto.randomUUID()});
  return {corrupt,quota,fingerprint,missing,afterFingerprint:afterFingerprint.rows[0][0],afterMarker:afterMarker.rows[0][0]};
 `,
  );
  expect(result.corrupt).toMatch(/checksum/);
  expect(result.quota).toMatch(/not enough browser storage/);
  expect(result.fingerprint).toMatch(/different|match|stamp|provision/i);
  expect(result.missing).toMatch(/completion marker/);
  expect(result.afterFingerprint).toBe('still-here');
  expect(result.afterMarker).toBe('still-here');
  await page.goto('/');
  await expect.poll(() => api<number>(page, 'return manager.current.projects.length')).toBe(0);
  expect(
    await page.evaluate(async () => {
      const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('supa-wasm');
      let count = 0;
      for await (const name of (root as any).keys()) if (name.startsWith('supaworld-')) count++;
      return count;
    }),
  ).toBe(0);
});

test('interrupted provisioning and a renderer crash after acknowledged writes recover the same project', async ({
  page,
  context,
}) => {
  async function crash(target: Page) {
    const cdp = await context.newCDPSession(target);
    const crashed = target.waitForEvent('crash', { timeout: 60_000 });
    void cdp.send('Page.crash').catch(() => undefined);
    await crashed;
    await target.close();
  }
  await page.goto('/');
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Project name', { exact: true }).fill('Crash recovery');
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect
    .poll(
      () =>
        api<boolean>(
          page,
          `
    const project=manager.current.projects[0];if(!project)return false;
    try{const root=await navigator.storage.getDirectory();const store=await (await root.getDirectoryHandle('supa-wasm')).getDirectoryHandle(project.storeName);await store.getDirectoryHandle('pg');try{await store.getFileHandle('ready');return false;}catch{return true;}}catch{return false;}
  `,
        ),
      { timeout: 120_000, intervals: [50, 100, 200] },
    )
    .toBe(true);
  const id = await api<string>(page, 'return manager.current.projects[0].id');
  // End the provisioning page without calling stop or flushing the store.
  // Use a single renderer crash below: repeated crash requests can be suppressed by Chromium.
  await page.close();
  let recovered = await context.newPage();
  await recovered.goto(`/#/projects/${id}/sql`);
  await expect(recovered.getByRole('textbox', { name: 'SQL query' })).toBeVisible({
    timeout: 180_000,
  });
  await api(
    recovered,
    `
    const q=await manager.query("CREATE TABLE public.durable(body text); INSERT INTO public.durable VALUES ('acknowledged');");if(q.error)throw new Error(q.error.message);
    const client=await manager.client('admin');const user=await client.auth.admin.createUser({email:'crash@example.test',password:'crash-password-123',email_confirm:true});if(user.error)throw user.error;
    const bucket=await client.storage.createBucket('durable');if(bucket.error)throw bucket.error;
    const upload=await client.storage.from('durable').upload('file.txt',new TextEncoder().encode('durable-object'));if(upload.error)throw upload.error;
  `,
  );
  await crash(recovered);
  recovered = await context.newPage();
  await recovered.goto(`/#/projects/${id}/sql`);
  await expect(recovered.getByRole('textbox', { name: 'SQL query' })).toBeVisible({
    timeout: 120_000,
  });
  const result = await api<any>(
    recovered,
    `
    const q=await manager.query('SELECT body FROM public.durable');
    const client=await manager.client('admin');const users=await client.auth.admin.listUsers();if(users.error)throw users.error;
    const file=await client.storage.from('durable').download('file.txt');if(file.error)throw file.error;
    await manager.close();return {row:q.rows[0][0],users:users.data.users.length,object:await file.data.text(),id:manager.current.projects[0].id};
  `,
  );
  expect(result).toEqual({ row: 'acknowledged', users: 1, object: 'durable-object', id });
  await recovered.close();
});
