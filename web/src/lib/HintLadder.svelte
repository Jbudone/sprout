<script lang="ts">
import type { FeedbackState } from './feedbackState.svelte';
import FlagToggle from './FlagToggle.svelte';
import { hintTarget } from './feedbackReasons';
import Latex from './Latex.svelte';

// Hints are ordered gentlest first, and shown one at a time so a nudge doesn't
// get spoiled by the stronger hint below it. With `showAll` (after answering)
// every hint is listed so it can be reviewed and flagged.
let {
  hints,
  feedback = null,
  showAll = false,
}: { hints: string[]; feedback?: FeedbackState | null; showAll?: boolean } = $props();

let shown = $state(0);
const visible = $derived(showAll ? hints.length : shown);
const remaining = $derived(hints.length - visible);
const LABELS = ['Nudge', 'Closer', 'Nearly there'];
</script>

{#if hints.length > 0}
  <div class="flex flex-col gap-2">
    {#if showAll && feedback}
      <div class="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
        <span>Hints</span>
        <span class="flex items-center gap-1">All hints <FlagToggle state={feedback} target="hints" /></span>
      </div>
    {/if}
    {#each hints.slice(0, visible) as hint, i (i)}
      <div class="sp-card anim-rise flex items-start gap-2 rounded-xl border border-gray-200 p-3 text-sm dark:border-gray-700">
        <div class="min-w-0 flex-1">
          <p class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Hint {i + 1}{hints.length > 1 ? ` · ${LABELS[Math.min(i, 2)]}` : ''}
          </p>
          <div class="mt-1"><Latex text={hint} /></div>
        </div>
        {#if feedback}<FlagToggle state={feedback} target={hintTarget(i + 1)} />{/if}
      </div>
    {/each}
    {#if !showAll && remaining > 0}
      <button
        type="button"
        class="sp-btn sp-hint self-start rounded-xl border border-gray-300 px-4 py-2 text-sm dark:border-gray-600"
        onclick={() => (shown += 1)}
      >
        {visible === 0 ? 'Need a hint?' : 'Another hint'} ({remaining} left)
      </button>
    {/if}
  </div>
{/if}
