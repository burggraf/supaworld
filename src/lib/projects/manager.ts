import { writable } from 'svelte/store';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as repo from './repository';
import { secret, storeName, validateName, type Project, type Credentials } from './model';
import {
  withOperation,
  hasMarker,
  findStore,
  withStore,
  removeStore,
  directoryFiles,
  storeRoot,
} from '../platform/locks';
import { loadHost, manifest, prepareArtifacts } from '../runtime/artifacts';
import {
  RUNTIME_BASE,
  RUNTIME_BUILD,
  COMPATIBLE_RUNTIME_BUILDS,
  SERVICES,
} from '../runtime/config';
import type { RuntimeStack, GateState } from '../runtime/types';
import { PgClient, type QueryResult } from '../runtime/pgwire';
import { message } from '../utils';

export interface WorkspaceState {
  projects: Project[];
  activeId: string | null;
  busy: boolean;
  stage: string;
  error: string | null;
  progress: { done: number; total: number } | null;
  gates: Record<string, GateState>;
  kernel: string;
  elapsed: number;
  peers: Record<string, string>;
  orphans: string[];
  canCancel: boolean;
}
export class ProjectManager {
  private value: WorkspaceState = {
    projects: [],
    activeId: null,
    busy: false,
    stage: '',
    error: null,
    progress: null,
    gates: {},
    kernel: 'stopped',
    elapsed: 0,
    peers: {},
    orphans: [],
    canCancel: false,
  };
  readonly state = writable(this.value);
  private stack: RuntimeStack | null = null;
  private clients: SupabaseClient[] = [];
  private clientSerial = 0;
  private operations = new Map<AbortController, Promise<unknown>>();
  private generation = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private poll: ReturnType<typeof setInterval> | undefined;
  private channel =
    typeof BroadcastChannel === 'function' ? new BroadcastChannel('supaworld') : null;
  private tabId = globalThis.crypto?.randomUUID?.() ?? `tab-${Date.now()}-${Math.random()}`;
  private failedClose = false;
  private sessionAbort = new AbortController();
  private openAbort: AbortController | null = null;
  private startedAt = 0;
  constructor() {
    this.channel?.addEventListener('message', () => {
      void this.refresh();
    });
  }
  get current() {
    return this.value;
  }
  get activeStack() {
    return this.stack;
  }
  private set(next: Partial<WorkspaceState>) {
    this.value = { ...this.value, ...next };
    this.state.set(this.value);
  }
  clearError() {
    this.set({ error: null });
  }
  private announce() {
    this.channel?.postMessage({ type: 'catalog-changed', tabId: this.tabId });
  }
  async refresh() {
    const projects = await repo.listProjects();
    const held = (await navigator.locks?.query())?.held ?? [];
    const peers: Record<string, string> = {};
    for (const project of projects)
      if (
        project.id !== this.value.activeId &&
        held.some((l) => l.name === `supa-wasm/${project.storeName}`)
      )
        peers[project.id] = 'Open in another tab';
    this.set({ projects, peers });
  }
  async init() {
    await this.refresh();
    try {
      const known = new Set(this.value.projects.map((p) => p.storeName));
      const orphans: string[] = [];
      const root = await storeRoot();
      for await (const name of (
        root as FileSystemDirectoryHandle & { keys(): AsyncIterableIterator<string> }
      ).keys())
        if (/^supaworld-[0-9a-f-]{36}$/.test(name) && !known.has(name)) orphans.push(name);
      this.set({ orphans });
      for (const p of this.value.projects.filter((p) => p.lifecycle === 'deleting'))
        await this.delete(p.id);
    } catch (error) {
      this.set({ error: message(error) });
    }
  }
  private action<T>(fn: () => Promise<T>): Promise<T> {
    const task = this.queue.then(async () => {
      this.set({ busy: true, error: null, elapsed: 0 });
      this.startedAt = Date.now();
      const elapsedTimer = setInterval(
        () => this.set({ elapsed: Date.now() - this.startedAt }),
        1000,
      );
      try {
        if (this.failedClose)
          throw new Error(
            'The previous project could not close safely. Reload this page to recover it before opening another project.',
          );
        return await fn();
      } catch (error) {
        this.set({ error: message(error) });
        throw error;
      } finally {
        clearInterval(elapsedTimer);
        this.set({ busy: false, stage: '', progress: null });
        await this.refresh();
        this.announce();
      }
    });
    this.queue = task.catch(() => undefined);
    return task;
  }
  async create(name: string) {
    return this.action(async () => {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const data = await manifest();
      const project: Project = {
        id,
        name: validateName(name),
        storeName: storeName(id),
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: null,
        runtimeBuildId: RUNTIME_BUILD,
        provisioningVersion: 1,
        provisioning: {
          services: [...SERVICES],
          seedSql: '',
          templateStamp: data.templateStamp,
          credentialRef: id,
        },
        lifecycle: 'creating',
        operationId: crypto.randomUUID(),
        revision: 0,
        lastError: null,
      };
      const credentials: Credentials = { id, jwtSecret: secret(), postgresPassword: secret() };
      await repo.insertProject(project, credentials);
      await this.refresh();
      await this.closeInternal();
      await withOperation(id, () => this.openInternal(id));
      return id;
    });
  }
  async open(id: string) {
    return this.action(async () => {
      if (this.value.activeId === id && this.stack) return;
      await this.closeInternal();
      await withOperation(id, () => this.openInternal(id));
    });
  }
  private async openInternal(id: string, restoring = false) {
    const project = await repo.getProject(id);
    if (project.lifecycle === 'deleting' || (project.lifecycle === 'importing' && !restoring))
      throw new Error('Finish this project’s pending recovery operation before opening it.');
    if (!COMPATIBLE_RUNTIME_BUILDS.includes(project.runtimeBuildId))
      throw new Error(
        `This project needs runtime ${project.runtimeBuildId}. You can still export its files.`,
      );
    const existing =
      restoring || project.lifecycle === 'ready' || project.lastError?.code === 'open';
    try {
      if (existing && !(await hasMarker(project.storeName)))
        throw new Error(
          'Project files or their completion marker are missing. Restore a backup; an empty replacement will not be created.',
        );
      this.openAbort = new AbortController();
      this.sessionAbort = new AbortController();
      this.set({ stage: 'Preparing the browser runtime', canCancel: true });
      const data = await prepareArtifacts(
        (done, total, label) =>
          this.set({
            progress: { done, total },
            stage: label,
            elapsed: Date.now() - this.startedAt,
          }),
        this.openAbort.signal,
      );
      if (data.templateStamp !== project.provisioning.templateStamp)
        throw new Error('This project’s database template does not match the installed runtime.');
      await loadHost();
      const credentials = await repo.getCredentials(project.provisioning.credentialRef);
      const artifacts = Object.fromEntries(
        Object.entries({
          postgres: 'postgres.wasm',
          pg: 'pg.tar',
          template: 'template.tar',
          templateStamp: 'template.stamp',
          postgrest: 'postgrest.wasm',
          auth: 'auth.wasm',
          storage: 'storage.wasm',
          storageImage: 'storage-image.tar',
          beam: 'beam.wasm',
          realtimeRelease: 'realtime-release.tar',
        }).map(([k, v]) => [k, `${RUNTIME_BASE}/${v}`]),
      );
      this.set({
        stage: existing ? 'Opening your saved project' : 'Creating the database and services',
        progress: null,
      });
      this.stack = await window.supa!.stack.start({
        persist: project.storeName,
        jwtSecret: credentials.jwtSecret,
        postgresPassword: credentials.postgresPassword,
        url: `https://${id}.supaworld.invalid`,
        siteUrl: location.origin,
        services: project.provisioning.services,
        seedSql: project.provisioning.seedSql,
        artifacts,
        waitForReady: false,
      });
      this.openAbort.signal.throwIfAborted();
      this.startPolling();
      await this.stack.ready;
      this.openAbort.signal.throwIfAborted();
      if (existing && this.stack.timings.provisioned !== false)
        throw new Error('Unexpected reprovisioning was refused.');
      const client = await PgClient.open(this.stack);
      try {
        const result = await client.query('SELECT 1');
        if (result.error) throw new Error(result.error.message);
      } finally {
        await client.close();
      }
      this.generation++;
      this.set({ activeId: id });
      await repo.updateProject(id, {
        lifecycle: 'ready',
        lastOpenedAt: new Date().toISOString(),
        lastError: null,
        operationId: null,
      });
      await repo.setPreference('last-project', id);
      this.announce();
    } catch (error) {
      if (this.stack) {
        try {
          await this.stack.stop();
          this.stack = null;
        } catch {
          this.failedClose = true;
        }
      }
      clearInterval(this.poll);
      await repo.updateProject(id, {
        lifecycle: 'error',
        lastError: { code: existing ? 'open' : 'create', message: message(error) },
      });
      throw error;
    } finally {
      this.openAbort = null;
      this.set({ canCancel: false });
    }
  }
  cancelOpening() {
    this.set({ canCancel: false, stage: 'Cancelling project opening' });
    this.openAbort?.abort(
      new Error('Project opening was cancelled. You can retry with its saved settings.'),
    );
    if (this.openAbort && this.stack) void this.stack.stop().catch(() => undefined);
  }
  private startPolling() {
    clearInterval(this.poll);
    const update = () => {
      if (!this.stack) return;
      if (document.hidden && !this.value.busy) return;
      this.set({
        gates: this.stack.gates(),
        kernel: this.stack.kernel().state,
        elapsed: Date.now() - this.startedAt,
      });
    };
    update();
    this.poll = setInterval(update, 700);
  }
  private async closeInternal() {
    if (!this.stack) return;
    this.set({ stage: 'Saving and closing the current project' });
    this.generation++;
    this.sessionAbort.abort();
    for (const controller of this.operations.keys()) controller.abort();
    await Promise.allSettled([...this.operations.values()]);
    for (const client of this.clients) {
      client.auth.stopAutoRefresh();
      await client.removeAllChannels();
    }
    this.clients = [];
    try {
      const stopped = await this.stack.stop();
      if (stopped.left.length)
        throw new Error('Some database processes did not stop. Reload before continuing.');
    } catch (error) {
      this.failedClose = true;
      throw error;
    } finally {
      clearInterval(this.poll);
    }
    this.stack = null;
    this.set({ activeId: null, gates: {}, kernel: 'stopped' });
    this.announce();
  }
  async close() {
    return this.action(() => this.closeInternal());
  }
  async rename(id: string, name: string) {
    return this.action(() =>
      withOperation(id, async () => {
        await repo.updateProject(id, { name: validateName(name) });
      }),
    );
  }
  async delete(id: string) {
    return this.action(async () => {
      if (this.value.activeId === id) await this.closeInternal();
      await withOperation(id, async () => {
        const project = await repo.getProject(id);
        await withStore(project.storeName, async () => {
          await repo.updateProject(id, { lifecycle: 'deleting', operationId: crypto.randomUUID() });
          await removeStore(project.storeName);
          await repo.forgetProject(id);
          localStorage.removeItem(`supaworld:auth:${id}`);
        });
      });
    });
  }
  async query(sql: string, signal?: AbortSignal): Promise<QueryResult> {
    const stack = this.stack;
    const id = this.value.activeId;
    const generation = this.generation;
    if (!stack || !id || this.value.busy) throw new Error('Open a project before running SQL.');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const task = (async () => {
      const client = await PgClient.open(stack);
      try {
        controller.signal.throwIfAborted();
        const result = await client.query(sql, controller.signal);
        if (
          !result.error &&
          !result.transactionRolledBack &&
          result.tags.some((tag) => /^(CREATE|ALTER|DROP|COMMENT|GRANT|REVOKE)\b/.test(tag))
        )
          await client.query("NOTIFY pgrst, 'reload schema'");
        if (generation !== this.generation)
          throw new Error('The project changed before this query completed.');
        return result;
      } finally {
        await client.close();
      }
    })();
    this.operations.set(controller, task);
    try {
      return await task;
    } finally {
      this.operations.delete(controller);
      signal?.removeEventListener('abort', abort);
    }
  }
  async client(role: 'anon' | 'admin' = 'anon') {
    const stack = this.stack;
    if (!stack || !this.value.activeId || this.value.busy) throw new Error('Open a project first.');
    const sessionSignal = this.sessionAbort.signal;
    const sdk = createClient(stack.url, role === 'admin' ? stack.serviceRoleKey : stack.anonKey, {
      global: {
        fetch: (input, init) => {
          const url = new URL(
            typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
          );
          if (url.origin !== new URL(stack.url).origin)
            throw new Error('The project client cannot make requests to another origin.');
          const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : null);
          return stack.fetch(input, {
            ...init,
            signal: requestSignal ? AbortSignal.any([sessionSignal, requestSignal]) : sessionSignal,
          });
        },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: `supaworld:auth:${this.value.activeId}:${this.generation}:${role}:${this.clientSerial++}`,
      },
      realtime: { transport: stack.WebSocket },
    });
    this.clients.push(sdk);
    return sdk;
  }
  async diagnostics() {
    const stack = this.stack;
    if (!stack) throw new Error('Open a project first.');
    const id = this.value.activeId;
    const generation = this.generation;
    const client = await this.client('admin');
    const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
    for (const [name, run] of [
      [
        'PostgreSQL',
        async () => {
          const r = await this.query('SELECT version()');
          if (r.error) throw new Error(r.error.message);
        },
      ],
      [
        'PostgREST',
        async () => {
          const r = await stack.fetch(`${stack.url}/rest/v1/`, {
            headers: {
              apikey: stack.serviceRoleKey,
              authorization: `Bearer ${stack.serviceRoleKey}`,
            },
            signal: AbortSignal.timeout(60_000),
          });
          await r.text();
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
        },
      ],
      [
        'Auth',
        async () => {
          const { error } = await client.auth.admin.listUsers({ page: 1, perPage: 1 });
          if (error) throw error;
        },
      ],
      [
        'Storage',
        async () => {
          const { error } = await client.storage.listBuckets();
          if (error) throw error;
        },
      ],
      [
        'Realtime',
        async () => {
          const channel = client.channel(`diagnostic-${crypto.randomUUID()}`);
          try {
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(
                () => reject(new Error('Realtime did not answer in time.')),
                60_000,
              );
              channel.subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                  clearTimeout(timer);
                  resolve();
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                  clearTimeout(timer);
                  reject(new Error(status));
                }
              });
            });
          } finally {
            await client.removeChannel(channel);
          }
        },
      ],
    ] as Array<[string, () => Promise<void>]>) {
      if (generation !== this.generation || id !== this.value.activeId)
        throw new Error('The project changed.');
      try {
        await run();
        checks.push({ name, ok: true, detail: 'Ready' });
      } catch (e) {
        checks.push({ name, ok: false, detail: message(e) });
      }
    }
    return checks;
  }
  async export(id: string, sink?: WritableStream<Uint8Array>) {
    return this.action(async () => {
      if (this.value.activeId === id) await this.closeInternal();
      return withOperation(id, async () => {
        const p = await repo.getProject(id);
        return withStore(p.storeName, async () => {
          const { exportProject } = await import('../storage/backups');
          this.set({ stage: 'Writing your project backup' });
          return exportProject(p, await repo.getCredentials(p.provisioning.credentialRef), sink);
        });
      });
    });
  }
  async import(file: File) {
    return this.action(async () => {
      await this.closeInternal();
      this.set({ stage: 'Checking and restoring the backup' });
      const { importProject } = await import('../storage/backups');
      const id = await importProject(file, (stage) => this.set({ stage }));
      await withOperation(id, () => this.openInternal(id, true));
      return id;
    });
  }
  async discardImport(id: string) {
    return this.delete(id);
  }
  async projectSize(id: string) {
    const p = await repo.getProject(id);
    return withOperation(id, () =>
      withStore(p.storeName, async () => {
        const dir = await findStore(p.storeName);
        return dir ? (await directoryFiles(dir)).reduce((n, f) => n + f.file.size, 0) : 0;
      }),
    );
  }
}
export const manager = new ProjectManager();
