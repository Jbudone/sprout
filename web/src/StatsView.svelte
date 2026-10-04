<script lang="ts">
import {
  getStats,
  type Settings,
  type StatsSummary,
  saveSettings,
} from './lib/api';

let stats = $state<StatsSummary | null>(null);
let error = $state<string | null>(null);
let perRun = $state(1);
let monthly = $state(5);
let saving = $state(false);
let saved = $state(false);

const short = (model: string) => model.replace(/^openrouter\//, '');
const usd = (n: number) =>
  n >= 1
    ? `$${n.toFixed(2)}`
    : n >= 0.01
      ? `$${n.toFixed(3)}`
      : `$${n.toFixed(4)}`;
const pct = (num: number, den: number) =>
  den > 0 ? `${Math.round((100 * num) / den)}%` : '–';
const monthPct = $derived(
  stats
    ? Math.min(100, (100 * stats.monthToDateUsd) / stats.settings.monthlyCapUsd)
    : 0,
);

async function load() {
  try {
    stats = await getStats();
    perRun = stats.settings.perRunCapUsd;
    monthly = stats.settings.monthlyCapUsd;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
}

$effect(() => {
  load();
});

async function save(e: SubmitEvent) {
  e.preventDefault();
  saving = true;
  saved = false;
  error = null;
  try {
    const next: Settings = { perRunCapUsd: perRun, monthlyCapUsd: monthly };
    await saveSettings(next);
    await load();
    saved = true;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    saving = false;
  }
}
</script>

<div class="mx-auto flex max-w-2xl flex-col gap-6 p-4">
  <h1 class="text-lg font-semibold">Model stats and spend</h1>

  {#if error}<p class="text-sm text-red-600">{error}</p>{/if}

  {#if !stats}
    {#if !error}<p class="text-gray-500">Loading…</p>{/if}
  {:else}
    <section class="flex flex-col gap-3">
      <h2 class="font-medium">Spend</h2>
      <div>
        <div class="flex justify-between text-sm">
          <span>This month (this app)</span>
          <span>{usd(stats.monthToDateUsd)} of {usd(stats.settings.monthlyCapUsd)}</span>
        </div>
        <div class="mt-1 h-2 overflow-hidden rounded bg-gray-200 dark:bg-gray-700">
          <div
            class="h-full {monthPct > 85 ? 'bg-red-500' : monthPct > 60 ? 'bg-amber-500' : 'bg-green-500'}"
            style="width: {monthPct}%"
          ></div>
        </div>
      </div>
      <p class="text-sm text-gray-600 dark:text-gray-300">
        All time in this app: {usd(stats.allTimeUsd)}.
        {#if stats.openrouter}
          OpenRouter balance: <strong>{usd(stats.openrouter.remaining)}</strong> left of {usd(stats.openrouter.totalCredits)}
          {#if stats.openrouter.usageMonthly !== null}
            ({usd(stats.openrouter.usageMonthly)} used this month across everything on this key){/if}.
        {:else}
          OpenRouter balance unavailable (no key, or OpenRouter did not answer).
        {/if}
      </p>

      <form class="flex flex-wrap items-end gap-3 text-sm" onsubmit={save}>
        <label class="flex flex-col gap-1">
          Cap per run ($)
          <input
            type="number"
            step="0.05"
            min="0.01"
            bind:value={perRun}
            class="w-28 rounded-lg border border-gray-300 bg-white p-2 dark:border-gray-600 dark:bg-gray-800"
          />
        </label>
        <label class="flex flex-col gap-1">
          Cap per month ($)
          <input
            type="number"
            step="0.5"
            min="0.01"
            bind:value={monthly}
            class="w-28 rounded-lg border border-gray-300 bg-white p-2 dark:border-gray-600 dark:bg-gray-800"
          />
        </label>
        <button
          type="submit"
          disabled={saving}
          class="rounded-xl bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save caps'}
        </button>
        {#if saved}<span class="text-green-600">Saved</span>{/if}
      </form>
      <p class="text-xs text-gray-500">
        A run is refused up front if its worst case would exceed the per-run cap, and stops mid-run if real
        spend reaches either cap. Costs marked ≈ are tokens × list price; the rest come from the provider.
      </p>
    </section>

    {#if stats.calls.length === 0}
      <p class="text-gray-500">No model calls yet. Generate a deck in the Create tab and the stats appear here.</p>
    {:else}
      <section class="flex flex-col gap-2">
        <h2 class="font-medium">Generators</h2>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead class="text-xs text-gray-500">
              <tr>
                <th class="py-1 pr-3">Model</th><th class="pr-3">Cards</th><th class="pr-3">Passed review</th>
                <th class="pr-3">You approved</th><th class="pr-3">Run cost</th><th>Per approved</th>
              </tr>
            </thead>
            <tbody>
              {#each stats.generators as g (g.model)}
                <tr class="border-t border-gray-200 dark:border-gray-700">
                  <td class="py-1 pr-3">{short(g.model)}</td>
                  <td class="pr-3">{g.cards}</td>
                  <td class="pr-3">{pct(g.passedReview, g.cards)}</td>
                  <td class="pr-3">{g.approved}{g.rejected ? ` (${g.rejected} rejected)` : ''}</td>
                  <td class="pr-3">{usd(g.costUsd)}</td>
                  <td>{g.costPerApprovedUsd === null ? '–' : usd(g.costPerApprovedUsd)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <p class="text-xs text-gray-500">Run cost covers the whole pipeline: the generator plus its reviewers.</p>
      </section>

      <section class="flex flex-col gap-2">
        <h2 class="font-medium">Reviewers</h2>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead class="text-xs text-gray-500">
              <tr>
                <th class="py-1 pr-3">Model</th><th class="pr-3">Final verdicts</th><th class="pr-3">Pass rate</th>
                <th class="pr-3">Agrees with you</th><th>Spend</th>
              </tr>
            </thead>
            <tbody>
              {#each stats.reviewers as r (r.model)}
                <tr class="border-t border-gray-200 dark:border-gray-700">
                  <td class="py-1 pr-3">{short(r.model)}</td>
                  <td class="pr-3">{r.reviews}</td>
                  <td class="pr-3">{pct(r.passed, r.reviews)}</td>
                  <td class="pr-3">{r.decided ? `${pct(r.agreed, r.decided)} (${r.agreed}/${r.decided})` : 'no decisions yet'}</td>
                  <td>{usd(r.costUsd)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <p class="text-xs text-gray-500">
          Agreement counts cards you approved or rejected: a pass on an approved card, or a fail on a rejected
          one, is a match. It needs a few decisions before it means much.
        </p>
      </section>

      <section class="flex flex-col gap-2">
        <h2 class="font-medium">Every model call</h2>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead class="text-xs text-gray-500">
              <tr>
                <th class="py-1 pr-3">Model</th><th class="pr-3">Role</th><th class="pr-3">Calls</th>
                <th class="pr-3">Tokens in / out</th><th class="pr-3">Cost</th><th>Avg time</th>
              </tr>
            </thead>
            <tbody>
              {#each stats.calls as c (c.model + c.role)}
                <tr class="border-t border-gray-200 dark:border-gray-700">
                  <td class="py-1 pr-3">{short(c.model)}</td>
                  <td class="pr-3">{c.role}</td>
                  <td class="pr-3">{c.calls}{c.failedCalls ? ` (${c.failedCalls} failed)` : ''}</td>
                  <td class="pr-3">{c.inputTokens.toLocaleString()} / {c.outputTokens.toLocaleString()}</td>
                  <td class="pr-3">{c.estimatedShare > 0.5 ? '≈' : ''}{usd(c.costUsd)}</td>
                  <td>{(c.avgLatencyMs / 1000).toFixed(1)}s</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/if}
  {/if}
</div>
