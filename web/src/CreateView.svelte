<script lang="ts">
import {
  approveAll,
  approveCard,
  type Brief,
  type CardStatus,
  type Deck,
  type Estimate,
  estimateRun,
  getRun,
  listDecks,
  listModels,
  listRuns,
  type ModelOption,
  type PendingCard,
  type Run,
  type RunConfig,
  rejectCard,
  startRun,
} from './lib/api';
import { domainLabel } from './lib/deckFilter';
import Latex from './lib/Latex.svelte';
import { seededShuffle } from './lib/shuffle';
import TriviaQuestion from './lib/TriviaQuestion.svelte';

const REJECT_REASONS = [
  'Boring',
  'Wrong',
  'Too easy',
  'Too hard',
  'Bad options',
  'Other',
];
const SUGGESTED_DOMAINS = [
  'math',
  'science',
  'nature',
  'history-geography',
  'technology',
  'games',
  'entertainment',
  'sports',
  'arts',
  'general',
];
const CUSTOM = '__custom__';

// ---- form ----
let briefText = $state('');
let excludeText = $state('');
let count = $state(10);
let deckName = $state('');
let domain = $state('general');
let generator = $state('');
let customGenerator = $state('');
let reviewers = $state<string[]>([]);
let customReviewer = $state('');
let reviewMode = $state<RunConfig['reviewMode']>('all');
let maxAttempts = $state(2);
let starting = $state(false);
let formError = $state<string | null>(null);

