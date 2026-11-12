<script lang="ts">
  import { onMount } from 'svelte';
  import {
    Download,
    Pencil,
    Trash2,
    HardDrive,
    ShieldCheck,
    Copy,
    Check,
    Eye,
    EyeOff,
  } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import type { Project } from '$lib/projects/model';
  import { getCredentials } from '$lib/projects/repository';
  import { manager } from '$lib/projects/manager';
  import { bytes, message } from '$lib/utils';
  let {
    project,
    onrename,
    ondelete,
    onexport,
  }: { project: Project; onrename: () => void; ondelete: () => void; onexport: () => void } =
    $props();
  const workspace = manager.state;
  let size = $state<number | null>(null);
  let error = $state('');
  let secret = $state('');
  let copied = $state(false);
  async function measure() {
    try {
      size = await manager.projectSize(project.id);
    } catch (e) {
      error = message(e);
    }
  }
  async function reveal() {
    if (secret) {
      secret = '';
      return;
    }
    try {
      secret = (await getCredentials(project.provisioning.credentialRef)).postgresPassword;
    } catch (e) {
      error = message(e);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(secret);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      error = 'Clipboard access is unavailable.';
    }
  }
  onMount(() => {
    if ($workspace.activeId !== project.id) void measure();
  });
</script>

<div class="page-heading">
  <div>
    <p class="eyebrow">PROJECT SETTINGS</p>
    <h1>A place for the details.</h1>
    <p>Manage {project.name}, keep a copy, or make room for something new.</p>
  </div>
</div>
<section class="settings-section">
  <div class="settings-label">
    <h2>General</h2>
    <p>The identity of your project.</p>
  </div>
  <div class="surface settings-body">
    <div class="setting-row">
      <div>
        <span class="eyebrow">PROJECT NAME</span>
        <h3>{project.name}</h3>
      </div>
      <Button variant="outline" onclick={onrename} disabled={$workspace.busy}
        ><Pencil size={13} /> Rename</Button
      >
    </div>
    <div class="setting-row">
      <div>
        <span class="eyebrow">PROJECT ID</span>
        <p class="mono text-sm break-all">{project.id}</p>
      </div>
    </div>
    <div class="setting-row">
      <div>
        <span class="eyebrow">CREATED</span>
        <p>{new Date(project.createdAt).toLocaleString()}</p>
      </div>
      <div>
        <span class="eyebrow">RUNTIME BUILD</span>
        <p class="mono text-sm">{project.runtimeBuildId}</p>
      </div>
    </div>
    <div class="setting-row">
      <div>
        <span class="eyebrow">LOCAL DATABASE PASSWORD</span>
        <p class="text-xs text-muted-foreground mb-2">Used by the browser’s PostgreSQL adapter.</p>
        <code class="text-xs break-all">{secret || '••••••••••••••••••••••••'}</code>
      </div>
      <div class="flex gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={secret ? 'Hide database password' : 'Reveal database password'}
          onclick={reveal}
          >{#if secret}<EyeOff size={15} />{:else}<Eye size={15} />{/if}</Button
        >{#if secret}<Button
            variant="ghost"
            size="icon-sm"
            aria-label="Copy database password"
            onclick={copy}
            >{#if copied}<Check size={15} />{:else}<Copy size={15} />{/if}</Button
          >{/if}
      </div>
    </div>
  </div>
</section>
<section class="settings-section">
  <div class="settings-label">
    <h2>Backups & storage</h2>
    <p>A little peace of mind.</p>
  </div>
  <div class="surface settings-body">
    <div class="setting-row">
      <div>
        <h3 class="flex items-center gap-2"><Download size={17} /> Export project</h3>
        <p>A complete copy of your database, local users, files, and credentials.</p>
        <p class="text-xs mt-1">Export closes the project first. Backups are unencrypted.</p>
      </div>
      <Button variant="outline" onclick={onexport} disabled={$workspace.busy}
        ><Download size={14} /> Export backup</Button
      >
    </div>
    <div class="setting-row">
      <div>
        <h3 class="flex items-center gap-2"><HardDrive size={16} /> Local project size</h3>
        <p>
          {size === null
            ? 'Close the project to measure its files safely.'
            : `${bytes(size)} of database and object-store files.`}
        </p>
      </div>
      <Button
        variant="ghost"
        onclick={measure}
        disabled={$workspace.busy || $workspace.activeId === project.id}>Measure</Button
      >
    </div>
    <div class="setting-tip">
      <ShieldCheck size={16} />
      <p>
        Copies stay with you. Restoring a backup creates a separate local project and keeps existing
        projects intact.
      </p>
    </div>
  </div>
</section>
<section class="settings-section">
  <div class="settings-label">
    <h2>Delete project</h2>
    <p>For worlds you’ve outgrown.</p>
  </div>
  <div class="surface danger-section">
    <div>
      <h3>Delete this project permanently</h3>
      <p>
        Remove its database, users, objects, and credentials from this browser. Export a backup
        before deleting anything you want to keep.
      </p>
    </div>
    <Button variant="destructive" onclick={ondelete} disabled={$workspace.busy}
      ><Trash2 size={14} /> Delete project</Button
    >
  </div>
</section>
{#if error}<div class="error-banner" role="alert">{error}</div>{/if}
