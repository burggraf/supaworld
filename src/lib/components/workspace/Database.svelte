<script lang="ts">
  import { onMount } from 'svelte';
  import { Table2, RefreshCw, ChevronLeft, ChevronRight, Columns3, Search } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { manager } from '$lib/projects/manager';
  import { quoteIdentifier, type QueryResult } from '$lib/runtime/pgwire';
  import { message } from '$lib/utils';
  import Results from './Results.svelte';
  let tables = $state<Array<{ schema: string; name: string }>>([]);
  let selected = $state<{ schema: string; name: string } | null>(null);
  let columns = $state<QueryResult | null>(null);
  let result = $state<QueryResult | null>(null);
  let loading = $state(false);
  let error = $state('');
  let search = $state('');
  let offset = $state(0);
  let tab = $state<'rows' | 'columns'>('rows');
  let request = 0;
  const filtered = $derived(
    tables.filter((t) => `${t.schema}.${t.name}`.toLowerCase().includes(search.toLowerCase())),
  );
  onMount(() => {
    void refresh();
  });
  async function refresh() {
    loading = true;
    error = '';
    try {
      const q = await manager.query(
        "SELECT schemaname, tablename FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema') ORDER BY CASE WHEN schemaname='public' THEN 0 ELSE 1 END, schemaname, tablename",
      );
      if (q.error) throw new Error(q.error.message);
      tables = q.rows.map((r) => ({ schema: r[0]!, name: r[1]! }));
      if (
        selected &&
        !tables.some((t) => t.schema === selected!.schema && t.name === selected!.name)
      ) {
        selected = null;
        result = null;
      }
    } catch (e) {
      error = message(e);
    } finally {
      loading = false;
    }
  }
  async function select(table: { schema: string; name: string }, page = 0) {
    selected = table;
    offset = page;
    loading = true;
    error = '';
    const epoch = ++request;
    try {
      const ident = `${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)}`;
      const [rows, info] = await Promise.all([
        manager.query(`SELECT * FROM ${ident} LIMIT 100 OFFSET ${page}`),
        manager.query(
          `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = '${table.schema.replaceAll("'", "''")}' AND table_name = '${table.name.replaceAll("'", "''")}' ORDER BY ordinal_position`,
        ),
      ]);
      if (epoch === request) {
        result = rows;
        columns = info;
      }
    } catch (e) {
      if (epoch === request) error = message(e);
    } finally {
      if (epoch === request) loading = false;
    }
  }
</script>

<div class="page-heading">
  <div>
    <p class="eyebrow">DATABASE WORKSPACE</p>
    <h1>Database</h1>
    <p>A closer look at the data in your project.</p>
  </div>
  <Button variant="outline" onclick={refresh} disabled={loading}
    ><RefreshCw size={14} /> Refresh schema</Button
  >
</div>
{#if error}<div class="error-banner" role="alert">{error}</div>{/if}
<section class="database-panel">
  <aside class="tables-sidebar">
    <div class="relative">
      <Search size={14} class="search-icon" /><Input
        class="pl-8 h-9"
        bind:value={search}
        aria-label="Filter tables"
        placeholder="Find a table…"
      />
    </div>
    <div class="table-list">
      {#each filtered as table}<button
          class:chosen={selected?.schema === table.schema && selected?.name === table.name}
          onclick={() => select(table)}
          disabled={loading}
          ><Table2 size={14} /><span><small>{table.schema}.</small>{table.name}</span></button
        >{/each}{#if !filtered.length}<p class="text-xs text-muted-foreground p-3">
          {loading ? 'Loading tables…' : 'No tables yet. Create one in the SQL editor.'}
        </p>{/if}
    </div>
    <div class="tables-count">{tables.length} tables</div>
  </aside>
  <div class="table-content">
    {#if selected}<div class="table-toolbar">
        <span class="flex items-center gap-2"
          ><Table2 size={15} /><span class="mono">{selected.schema}.{selected.name}</span></span
        >
        <div class="segmented">
          <button class:active={tab === 'rows'} onclick={() => (tab = 'rows')}>Rows</button><button
            class:active={tab === 'columns'}
            onclick={() => (tab = 'columns')}>Columns</button
          >
        </div>
      </div>
      <Results result={tab === 'rows' ? result : columns} />{#if tab === 'rows'}<div
          class="pagination"
        >
          <span>Rows {offset + 1}–{offset + (result?.rows.length ?? 0)}</span><Button
            variant="ghost"
            size="icon-sm"
            aria-label="Previous page"
            disabled={!offset || loading}
            onclick={() => select(selected!, Math.max(0, offset - 100))}
            ><ChevronLeft size={16} /></Button
          ><Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next page"
            disabled={(result?.rows.length ?? 0) < 100 || loading}
            onclick={() => select(selected!, offset + 100)}><ChevronRight size={16} /></Button
          >
        </div>{/if}{:else}<div class="table-placeholder">
        <div class="placeholder-icon"><Columns3 size={25} /></div>
        <h3>Your data, one table at a time.</h3>
        <p>Select a table to explore its rows and columns.</p>
      </div>{/if}
  </div>
</section>
