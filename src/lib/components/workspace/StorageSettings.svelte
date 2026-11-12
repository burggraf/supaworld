<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    HardDrive,
    ShieldCheck,
    DownloadCloud,
    Check,
    CircleAlert,
    Laptop,
    WifiOff,
  } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { bytes, message } from '$lib/utils';
  import { storageStatus, type Capability } from '$lib/platform/capabilities';
  import { prepareArtifacts, offlineReady } from '$lib/runtime/artifacts';
  import { pwaState } from '$lib/platform/pwa';
  let { checks, onchange }: { checks: Capability[]; onchange: () => void } = $props();
  let storage = $state({ usage: 0, quota: 0, persistent: false });
  let ready = $state(false);
  let busy = $state(false);
  let progress = $state(0);
  let label = $state('');
  let error = $state('');
  let controller: AbortController | undefined;
  onDestroy(() => controller?.abort());
  async function refresh() {
    storage = await storageStatus();
    ready = await offlineReady();
  }
  onMount(() => {
    void refresh();
  });
  async function persist() {
    try {
      await navigator.storage.persist();
      await refresh();
      onchange();
    } catch (e) {
      error = message(e);
    }
  }
  async function offline() {
    busy = true;
    error = '';
    controller = new AbortController();
    try {
      await prepareArtifacts((done, total, stage) => {
        progress = done / total;
        label = stage;
      }, controller.signal);
      await refresh();
      onchange();
    } catch (e) {
      error = message(e);
    } finally {
      busy = false;
    }
  }
</script>

<div class="page-heading">
  <div>
    <p class="eyebrow">YOUR WORKSPACE</p>
    <h1>Make yourself at home.</h1>
    <p>Browser storage, offline access, and a few things worth knowing.</p>
  </div>
</div>
<section class="surface storage-overview">
  <div class="flex justify-between gap-4">
    <div>
      <div class="eyebrow flex items-center gap-2"><HardDrive size={14} /> BROWSER STORAGE</div>
      <h2 class="storage-total">{bytes(storage.usage)} <span>used</span></h2>
    </div>
    {@render BadgeLabel({
      label: storage.persistent ? 'Persistent storage' : 'Best-effort storage',
      ok: storage.persistent,
    })}
  </div>
  <div class="storage-meter">
    <span style:width={`${Math.min(100, (storage.usage / Math.max(storage.quota, 1)) * 100)}%`}
    ></span>
  </div>
  <p class="text-sm text-muted-foreground">
    {bytes(storage.quota)} estimated available quota across projects, runtime files, and this application.
  </p>
</section>
<section class="settings-section">
  <div class="settings-label">
    <h2>Keep it local</h2>
    <p>Understand where things live.</p>
  </div>
  <div class="surface settings-body">
    <div class="setting-row">
      <div>
        <h3 class="flex items-center gap-2"><ShieldCheck size={17} /> Protect browser storage</h3>
        <p>Ask your browser to retain this site’s data when storage is under pressure.</p>
        <p class="text-xs mt-2">
          You can still remove it by clearing site data. Backups remain the way to keep an
          independent copy.
        </p>
      </div>
      <Button variant="outline" onclick={persist} disabled={storage.persistent}
        >{storage.persistent ? 'Protected' : 'Request persistence'}</Button
      >
    </div>
    <div class="setting-tip">
      <Laptop size={17} />
      <p>
        Projects belong to <strong>{location.origin}</strong> in this browser profile. Other browsers,
        devices, and domains have their own separate projects. Private browsing may discard data when
        it ends.
      </p>
    </div>
  </div>
</section>
<section class="settings-section">
  <div class="settings-label">
    <h2>Offline access</h2>
    <p>Take your workspace with you.</p>
  </div>
  <div class="surface settings-body">
    <div class="setting-row">
      <div>
        <h3 class="flex items-center gap-2">
          <WifiOff size={17} />
          {ready ? 'Runtime ready for offline use' : 'Prepare the complete runtime'}
        </h3>
        <p>
          Download and verify PostgreSQL and every Supabase service once. Cached runtime files are
          shared by all your projects.
        </p>
      </div>
      <Button variant="outline" onclick={offline} disabled={busy || !$pwaState.available}
        >{#if ready}<Check size={14} />{:else}<DownloadCloud size={14} />{/if}{busy
          ? 'Preparing…'
          : ready
            ? 'Verify availability'
            : 'Prepare offline'}</Button
      >
    </div>
    {#if busy}<div class="p-5">
        <div class="storage-meter"><span style:width={`${progress * 100}%`}></span></div>
        <p class="text-xs text-muted-foreground mt-2">{label}</p>
        <Button variant="ghost" onclick={() => controller?.abort()}>Cancel download</Button>
      </div>{/if}
    <div class="setting-tip">
      <CircleAlert size={16} />
      <p>
        {#if !$pwaState.available}Offline support is available from the production build after its
          service worker installs. Reload the production site once if needed.{:else}An open app
          window runs your projects. Installing the app does not keep a database running after you
          close it.{/if}
      </p>
    </div>
  </div>
</section>
<section class="settings-section">
  <div class="settings-label">
    <h2>Browser compatibility</h2>
    <p>A small check under the hood.</p>
  </div>
  <div class="surface settings-body">
    {#each checks as check}<div class="capability-row">
        <span>{check.label}</span>{@render BadgeLabel({
          label: check.ok ? 'Available' : 'Unavailable',
          ok: check.ok,
        })}
      </div>{/each}
  </div>
</section>
{#if error}<div class="error-banner" role="alert">{error}</div>{/if}
{#snippet BadgeLabel({ label, ok }: { label: string; ok: boolean })}<span
    class:ok
    class="storage-badge"
    >{#if ok}<Check size={12} />{:else}<CircleAlert size={12} />{/if}{label}</span
  >{/snippet}