let models = $state<ModelOption[]>([]);
let openrouterConfigured = $state(true);
let decks = $state<Deck[]>([]);
let estimate = $state<Estimate | null>(null);
const overCap = $derived(
  estimate !== null && estimate.worstCaseUsd > estimate.perRunCapUsd,
);
const usd = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`);

// ---- runs ----
let runs = $state<Awaited<ReturnType<typeof listRuns>>['runs']>([]);
let selectedId = $state<string | null>(null);
let run = $state<Run | null>(null);
let cards = $state<PendingCard[]>([]);
let rejecting = $state<string | null>(null);

// Spoiler-free mode: cards show shuffled options to try, and the answer,
// explanation and reviewer notes stay hidden until you answer or reveal.
let spoilerFree = $state(loadSpoilerFree());
let revealed = $state<Record<string, boolean>>({});
let chosen = $state<Record<string, string>>({});

function loadSpoilerFree() {
  try {
    return localStorage.getItem('sprout-create-spoiler-free') === '1';
  } catch {
    return false;
  }
}

function setSpoilerFree(on: boolean) {
  spoilerFree = on;
  try {
    localStorage.setItem('sprout-create-spoiler-free', on ? '1' : '0');
  } catch {
    // Storage unavailable; the toggle just won't persist.
  }
}

const hidden = (id: string) => spoilerFree && !revealed[id];

function choose(c: PendingCard, option: string) {
  if (!hidden(c.id)) return;
  chosen[c.id] = option;
  revealed[c.id] = true;
}
let actionError = $state<string | null>(null);

const generatorModel = $derived(
  generator === CUSTOM ? customGenerator.trim() : generator,
);
const allReviewers = $derived(
  [...reviewers, customReviewer.trim()].filter(
    (m, i, a) => m && a.indexOf(m) === i,
  ),
);
const domainOptions = $derived([
  ...new Set([...SUGGESTED_DOMAINS, ...decks.map((d) => d.domain)]),
]);
const pendingCount = $derived(
  cards.filter((c) => c.status === 'pending').length,
);

function short(model: string) {
  return model.split('/').pop() ?? model;
}

async function loadRuns() {
  runs = (await listRuns()).runs;
}

async function openRun(id: string) {
  selectedId = id;
  rejecting = null;
  actionError = null;
  const res = await getRun(id);
  run = res.run;
  cards = res.cards;
}

$effect(() => {
  Promise.all([listModels(), listDecks(), loadRuns()])
    .then(([m, d]) => {
      models = m.models;
      openrouterConfigured = m.openrouterConfigured;
      decks = d.decks;
      generator = m.defaults.generator;
      reviewers = [...m.defaults.reviewers];
    })
    .catch((e) => {
      formError = e instanceof Error ? e.message : String(e);
    });
});

// Re-estimate the dollar cost whenever the models, count or attempts change.
$effect(() => {
  const config: RunConfig = {
    generator: generatorModel,
    reviewers: allReviewers,
    reviewMode,
    maxAttempts,
  };
  const n = count;
  if (!generatorModel || !Number.isInteger(n) || n < 1 || n > 30) return;
  const timer = setTimeout(() => {
    estimateRun(n, config)
      .then((e) => {
        estimate = e;
      })
      .catch(() => {
        estimate = null;
      });
  }, 400);
  return () => clearTimeout(timer);
});

// Poll while a run is in progress so new cards appear as they finish.
$effect(() => {
  if (!selectedId || run?.status !== 'running') return;
  const id = selectedId;
  const timer = setInterval(async () => {
    try {
      const res = await getRun(id);
      if (selectedId !== id) return;
      run = res.run;
      cards = res.cards;
      if (res.run.status !== 'running') loadRuns();
    } catch {
      // Transient (e.g. dev server restarting); the next tick retries.
    }
  }, 3000);
  return () => clearInterval(timer);
});

async function submit(e: SubmitEvent) {
  e.preventDefault();
  formError = null;
  if (!generatorModel) {
    formError = 'Pick a generator model.';
    return;
  }
  const brief: Brief = {
    brief: briefText.trim(),
    exclude: excludeText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
    count,
    deckName: deckName.trim(),
    domain: domain.trim().toLowerCase().replace(/\s+/g, '-'),
  };
  const config: RunConfig = {
    generator: generatorModel,
    reviewers: allReviewers,
    reviewMode,
    maxAttempts,
  };
  starting = true;
  try {
    const { runId } = await startRun(brief, config);
    await loadRuns();
    await openRun(runId);
  } catch (err) {
    formError = err instanceof Error ? err.message : String(err);
  } finally {
    starting = false;
  }
}

async function act(fn: () => Promise<unknown>) {
  actionError = null;
  try {
    await fn();
    if (selectedId) await openRun(selectedId);
    await loadRuns();
    decks = (await listDecks()).decks;
  } catch (err) {
    actionError = err instanceof Error ? err.message : String(err);
  }
}

function statusLabel(s: CardStatus) {
  return {
    pending: 'Ready to review',
    approved: 'Approved',
    rejected: 'Rejected',
    auto_rejected: 'Failed review',
  }[s];
}

function toggleReviewer(id: string) {
  reviewers = reviewers.includes(id)
    ? reviewers.filter((r) => r !== id)
    : [...reviewers, id].slice(0, 3);
}
</script>

<div class="mx-auto flex max-w-md flex-col gap-6 p-4">
  <form class="flex flex-col gap-3" onsubmit={submit}>
    <h1 class="text-lg font-semibold">Create a deck</h1>

    <label class="flex flex-col gap-1 text-sm">
      What should it be about?
      <textarea
        required
        minlength="3"
        rows="4"
        bind:value={briefText}
        placeholder="Questions around the Zelda universe, mostly very hard, a handful of obscure ones. Skip the TV show and movie."
        class="rounded-lg border border-gray-300 bg-white p-2 dark:border-gray-600 dark:bg-gray-800"
      ></textarea>
    </label>

    <label class="flex flex-col gap-1 text-sm">
      Leave out (one per line, optional)
      <textarea
        rows="2"
        bind:value={excludeText}
        placeholder="Specific titles or terms to never mention"
        class="rounded-lg border border-gray-300 bg-white p-2 dark:border-gray-600 dark:bg-gray-800"
      ></textarea>
    </label>

    <div class="grid grid-cols-2 gap-3">
      <label class="flex flex-col gap-1 text-sm">
        Deck name
        <input
          required
          list="deck-names"
          bind:value={deckName}
          placeholder="Zelda"
          class="rounded-lg border border-gray-300 bg-white p-2 dark:border-gray-600 dark:bg-gray-800"
        />
        <datalist id="deck-names">
          {#each decks as d (d.id)}<option value={d.name}></option>{/each}
        </datalist>
      </label>
      <label class="flex flex-col gap-1 text-sm">
        Domain
        <input
          required
          list="domains"
          bind:value={domain}
          class="rounded-lg border border-gray-300 bg-white p-2 dark:border-gray-600 dark:bg-gray-800"
        />
        <datalist id="domains">
          {#each domainOptions as d (d)}<option value={d}>{domainLabel(d)}</option>{/each}
        </datalist>
      </label>
    </div>

    <label class="flex flex-col gap-1 text-sm">
      How many cards (max 30)
      <input
        type="number"
        min="1"
        max="30"
        required
        bind:value={count}
        class="w-24 rounded-lg border border-gray-300 bg-white p-2 dark:border-gray-600 dark:bg-gray-800"
      />
    </label>

    <details class="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700">
      <summary class="cursor-pointer font-medium">Models and settings</summary>
      <div class="mt-3 flex flex-col gap-3">
        <label class="flex flex-col gap-1">
          Writes the cards (generator)
          <select
            bind:value={generator}
            class="rounded-lg border border-gray-300 bg-white p-2 dark:border-gray-600 dark:bg-gray-800"
          >
            {#each models as m (m.id)}
              <option value={m.id} disabled={!m.available}>
                {m.label}{m.available ? '' : ` (needs ${m.provider} key)`}
              </option>
            {/each}
            <option value={CUSTOM}>Custom model id…</option>
          </select>
          {#if generator === CUSTOM}
            <input
              bind:value={customGenerator}
              placeholder="openrouter/vendor/model"
              class="rounded-lg border border-gray-300 bg-white p-2 dark:border-gray-600 dark:bg-gray-800"
            />
          {/if}
        </label>

        <fieldset class="flex flex-col gap-1">
          <legend class="mb-1">Checks facts and quality (reviewers, up to 3)</legend>
          {#each models as m (m.id)}
            <label class="flex items-center gap-2" class:opacity-50={!m.available}>
              <input
                type="checkbox"
                disabled={!m.available}
                checked={reviewers.includes(m.id)}
                onchange={() => toggleReviewer(m.id)}
              />
              {m.label}{m.available ? '' : ` (needs ${m.provider} key)`}
            </label>
          {/each}
          <input
            bind:value={customReviewer}
            placeholder="Custom reviewer model id (optional)"
            class="mt-1 rounded-lg border border-gray-300 bg-white p-2 dark:border-gray-600 dark:bg-gray-800"
          />
          <p class="text-xs text-gray-500">
            Use a different model than the generator: a model tends to miss its own mistakes.
          </p>
        </fieldset>

        <div class="grid grid-cols-2 gap-3">
          <label class="flex flex-col gap-1">
            A card passes when
            <select
              bind:value={reviewMode}
              class="rounded-lg border border-gray-300 bg-white p-2 dark:border-gray-600 dark:bg-gray-800"
            >
              <option value="all">every reviewer agrees</option>
              <option value="majority">most reviewers agree</option>
            </select>
          </label>
          <label class="flex flex-col gap-1">
            Attempts per card
            <input
              type="number"
              min="1"
              max="4"
              bind:value={maxAttempts}
              class="rounded-lg border border-gray-300 bg-white p-2 dark:border-gray-600 dark:bg-gray-800"
            />
          </label>
        </div>
      </div>
    </details>

    {#if !openrouterConfigured}
      <p class="text-xs text-amber-600">
        OpenRouter models are disabled: add OPENROUTER_API_KEY to .env and restart the dev server.
      </p>
    {/if}
    {#if estimate}
      <p class="text-xs {overCap ? 'text-red-600' : 'text-gray-500'}">
        About {usd(estimate.typicalUsd)} typical, up to {usd(estimate.worstCaseUsd)} worst case
        ({estimate.worstCaseCalls} calls). Cap per run {usd(estimate.perRunCapUsd)}; this month
        {usd(estimate.monthToDateUsd)} of {usd(estimate.monthlyCapUsd)}.
        {#if overCap}Over the per-run cap: reduce cards, attempts or reviewers, or raise the cap in Stats.{/if}
      </p>
      {#if estimate.unpricedModels.length > 0}
        <p class="text-xs text-amber-600">
          No list price for {estimate.unpricedModels.join(', ')}; a pessimistic price is assumed.
        </p>
      {/if}
    {/if}
    {#if formError}<p class="text-sm text-red-600">{formError}</p>{/if}

    <button
      type="submit"
      disabled={starting || overCap}
      class="rounded-xl bg-blue-600 py-3 font-medium text-white disabled:opacity-50"
    >
      {starting ? 'Starting…' : 'Generate deck'}
    </button>
  </form>

  {#if runs.length > 0}
    <section class="flex flex-col gap-2">
      <h2 class="font-medium">Recent runs</h2>
      {#each runs as r (r.id)}
        <button
          type="button"
          onclick={() => openRun(r.id)}
          class="rounded-xl border p-3 text-left text-sm {selectedId === r.id
            ? 'border-blue-500'
            : 'border-gray-200 dark:border-gray-700'}"
        >
          <div class="flex justify-between">
            <span class="font-medium">{r.brief.deckName}</span>
            <span class="text-xs text-gray-500">{r.status}</span>
          </div>
          <div class="text-xs text-gray-500">
            {r.counts.pending} to review · {r.counts.approved} approved · {r.counts.auto_rejected} failed ·
            {short(r.config.generator)} · {new Date(r.createdAt).toLocaleString()}
          </div>
        </button>
      {/each}
    </section>
  {/if}

  {#if run}
    <section class="flex flex-col gap-3">
      <div>
        <h2 class="font-medium">{run.brief.deckName} <span class="text-sm text-gray-500">({domainLabel(run.brief.domain)})</span></h2>
        <p class="text-xs text-gray-500">
          {#if run.status === 'running'}
            Generating… {cards.length} of {run.brief.count} cards done. This page updates itself.
          {:else if run.status === 'failed'}
            Run failed: {run.error}
          {:else}
            Finished: {cards.length} of {run.brief.count} cards produced.
            {#if run.error}<span class="text-amber-600">{run.error}</span>{/if}
          {/if}
          Generator {short(run.config.generator)}; reviewers {run.config.reviewers.map(short).join(', ') || 'none'}.
        </p>
      </div>

      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={spoilerFree}
          onchange={(e) => setSpoilerFree(e.currentTarget.checked)}
        />
        Spoiler-free: let me try the cards first
      </label>

      {#if pendingCount > 0}
        <button
          type="button"
          class="rounded-xl bg-green-600 py-2 text-sm font-medium text-white"
          onclick={() => act(() => approveAll(run!.id))}
        >
          Approve all {pendingCount} ready cards
        </button>
      {/if}
      {#if actionError}<p class="text-sm text-red-600">{actionError}</p>{/if}

      {#each cards as c (c.id)}
        <article class="flex flex-col gap-2 rounded-2xl border border-gray-200 p-3 dark:border-gray-700">
          <div class="flex justify-between text-xs text-gray-400">
            <span>{c.card.category} · elo {c.card.eloRating}</span>
            <span
              class:text-green-600={c.status === 'approved'}
              class:text-red-600={c.status === 'rejected' || c.status === 'auto_rejected'}
              >{statusLabel(c.status)}</span
            >
          </div>

          <TriviaQuestion segments={c.card.question} />

          {#if hidden(c.id)}
            <div class="flex flex-col gap-1 text-sm">
              {#each seededShuffle([c.card.correctAnswer, ...c.card.distractors], c.id) as option (option)}
                <button
                  type="button"
                  class="rounded-lg border border-gray-300 px-3 py-2 text-left dark:border-gray-600"
                  onclick={() => choose(c, option)}
                >
                  <Latex text={option} />
                </button>
              {/each}
            </div>
            <button
              type="button"
              class="self-center text-xs text-gray-400 underline"
              onclick={() => (revealed[c.id] = true)}>Reveal answer</button
            >
          {:else}
            <ul class="flex flex-col gap-1 text-sm">
              {#each seededShuffle([c.card.correctAnswer, ...c.card.distractors], c.id) as option (option)}
                {@const isCorrect = option === c.card.correctAnswer}
                {@const isChosen = chosen[c.id] === option}
                <li
                  class="rounded-lg border px-3 py-1 {isCorrect
                    ? 'border-green-500 bg-green-100 dark:bg-green-900'
                    : isChosen
                      ? 'border-red-500 bg-red-100 dark:bg-red-900'
                      : 'border-gray-200 text-gray-500 dark:border-gray-700'}"
                >
                  <Latex text={option} />
                </li>
              {/each}
            </ul>
            {#if chosen[c.id]}
              <p
                class="text-sm font-semibold {chosen[c.id] === c.card.correctAnswer
                  ? 'text-green-700'
                  : 'text-red-700'}"
              >
                {chosen[c.id] === c.card.correctAnswer ? 'You got it!' : 'Not quite.'}
              </p>
            {/if}
            {#if c.card.acceptableAlternatives.length > 0}
              <p class="text-xs text-gray-400">
                Also accepted: {c.card.acceptableAlternatives.join(' · ')}
              </p>
            {/if}
            <p class="text-sm text-gray-600 dark:text-gray-300"><Latex text={c.card.explanation} /></p>
          {/if}

          <details class="rounded-xl border border-gray-200 p-2 text-sm dark:border-gray-700">
            <summary class="cursor-pointer text-gray-500 dark:text-gray-400">Hints</summary>
            <ol class="mt-2 flex list-decimal flex-col gap-1 pl-5">
              {#each c.card.hints as hint (hint)}
                <li><Latex text={hint} /></li>
              {/each}
            </ol>
          </details>

          <p class="text-xs text-gray-400">
            {c.attempts} attempt{c.attempts === 1 ? '' : 's'}
            {#each c.reviewers as r (r.model)}
              · <span class={r.passed ? 'text-green-600' : 'text-red-600'}>{short(r.model)} {r.passed ? '✓' : '✗'}</span>
            {/each}
          </p>

          {#if !hidden(c.id) && c.issues.length > 0}
            <ul class="list-disc pl-5 text-xs text-red-600">
              {#each c.issues as issue (issue)}<li>{issue}</li>{/each}
            </ul>
          {:else if c.issues.length > 0}
            <p class="text-xs text-gray-400">Reviewer notes hidden until you answer or reveal.</p>
          {/if}
          {#if c.rejectReason}<p class="text-xs text-gray-500">Rejected: {c.rejectReason}</p>{/if}

          {#if c.status === 'pending' || c.status === 'auto_rejected'}
            {#if rejecting === c.id}
              <div class="flex flex-wrap gap-2">
                {#each REJECT_REASONS as reason (reason)}
                  <button
                    type="button"
                    class="rounded-full border border-red-400 px-3 py-1 text-xs text-red-600"
                    onclick={() => { rejecting = null; act(() => rejectCard(c.id, reason)); }}>{reason}</button
                  >
                {/each}
                <button type="button" class="text-xs text-gray-400 underline" onclick={() => (rejecting = null)}>Cancel</button>
              </div>
            {:else}
              <div class="flex gap-2">
                <button
                  type="button"
                  class="flex-1 rounded-xl bg-green-600 py-2 text-sm font-medium text-white"
                  onclick={() => act(() => approveCard(c.id))}
                >
                  {c.status === 'auto_rejected' ? 'Approve anyway' : 'Approve'}
                </button>
                {#if c.status === 'pending'}
                  <button
                    type="button"
                    class="flex-1 rounded-xl border border-red-400 py-2 text-sm text-red-600"
                    onclick={() => (rejecting = c.id)}>Reject…</button
                  >
                {/if}
              </div>
            {/if}
          {/if}
        </article>
      {/each}
    </section>
  {/if}
</div>
