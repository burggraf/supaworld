<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { Play, Square, RotateCcw, Code2, Check } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { manager } from '$lib/projects/manager';
  import { loadDraft, saveDraft } from '$lib/projects/repository';
  import type { Project } from '$lib/projects/model';
  import type { QueryResult } from '$lib/runtime/pgwire';
  import { message } from '$lib/utils';
  import Results from './Results.svelte';
  let { project }: { project: Project } = $props();
  let sql = $state('');
  let result = $state<QueryResult | null>(null);
  let running = $state(false);
  let error = $state('');
  let saved = $state(true);
  let editor: HTMLTextAreaElement;
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let alive = true;
  let edited = false;
  const id = untrack(() => project.id);
  onMount(() => {
    void loadDraft(id)
      .then((value) => {
        if (alive && !edited) sql = value;
      })
      .catch((e) => {
        if (alive) error = message(e);
      });
  });
  onDestroy(() => {
    alive = false;
    controller?.abort();
    clearTimeout(timer);
    if (sql) void saveDraft(id, sql).catch(() => undefined);
  });
  function changed() {
    edited = true;
    saved = false;
    clearTimeout(timer);
    timer = setTimeout(() => {
      void saveDraft(id, sql)
        .then(() => {
          if (alive) saved = true;
        })
        .catch((e) => {
          if (alive) error = `Could not save your draft: ${message(e)}`;
        });
    }, 300);
  }
  async function run() {
    if (running || !sql.trim()) return;
    running = true;
    error = '';
    controller = new AbortController();
    const selection = editor.value.slice(editor.selectionStart, editor.selectionEnd).trim();
    try {
      await saveDraft(id, sql);
      const next = await manager.query(selection || sql, controller.signal);
      if (alive) result = next;
    } catch (e) {
      if (alive) error = message(e);
    } finally {
      if (alive) running = false;
    }
  }
  function shortcut(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      void run();
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      const at = editor.selectionStart;
      sql = sql.slice(0, at) + '  ' + sql.slice(editor.selectionEnd);
      requestAnimationFrame(() => {
        editor.selectionStart = editor.selectionEnd = at + 2;
      });
      changed();
    }
  }
  function sample() {
    sql =
      "CREATE TABLE IF NOT EXISTS public.notes (\n  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,\n  body text NOT NULL,\n  created_at timestamptz DEFAULT now()\n);\n\nINSERT INTO public.notes (body)\nVALUES ('Hello from your browser.');\n\nSELECT * FROM public.notes;";
    changed();
    editor?.focus();
  }
</script>

<div class="page-heading">
  <div>
    <p class="eyebrow">DATABASE WORKSPACE</p>
    <h1>SQL editor</h1>
    <p>A direct line to your PostgreSQL database.</p>
  </div>
  <Button variant="outline" onclick={sample} disabled={running}
    ><Code2 size={15} /> Try an example</Button
  >
</div>
<section class="editor-panel">
  <div class="editor-toolbar">
    <span class="flex items-center gap-2"
      ><span class="status-dot"></span> postgres <span class="muted">/</span>
      <span class="mono text-xs">{project.name}</span></span
    ><span class="text-xs text-muted-foreground flex items-center gap-1"
      >{#if saved}<Check size={13} /> Draft saved{:else}Saving…{/if}</span
    >
  </div>
  <div class="editor-body">
    <div class="line-numbers" aria-hidden="true">
      {#each sql.split('\n') as _, i}<div>{i + 1}</div>{/each}
    </div>
    <textarea
      bind:this={editor!}
      bind:value={sql}
      oninput={changed}
      onkeydown={shortcut}
      aria-label="SQL query"
      spellcheck="false"
      autocapitalize="off"
      autocomplete="off"
      class="sql-editor"
      placeholder="SELECT now();"></textarea>
  </div>
  <div class="editor-footer">
    <span class="text-xs text-muted-foreground"
      >Select text to run a selection. <kbd>⌘ / Ctrl</kbd> + <kbd>Enter</kbd> to run.</span
    >
    <div class="flex gap-2">
      {#if running}<Button variant="outline" onclick={() => controller?.abort()}
          ><Square size={13} /> Cancel query</Button
        >{/if}<Button onclick={run} disabled={running || !sql.trim()}
        ><Play size={14} />{running ? 'Running…' : 'Run query'}</Button
      >
    </div>
  </div>
</section>
{#if error}<div class="error-banner" role="alert">{error}</div>{/if}
<section class="results-panel">
  <div class="panel-heading">
    <span class="flex items-center gap-2"><RotateCcw size={14} /> Results</span><span
      class="mono text-xs text-muted-foreground">{result?.rows.length ?? 0} rows</span
    >
  </div>
  <Results {result} />
</section>
<p class="footnote">
  Queries run with local administrator access. Each run has its own connection and a 30-second
  default statement timeout.
</p>
