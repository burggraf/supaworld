<script lang="ts">
  import {
    Database,
    Radio,
    HardDrive,
    ShieldCheck,
    ArrowUpRight,
    Check,
    Copy,
    Activity,
    Code2,
    CircleCheck,
    CircleAlert,
    LoaderCircle,
    Eye,
    EyeOff,
  } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { manager } from '$lib/projects/manager';
  import type { Project } from '$lib/projects/model';
  import { RUNTIME_BUILD } from '$lib/runtime/config';
  import { message } from '$lib/utils';
  let { project, navigate }: { project: Project; navigate: (view: string) => void } = $props();
  const workspace = manager.state;
  let checking = $state(false);
  let checks = $state<Array<{ name: string; ok: boolean; detail: string }>>([]);
  let error = $state('');
  let copied = $state('');
  let reveal = $state(false);
  const services = [
    { key: 'database', name: 'PostgreSQL', detail: 'Your database', icon: Database },
    { key: 'postgrest', name: 'REST API', detail: 'PostgREST', icon: Code2 },
    { key: 'auth', name: 'Authentication', detail: 'Local users & sessions', icon: ShieldCheck },
    { key: 'storage', name: 'Storage', detail: 'Files & buckets', icon: HardDrive },
    { key: 'realtime', name: 'Realtime', detail: 'Live subscriptions', icon: Radio },
  ];
  const snippet = $derived(
    `// Inside this project’s browser session\nconst client = createClient(stack.url, stack.anonKey, {\n  global: { fetch: stack.fetch },\n  realtime: { transport: stack.WebSocket },\n});`,
  );
  async function copy(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      copied = key;
      setTimeout(() => (copied = ''), 2000);
    } catch {
      error = 'Clipboard access is unavailable. Select and copy the value instead.';
    }
  }
  async function check() {
    checking = true;
    error = '';
    try {
      checks = await manager.diagnostics();
    } catch (e) {
      error = message(e);
    } finally {
      checking = false;
    }
  }
</script>

<div class="page-heading">
  <div>
    <p class="eyebrow">PROJECT OVERVIEW</p>
    <h1>{project.name}<span class="heading-dot">.</span></h1>
    <p>Your Supabase stack, right here in this browser.</p>
  </div>
  <Badge class="running-badge"
    ><span class="status-dot"></span>{$workspace.kernel === 'slept'
      ? 'Ready · sleeping'
      : 'Project ready'}</Badge
  >
