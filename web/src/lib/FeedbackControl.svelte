<script lang="ts">
import { reasonsFor, targetLabel } from './feedbackReasons';
import type { FeedbackState } from './feedbackState.svelte';

let { state }: { state: FeedbackState } = $props();

const reasons = $derived(reasonsFor(state.targets));
</script>

<div class="sp-card mt-1 rounded-xl border border-gray-200 p-3 text-sm dark:border-gray-700">
  <p class="font-medium text-gray-500 dark:text-gray-400">Feedback</p>

  <div class="mt-2 flex flex-wrap gap-2">
    <button type="button" class="sp-chip rounded-full border px-3 py-1" class:chip-on={state.reaction === 'standout'} aria-pressed={state.reaction === 'standout'} onclick={() => state.toggleReaction('standout')}>⭐ Standout</button>
    <button type="button" class="sp-chip rounded-full border px-3 py-1" class:chip-on={state.difficulty === 'too_easy'} aria-pressed={state.difficulty === 'too_easy'} onclick={() => state.toggleDifficulty('too_easy')}>Too easy</button>
    <button type="button" class="sp-chip rounded-full border px-3 py-1" class:chip-on={state.difficulty === 'too_hard'} aria-pressed={state.difficulty === 'too_hard'} onclick={() => state.toggleDifficulty('too_hard')}>Too hard</button>
    <button type="button" class="sp-chip rounded-full border px-3 py-1" class:chip-on={state.reaction === 'not_fun'} aria-pressed={state.reaction === 'not_fun'} onclick={() => state.toggleReaction('not_fun')}>Not fun</button>
  </div>

  {#if state.targets.length === 0}
    <p class="mt-3 text-xs text-gray-500 dark:text-gray-400">
      Something specific off? Tap the flag next to the question, an answer, a hint or the explanation.
    </p>
  {:else}
    <p class="mt-3 text-xs text-gray-500 dark:text-gray-400">
      Flagged: {state.targets.map(targetLabel).join(' · ')}
    </p>
    <div class="mt-2 flex flex-wrap gap-2">
      {#each reasons as r (r.id)}
        <button type="button" class="sp-chip rounded-full border px-3 py-1" class:chip-on={state.reasons.includes(r.id)} aria-pressed={state.reasons.includes(r.id)} onclick={() => state.toggleReason(r.id)}>{r.label}</button>
      {/each}
    </div>
  {/if}

  <textarea
    class="mt-3 w-full rounded-lg border p-2 text-sm dark:bg-gray-800"
    rows="2"
    placeholder="Optional: what should change?"
    aria-label="Feedback note"
    bind:value={state.notes}
    onblur={() => state.commit()}
  ></textarea>
</div>
