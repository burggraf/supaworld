<script lang="ts">
  import { onMount } from 'svelte';
  import {
    Plus,
    Search,
    ArrowUpRight,
    ChevronRight,
    ChevronsUpDown,
    LayoutGrid,
    Database,
    TerminalSquare,
    Settings2,
    HardDrive,
    CircleCheck,
    MoreHorizontal,
    Download,
    Upload,
    Pencil,
    Trash2,
    Moon,
    Sun,
    LoaderCircle,
    ArrowLeft,
    Square,
    Globe2,
    ShieldCheck,
    X,
    WifiOff,
    RefreshCw,
  } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Badge } from '$lib/components/ui/badge';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import { manager } from '$lib/projects/manager';
  import { validateName, type Project } from '$lib/projects/model';
  import { checkCapabilities, storageStatus, type Capability } from '$lib/platform/capabilities';
  import { registerPwa, pwaState, activateUpdate } from '$lib/platform/pwa';
  import { bytes, message } from '$lib/utils';
  import Overview from '$lib/components/workspace/Overview.svelte';
  import SqlWorkspace from '$lib/components/workspace/SqlWorkspace.svelte';
  import DatabaseView from '$lib/components/workspace/Database.svelte';
  import ProjectSettings from '$lib/components/workspace/ProjectSettings.svelte';
  import StorageSettings from '$lib/components/workspace/StorageSettings.svelte';
  const workspace = manager.state;
  function parseRoute() {
    const match = location.hash.match(
      /^#\/projects\/([0-9a-f-]+)\/(overview|database|sql|settings)$/,
    );
    return {
      id: match?.[1] ?? null,
      view: match?.[2] ?? (location.hash === '#/storage' ? 'storage' : 'projects'),
    };
  }
  let route = $state(parseRoute());
  let initialized = $state(false);
  let checks = $state<Capability[]>([]);
  let search = $state('');
  let sort = $state('recent');
  let localError = $state('');
  let notice = $state('');
  let dark = $state(document.documentElement.classList.contains('dark'));
  let storage = $state({ usage: 0, quota: 0, persistent: false });
  let dialogOpen = $state(false);
  let dialogKind = $state<'create' | 'rename' | 'delete' | 'switch'>('create');
  let dialogProject = $state<Project | null>(null);
  let name = $state('');
  let confirmation = $state('');
  let dialogError = $state('');
  let switchSearch = $state('');
  let fileInput: HTMLInputElement;
  const canRun = $derived(checks.length > 0 && checks.every((c) => c.ok));
  const active = $derived($workspace.projects.find((p) => p.id === $workspace.activeId));
  const selected = $derived($workspace.projects.find((p) => p.id === route.id));
  const filtered = $derived(
    [...$workspace.projects]
      .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()) || p.id.includes(search))
      .sort((a, b) =>
        sort === 'name'
          ? a.name.localeCompare(b.name)
          : sort === 'newest'
            ? b.createdAt.localeCompare(a.createdAt)
            : (b.lastOpenedAt ?? b.createdAt).localeCompare(a.lastOpenedAt ?? a.createdAt),
      ),
  );
  const switchProjects = $derived(
    $workspace.projects.filter((p) => p.name.toLowerCase().includes(switchSearch.toLowerCase())),
  );
  const error = $derived($workspace.error || localError);
  const navigation = [
    { view: 'overview', name: 'Overview', icon: Globe2 },
    { view: 'database', name: 'Database', icon: Database },
    { view: 'sql', name: 'SQL editor', icon: TerminalSquare },
    { view: 'settings', name: 'Project settings', icon: Settings2 },
  ];
  onMount(() => {
    void (async () => {
      try {
        checks = await checkCapabilities();
        await manager.init();
        await updateStorage();
        initialized = true;
        if (
          route.id &&
          route.view !== 'settings' &&
          canRun &&
          $workspace.projects.some((p) => p.id === route.id)
        )
          await manager.open(route.id);
      } catch (e) {
        localError = message(e);
        initialized = true;
      }
    })();
    void registerPwa();
    const timer = setInterval(() => {
      if (!document.hidden) void manager.refresh().catch(() => undefined);
    }, 5000);
    return () => clearInterval(timer);
  });
  async function updateStorage() {
    try {
      storage = await storageStatus();
    } catch {
      /* unavailable */
    }
  }
  function navigate(view: string, id = route.id) {
    location.hash =
      id && view !== 'projects' && view !== 'storage'
        ? `/projects/${id}/${view}`
        : view === 'storage'
          ? '/storage'
          : '/projects';
    route = parseRoute();
  }
  async function routeChanged() {
    route = parseRoute();
    if (
      initialized &&
      route.id &&
      route.view !== 'settings' &&
      route.id !== $workspace.activeId &&
      !$workspace.busy &&
      canRun
    ) {
      try {
        await manager.open(route.id);
      } catch {
        /* shown by manager */
      }
    }
  }
  function showDialog(kind: typeof dialogKind, project: Project | null = null) {
    dialogKind = kind;
    dialogProject = project;
    name = kind === 'rename' ? (project?.name ?? '') : '';
    confirmation = '';
    dialogError = '';
    switchSearch = '';
    dialogOpen = true;
  }
  async function openProject(id: string) {
    try {
      await manager.open(id);
      navigate('overview', id);
      await updateStorage();
    } catch {
      /* manager shows error */
    }
  }
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    dialogError = '';
    try {
      if (dialogKind === 'create' || dialogKind === 'rename') validateName(name);
    } catch (e) {
      dialogError = message(e);
      return;
    }
    if (dialogKind === 'delete' && confirmation !== dialogProject?.name) return;
    dialogOpen = false;
    try {
      if (dialogKind === 'create') {
        const id = await manager.create(name);
        navigate('overview', id);
        toast('Your new world is ready.');
      } else if (dialogKind === 'rename' && dialogProject) {
        await manager.rename(dialogProject.id, name);
        toast('Project renamed.');
      } else if (dialogKind === 'delete' && dialogProject) {
        const id = dialogProject.id;
        await manager.delete(id);
        if (route.id === id) navigate('projects');
        toast('Project deleted from this browser.');
      }
      await updateStorage();
    } catch {
      /* manager shows error */
    }
  }
  function toast(text: string) {
    notice = text;
    setTimeout(() => (notice = ''), 5000);
  }
  async function exportProject(project: Project) {
    localError = '';
    let stream: FileSystemWritableFileStream | undefined;
    try {
      const picker = (
        window as Window & {
          showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle>;
        }
      ).showSaveFilePicker;
      if (picker) {
        const handle = await picker({
          suggestedName: `${project.name.replace(/[^a-zA-Z0-9._-]/g, '-')}.supaworld-backup`,
          types: [
            {
              description: 'Supaworld backup',
              accept: { 'application/octet-stream': ['.supaworld-backup'] },
            },
          ],
        });
        stream = await handle.createWritable();
      }
      const blob = await manager.export(
        project.id,
        stream as unknown as WritableStream<Uint8Array> | undefined,
      );
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${project.name.replace(/[^a-zA-Z0-9._-]/g, '-')}.supaworld-backup`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
      toast('Backup exported. Your project is safely closed.');
      await updateStorage();
    } catch (e) {
      await stream?.abort().catch(() => undefined);
      if ((e as DOMException).name !== 'AbortError') localError = message(e);
    }
  }
  async function importBackup(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const id = await manager.import(file);
      await openProject(id);
      toast('Backup restored as a separate project.');
      await updateStorage();
    } catch (e) {
      localError = message(e);
    }
  }
  function toggleTheme() {
    dark = !dark;
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('supaworld:theme', dark ? 'dark' : 'light');
    } catch {
      /* preference unavailable */
    }
  }
  function shortcuts(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (!$workspace.busy) showDialog('switch');
    }
  }
  async function applyUpdate() {
    try {
      await manager.close();
      await activateUpdate();
    } catch (e) {
      localError = message(e);
    }
  }
  function when(iso: string | null) {
    if (!iso) return 'Not opened yet';
    const date = new Date(iso);
    const days = Math.floor((Date.now() - date.getTime()) / 86400000);
    return days === 0
      ? 'Opened today'
      : days === 1
        ? 'Opened yesterday'
        : `Opened ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  }
</script>

<svelte:window
  onhashchange={routeChanged}
  onkeydown={shortcuts}
  onfocus={() => {
    void manager.refresh().catch(() => undefined);
  }}
/>
<input
  class="sr-only"
  bind:this={fileInput!}
  type="file"
  accept=".supaworld-backup"
  aria-label="Import project backup"
  onchange={importBackup}
/>
<div class="app-shell">
  <aside class="app-sidebar">
    <a class="brand" href="#/projects" aria-label="Supaworld home"
      ><img src="/icon.svg" alt="" /><span>supaworld<span class="brand-period">.</span></span></a
    >
    <div class="workspace-label">
      <span class="workspace-avatar">Y</span>
      <div><strong>Your workspace</strong><span>Personal & local</span></div>
      <span class="local-tiny-dot"></span>
    </div>
    <div class="sidebar-divider"></div>
    <p class="sidebar-caption">WORKSPACE</p>
    <nav class="workspace-nav" aria-label="Workspace">
      <button
        aria-label="All projects"
        class:nav-active={route.view === 'projects'}
        disabled={$workspace.busy}
        onclick={() => navigate('projects')}
        ><LayoutGrid size={17} /><span>All projects</span><span class="nav-count"
          >{$workspace.projects.length}</span
        ></button
      ><button
        class:nav-active={route.view === 'storage'}
        disabled={$workspace.busy}
        onclick={() => navigate('storage')}
        ><HardDrive size={17} /><span>Storage & offline</span></button
      >
    </nav>
    {#if selected || active}{@const project = selected ?? active!}
      <div class="sidebar-project">
        <p class="sidebar-caption">{selected ? 'PROJECT' : 'RUNNING PROJECT'}</p>
        <button
          class="project-switcher"
          onclick={() => showDialog('switch')}
          disabled={$workspace.busy}
          ><span class="project-mini-icon"><Database size={15} /></span><span>{project.name}</span
          ><ChevronsUpDown size={14} /></button
        >
        <nav aria-label="Project">
          {#each navigation as item}<button
              class:nav-active={route.id === project.id && route.view === item.view}
              onclick={() => navigate(item.view, project.id)}
              disabled={$workspace.busy}><item.icon size={16} /><span>{item.name}</span></button
            >{/each}
        </nav>
      </div>{/if}
    <div class="sidebar-bottom">
      <div class="sidebar-tip">
        <div class="flex items-center gap-2">
          <ShieldCheck size={15} /><strong>Your data stays with you.</strong>
        </div>
        <p>Projects live in this browser. A backup keeps another door open.</p>
        <button onclick={() => navigate('storage')}
          >About local storage <ArrowUpRight size={12} /></button
        >
      </div>
      <div class="sidebar-storage">
        <div><span>Browser storage</span><span>{bytes(storage.usage)}</span></div>
        <div class="storage-meter">
          <span
            style:width={`${Math.max(2, Math.min(100, (storage.usage / Math.max(storage.quota, 1)) * 100))}%`}
          ></span>
        </div>
      </div>
      <div class="sidebar-footer">
        <span class="flex items-center gap-2"><span class="status-dot"></span> LOCAL FIRST</span
        ><button
          onclick={toggleTheme}
          aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
          >{#if dark}<Sun size={16} />{:else}<Moon size={16} />{/if}</button
        >
      </div>
    </div>
  </aside>
  <div class="app-main">
    <header class="topbar">
      <div class="breadcrumbs">
        <button class="mobile-home" aria-label="All projects" onclick={() => navigate('projects')}
          ><LayoutGrid size={16} /></button
        ><span>Your workspace</span><ChevronRight size={13} /><span
          >{route.view === 'storage'
            ? 'Storage & offline'
            : selected
              ? selected.name
              : 'All projects'}</span
        >{#if selected}<ChevronRight size={13} /><span class="breadcrumb-current"
            >{navigation.find((n) => n.view === route.view)?.name}</span
          >{/if}
      </div>
      <div class="topbar-actions">
        <button
          class="mobile-settings"
          aria-label="Storage and offline"
          onclick={() => navigate('storage')}><HardDrive size={16} /></button
        >{#if active}<span class="active-indicator"
            ><span class="status-dot"></span>{active.name}</span
          ><Button
            variant="ghost"
            size="sm"
            disabled={$workspace.busy}
            onclick={() => {
              void manager
                .close()
                .then(updateStorage)
                .catch(() => undefined);
            }}><Square size={11} /> Stop</Button
          >{:else}<span class="local-label"><CircleCheck size={14} /> Saved in your browser</span
          >{/if}<button class="mobile-theme" onclick={toggleTheme} aria-label="Toggle color theme"
          >{#if dark}<Sun size={16} />{:else}<Moon size={16} />{/if}</button
        >
      </div>
    </header>
    {#if selected}<nav class="mobile-project-nav" aria-label="Mobile project navigation">
        {#each navigation as item}<button
            class:active={route.view === item.view}
            disabled={$workspace.busy}
            onclick={() => navigate(item.view, selected.id)}
            ><item.icon size={14} />{item.name}</button
          >{/each}
      </nav>{/if}
    <main class="main-content" id="main">
      {#if $pwaState.update}<div class="update-banner">
          <div>
            <strong>A new version is ready.</strong><span
              >Save your work and close projects in other tabs before updating.</span
            >
          </div>
          <Button variant="outline" onclick={applyUpdate} disabled={$workspace.busy}
            ><RefreshCw size={14} /> Update app</Button
          >
        </div>{/if}
      {#if error}<div class="error-banner global-error" role="alert">
          <div>
            <strong>Something needs your attention</strong>
            <p>{error}</p>
            {#if /reload/i.test(error)}<Button
                variant="outline"
                size="sm"
                onclick={() => location.reload()}>Reload to recover</Button
              >{/if}
          </div>
          <button
            aria-label="Dismiss error"
            onclick={() => {
              manager.clearError();
              localError = '';
            }}><X size={17} /></button
          >
        </div>{/if}
      {#if $workspace.busy}<section class="progress-panel" role="status" aria-live="polite">
          <LoaderCircle size={22} class="animate-spin" />
          <div>
            <strong>{$workspace.stage || 'Taking care of your project…'}</strong>
            <p>The first project prepares the full runtime. Later projects reuse it.</p>
            {#if $workspace.progress}<div class="progress-track">
                <span
                  style:width={`${($workspace.progress.done / $workspace.progress.total) * 100}%`}
                ></span>
              </div>
              <span class="mono text-xs"
                >{bytes($workspace.progress.done)} / {bytes($workspace.progress.total)} prepared</span
              >{/if}
          </div>
          {#if $workspace.elapsed > 1000}<span class="progress-time"
              >{Math.floor($workspace.elapsed / 1000)}s</span
            >{/if}
          {#if $workspace.canCancel}<Button
              variant="outline"
              size="sm"
              onclick={() => manager.cancelOpening()}>Cancel opening</Button
            >{/if}
        </section>{/if}
      {#if !initialized}<div class="initializing">
          <LoaderCircle class="animate-spin" size={22} />
          <p>Opening your workspace…</p>
        </div>
      {:else if route.view === 'storage'}<StorageSettings {checks} onchange={updateStorage} />
      {:else if selected && route.view === 'settings'}{#key selected.id}<ProjectSettings
            project={selected}
            onrename={() => showDialog('rename', selected)}
            ondelete={() => showDialog('delete', selected)}
            onexport={() => exportProject(selected)}
          />{/key}
      {:else if selected && selected.id === $workspace.activeId}{#key selected.id}{#if route.view === 'sql'}<SqlWorkspace
              project={selected}
            />{:else if route.view === 'database'}<DatabaseView />{:else}<Overview
              project={selected}
              navigate={(view) => navigate(view, selected.id)}
            />{/if}{/key}
      {:else if selected}<div class="closed-project">
          <div class="placeholder-icon"><Database size={28} /></div>
          <p class="eyebrow">SAVED IN THIS BROWSER</p>
          <h1>{selected.name}</h1>
          <p>This project is closed. Open it to continue working with your data.</p>
          <div class="flex justify-center gap-3 mt-6">
            <Button onclick={() => openProject(selected.id)} disabled={$workspace.busy || !canRun}
              >Open project <ArrowUpRight size={15} /></Button
            ><Button variant="outline" onclick={() => navigate('settings', selected.id)}
              >Project settings</Button
            >
          </div>
        </div>
      {:else}
        <div class="catalog-heading">
          <div>
            <p class="eyebrow"><span class="little-spark">✳</span> A SPACE TO BUILD</p>
            <h1>Your local universe<span class="heading-dot">.</span></h1>
            <p>Big ideas start small. Give your next one a home.</p>
          </div>
          <Button
            class="create-button"
            onclick={() => showDialog('create')}
            disabled={$workspace.busy || !canRun}><Plus size={16} /> New project</Button
          >
        </div>
        {#if !canRun}<div class="compatibility-banner">
            <CircleCheck size={19} />
            <div>
              <strong>A recent desktop Chrome or Edge is needed to run projects.</strong>
              <p>
                {checks
                  .filter((c) => !c.ok)
                  .map((c) => c.label)
                  .join(', ')}
                {checks.some((c) => c.label === 'Cross-origin isolation' && !c.ok)
                  ? '— check that the site is serving isolation headers.'
                  : ''}
              </p>
              <button class="text-link" onclick={() => navigate('storage')}
                >View compatibility checks <ArrowUpRight size={12} /></button
              >
            </div>
          </div>{/if}
        <div class="catalog-toolbar">
          <div class="project-heading">
            <h2>Projects</h2>
            <span>{$workspace.projects.length}</span>
          </div>
          <div class="catalog-controls">
            <div class="search-field">
              <Search size={15} /><Input
                bind:value={search}
                aria-label="Search projects"
                placeholder="Search projects…"
              />
            </div>
            <label class="sr-only" for="project-sort">Sort projects</label><select
              id="project-sort"
              bind:value={sort}
              ><option value="recent">Last opened</option><option value="newest"
                >Newest first</option
              ><option value="name">Name A–Z</option></select
            ><Button variant="outline" onclick={() => fileInput.click()} disabled={$workspace.busy}
              ><Upload size={14} /> Import backup</Button
            >
          </div>
        </div>
        {#if !$workspace.projects.length}
          <section class="empty-world">
            <div class="orbital-art" aria-hidden="true">
              <div class="orbit orbit-one"></div>
              <div class="orbit orbit-two"></div>
              <div class="world-sphere"><span></span></div>
              <div class="orbit-moon"></div>
              <div class="orbit-spark spark-one">+</div>
              <div class="orbit-spark spark-two">+</div>
              <div class="orbit-dot"></div>
            </div>
            <p class="eyebrow">IT STARTS WITH ONE PROJECT</p>
            <h2>A little space for your<br />next big idea.</h2>
            <p>
              PostgreSQL, Auth, Storage, and Realtime.<br />A full Supabase project, at home in your
              browser.
            </p>
            <Button onclick={() => showDialog('create')} disabled={$workspace.busy || !canRun}
              ><Plus size={15} /> Create your first project</Button
            >
            <div class="empty-benefits">
              <span>{@render CheckIcon()}No account needed</span><span
                >{@render CheckIcon()}Your data stays local</span
              ><span>{@render CheckIcon()}Ready when you are</span>
            </div>
          </section>
        {:else if !filtered.length}<div class="search-empty">
            <Search size={27} />
            <h3>No projects found.</h3>
            <p>Try another name or project ID.</p>
            <Button variant="ghost" onclick={() => (search = '')}>Clear search</Button>
          </div>
        {:else}<div class="project-grid">
            {#each filtered as project}{@const isActive = $workspace.activeId === project.id}
              <article class:project-active={isActive} class="project-card">
                <div class="project-card-top">
                  <span
                    class="project-card-icon"
                    class:tone-two={parseInt(project.id[0]!, 16) % 3 === 1}
                    class:tone-three={parseInt(project.id[0]!, 16) % 3 === 2}
                    ><Database size={22} /></span
                  >
                  <div class="flex items-center gap-2">
                    {#if isActive}<Badge class="running-badge"
                        ><span class="status-dot"></span> Active</Badge
                      >{:else if $workspace.peers[project.id]}<Badge variant="secondary"
                        >Open elsewhere</Badge
                      >{:else if project.lifecycle === 'error'}<Badge variant="destructive"
                        >Needs attention</Badge
                      >{:else if project.lifecycle !== 'ready'}<Badge variant="secondary"
                        >{project.lifecycle}</Badge
                      >{/if}<DropdownMenu.Root
                      ><DropdownMenu.Trigger
                        >{#snippet child({ props })}<Button
                            {...props}
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Actions for ${project.name}`}
                            disabled={$workspace.busy}><MoreHorizontal size={18} /></Button
                          >{/snippet}</DropdownMenu.Trigger
                      ><DropdownMenu.Content align="end"
                        ><DropdownMenu.Item onclick={() => openProject(project.id)}
                          >Open project</DropdownMenu.Item
                        ><DropdownMenu.Item onclick={() => showDialog('rename', project)}
                          ><Pencil size={14} /> Rename</DropdownMenu.Item
                        ><DropdownMenu.Item onclick={() => navigate('settings', project.id)}
                          ><Settings2 size={14} /> Settings</DropdownMenu.Item
                        ><DropdownMenu.Item onclick={() => exportProject(project)}
                          ><Download size={14} /> Export backup</DropdownMenu.Item
                        ><DropdownMenu.Separator /><DropdownMenu.Item
                          class="text-destructive"
                          onclick={() => showDialog('delete', project)}
                          ><Trash2 size={14} /> Delete project</DropdownMenu.Item
                        ></DropdownMenu.Content
                      ></DropdownMenu.Root
                    >
                  </div>
                </div>
                <button
                  class="project-card-main"
                  onclick={() => openProject(project.id)}
                  disabled={$workspace.busy ||
                    !canRun ||
                    project.lifecycle === 'deleting' ||
                    project.lifecycle === 'importing'}
                  aria-label={`Open ${project.name}`}
                  ><h3>{project.name}<ArrowUpRight size={17} /></h3>
                  <span class="mono project-card-id">{project.id.slice(0, 8)}</span>
                  <div class="project-card-services">
                    <span>PostgreSQL</span><span>Auth</span><span>+2 services</span>
                  </div></button
                >
                <div class="project-card-footer">
                  <span><span class="status-dot"></span> Browser local</span><span
                    >{when(project.lastOpenedAt)}</span
                  >
                </div>
              </article>{/each}<button
              class="new-project-card"
              onclick={() => showDialog('create')}
              disabled={$workspace.busy || !canRun}
              ><span><Plus size={22} /></span><strong>Make room for an idea.</strong><small
                >Create a new project <ArrowUpRight size={13} /></small
              ></button
            >
          </div>{/if}
        {#if $workspace.orphans.length}<div class="compatibility-banner">
            <HardDrive size={18} />
            <div>
              <strong>Unlisted project files were found.</strong>
              <p>
                {$workspace.orphans.length} saved store(s) have no catalog entry. They have been kept
                intact. Restore a backup to recover a usable project; do not clear site storage.
              </p>
            </div>
          </div>{/if}
        <div class="catalog-footnote">
          <span><ShieldCheck size={14} /> Your workspace is private to this browser.</span><button
            onclick={() => navigate('storage')}
            >How local storage works <ArrowUpRight size={12} /></button
          >
        </div>
      {/if}
    </main>
    <footer class="app-footer">
      <span>Made for little experiments and big possibilities.</span><span
        >SUPAWORLD <span class="muted">/</span> LOCAL FIRST</span
      >
    </footer>
  </div>
</div>
{#if notice}<div class="notice-toast" role="status">
    <CircleCheck size={17} /><span>{notice}</span><button
      onclick={() => (notice = '')}
      aria-label="Dismiss notification"><X size={14} /></button
    >
  </div>{/if}
<Dialog.Root bind:open={dialogOpen}
  ><Dialog.Content class={dialogKind === 'switch' ? 'max-w-lg' : 'max-w-md'}
    ><Dialog.Header
      ><Dialog.Title
        >{dialogKind === 'create'
          ? 'A new world of possibilities.'
          : dialogKind === 'rename'
            ? 'Give it a new name.'
            : dialogKind === 'delete'
              ? 'Delete this project?'
              : 'Find your project.'}</Dialog.Title
      ><Dialog.Description
        >{dialogKind === 'create'
          ? 'Create a Supabase project that lives entirely in this browser.'
          : dialogKind === 'rename'
            ? 'A new name, with all your data right where you left it.'
            : dialogKind === 'delete'
              ? `This permanently removes ${dialogProject?.name} and all of its local data.`
              : 'Switch to another project in your workspace.'}</Dialog.Description
      ></Dialog.Header
    >
    {#if dialogKind === 'switch'}<Input
        bind:value={switchSearch}
        aria-label="Find a project"
        placeholder="Search your projects…"
      />
      <div class="switch-list">
        {#each switchProjects as project}<button
            onclick={() => {
              dialogOpen = false;
              void openProject(project.id);
            }}
            disabled={$workspace.busy || !canRun}
            ><Database size={17} /><span>{project.name}<small>{project.id.slice(0, 8)}</small></span
            >{#if project.id === $workspace.activeId}<Badge>Active</Badge>{:else}<ArrowUpRight
                size={15}
              />{/if}</button
          >{/each}{#if !switchProjects.length}<p class="p-4 text-muted-foreground text-sm">
            No matching projects.
          </p>{/if}
      </div>
      <Button variant="outline" onclick={() => showDialog('create')} disabled={!canRun}
        ><Plus size={14} /> Create a new project</Button
      >
    {:else}<form onsubmit={submit}>
        <div class="dialog-form">
          {#if dialogKind === 'delete'}<div class="delete-summary">
              <Database size={20} />
              <div>
                <strong>{dialogProject?.name}</strong><span class="mono"
                  >{dialogProject?.id.slice(0, 8)}</span
                >
              </div>
            </div>
            <p class="text-sm text-muted-foreground">
              This includes the database, Auth users, Storage objects, and credentials. Export a
              backup first if you want to keep a copy.
            </p>
            <label for="delete-confirm"
              >Type <strong>{dialogProject?.name}</strong> to confirm</label
            ><Input
              id="delete-confirm"
              bind:value={confirmation}
              autocomplete="off"
              placeholder="Project name"
            />{:else}<label for="project-name">Project name</label><Input
              id="project-name"
              bind:value={name}
              maxlength={80}
              autocomplete="off"
              placeholder="My next big idea"
            />{#if dialogKind === 'create'}<div class="create-info">
                <ShieldCheck size={17} />
                <p>
                  Private to this browser. No account, server, or setup required. The runtime
                  downloads once and is shared by your projects.
                </p>
              </div>{/if}{/if}{#if dialogError}<p class="text-destructive text-sm" role="alert">
              {dialogError}
            </p>{/if}
        </div>
        <Dialog.Footer
          ><Button variant="outline" type="button" onclick={() => (dialogOpen = false)}
            >Cancel</Button
          ><Button
            type="submit"
            variant={dialogKind === 'delete' ? 'destructive' : 'default'}
            disabled={dialogKind === 'delete' ? confirmation !== dialogProject?.name : !name.trim()}
            >{#if dialogKind === 'create'}<Plus size={14} /> Create project{:else if dialogKind === 'rename'}Save
              name{:else}<Trash2 size={14} /> Delete permanently{/if}</Button
          ></Dialog.Footer
        >
      </form>{/if}
  </Dialog.Content></Dialog.Root
>
{#snippet CheckIcon()}<CircleCheck size={13} />{/snippet}