</div>
<div class="overview-stats">
  <div>
    <span class="eyebrow">PROJECT ID</span>
    <div class="mono flex items-center gap-2">
      {project.id.slice(0, 8)}<Button
        variant="ghost"
        size="icon-xs"
        aria-label="Copy project ID"
        onclick={() => copy(project.id, 'id')}
        >{#if copied === 'id'}<Check size={13} />{:else}<Copy size={13} />{/if}</Button
      >
    </div>
  </div>
  <div>
    <span class="eyebrow">ENGINE</span>
    <div>PostgreSQL 17 <span class="muted">/ WASM</span></div>
  </div>
  <div>
    <span class="eyebrow">DATA LOCATION</span>
    <div class="flex items-center gap-2"><span class="status-dot"></span> This browser</div>
  </div>
</div>
<div class="overview-grid">
  <section class="surface">
    <div class="section-heading">
      <div>
        <h2>A full stack. A small world.</h2>
        <p>Services wake when you need them and rest when you don’t.</p>
      </div>
      <Activity size={18} class="text-muted-foreground" />
    </div>
    <div class="service-list">
      {#each services as service}{@const gate = $workspace.gates[service.key]}
        <div class="service-row">
          <div class="service-icon"><service.icon size={18} /></div>
          <div class="flex-1">
            <strong>{service.name}</strong>
            <p>{service.detail}</p>
          </div>
          <span class:service-running={gate?.phase === 'running'} class="service-status"
            ><span class="status-dot"></span>{gate?.phase === 'running'
              ? 'Running'
              : gate?.phase === 'starting'
                ? 'Starting'
                : gate?.phase === 'stopping'
                  ? 'Stopping'
                  : 'Sleeping'}</span
          >
        </div>{/each}
    </div>
    <div class="panel-bottom">
      <span class="mono text-xs text-muted-foreground">runtime {RUNTIME_BUILD}</span><Button
        variant="outline"
        size="sm"
        onclick={check}
        disabled={checking}
        >{#if checking}<LoaderCircle size={13} class="animate-spin" />{:else}<Activity
            size={13}
          />{/if}{checking ? 'Checking services…' : 'Check services'}</Button
      >
    </div>
  </section>
  <div class="overview-right">
    <section class="quickstart-card">
      <div class="quickstart-symbol"><Code2 size={27} /></div>
      <p class="eyebrow">MAKE YOUR FIRST MOVE</p>
      <h2>Start with a little SQL.</h2>
      <p>Create a table, write your first row, and watch an idea take shape.</p>
      <Button onclick={() => navigate('sql')}>Open SQL editor <ArrowUpRight size={15} /></Button>
    </section>
    <section class="surface local-note">
      <div class="local-note-icon"><ShieldCheck size={20} /></div>
      <h3>Yours, and only here.</h3>
      <p>
        Your database, users, and files stay in this browser profile. Export a backup to take them
        with you.
      </p>
      <button class="text-link" onclick={() => navigate('settings')}
        >Manage project & backups <ArrowUpRight size={13} /></button
      >
    </section>
  </div>
</div>
{#if checks.length}<section class="surface diagnostic-panel">
    <h3>Service check</h3>
    {#each checks as check}<div class="diagnostic-row">
        {#if check.ok}<CircleCheck size={16} class="text-primary" />{:else}<CircleAlert
            size={16}
            class="text-destructive"
          />{/if}<strong>{check.name}</strong><span>{check.detail}</span>
      </div>{/each}
  </section>{/if}
{#if error}<div class="error-banner" role="alert">{error}</div>{/if}
<section class="surface connect-panel">
  <div class="section-heading">
    <div>
      <h2>Connect in the browser</h2>
      <p>The virtual URL works through this project’s browser adapter.</p>
    </div>
  </div>
  <div class="connection-values">
    <div>
      <span class="eyebrow">VIRTUAL PROJECT URL</span>
      <div class="secret-value">
        <code>{manager.activeStack?.url}</code><Button
          variant="ghost"
          size="icon-sm"
          aria-label="Copy virtual URL"
          onclick={() => copy(manager.activeStack?.url ?? '', 'url')}
          >{#if copied === 'url'}<Check size={14} />{:else}<Copy size={14} />{/if}</Button
        >
      </div>
    </div>
    <div>
      <span class="eyebrow">ANON API KEY</span>
      <div class="secret-value">
        <code>{reveal ? manager.activeStack?.anonKey : '••••••••••••••••••••••••••••••••'}</code
        ><Button
          variant="ghost"
          size="icon-sm"
          aria-label={reveal ? 'Hide anon key' : 'Reveal anon key'}
          onclick={() => (reveal = !reveal)}
          >{#if reveal}<EyeOff size={14} />{:else}<Eye size={14} />{/if}</Button
        ><Button
          variant="ghost"
          size="icon-sm"
          aria-label="Copy anon key"
          onclick={() => copy(manager.activeStack?.anonKey ?? '', 'key')}
          >{#if copied === 'key'}<Check size={14} />{:else}<Copy size={14} />{/if}</Button
        >
      </div>
    </div>
  </div>
  <div class="code-example">
    <pre><code>{snippet}</code></pre>
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Copy client example"
      onclick={() => copy(snippet, 'snippet')}
      >{#if copied === 'snippet'}<Check size={14} />{:else}<Copy size={14} />{/if}</Button
    >
  </div>
  <p class="footnote">
    This URL belongs to the running browser session. External apps and command-line tools cannot
    connect to it directly. Local Auth sign-ups are automatically confirmed; email delivery is not
    configured.
  </p>
</section>
