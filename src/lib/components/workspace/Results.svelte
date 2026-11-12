<script lang="ts">
  import type { QueryResult } from '$lib/runtime/pgwire';
  let {
    result,
    empty = 'Results will appear here.',
  }: { result: QueryResult | null; empty?: string } = $props();
</script>

{#if !result}
  <div class="results-empty"><span class="mono text-xs">{empty}</span></div>
{:else if result.error}
  <div class="query-error" role="alert">
    <span class="mono text-xs">{result.error.code}</span>
    <p>{result.error.message}</p>
    {#if result.error.detail}<p class="text-sm opacity-70">{result.error.detail}</p>{/if}
  </div>
{:else}
  {#if result.columns.length}
    <div class="data-scroll">
      <table class="data-table">
        <thead
          ><tr
            ><th class="row-number">#</th>{#each result.columns as col}<th>{col}</th>{/each}</tr
          ></thead
        ><tbody
          >{#each result.rows as row, i}<tr
              ><td class="row-number">{i + 1}</td>{#each row as cell}<td
                  >{#if cell === null}<span class="null">NULL</span>{:else}{cell}{/if}</td
                >{/each}</tr
            >{/each}</tbody
        >
      </table>
      {#if !result.rows.length}<div class="py-8 text-center text-sm text-muted-foreground">
          No rows returned.
        </div>{/if}
    </div>
  {:else}<div class="results-empty"><span>Query completed successfully.</span></div>{/if}
  <div class="results-status">
    <span>{result.tags.join(' · ')}</span><span>{result.ms.toFixed(0)} ms</span>
  </div>
  {#if result.truncated}<p class="inline-note">
      Results limited to 1,000 rows or 1 MB. Add LIMIT or select fewer columns.
    </p>{/if}
  {#if result.transactionRolledBack}<p class="inline-note">
      An uncommitted transaction was rolled back when this run’s connection closed. Submit BEGIN …
      COMMIT together in one run.
    </p>{/if}
  {#each result.notices as notice}<p class="inline-note">{notice}</p>{/each}
{/if}
