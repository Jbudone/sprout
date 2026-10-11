<script lang="ts">
import { targetLabel } from './feedbackReasons';
import type { FeedbackState } from './feedbackState.svelte';

let {
  state,
  target,
  class: className = '',
}: { state: FeedbackState; target: string; class?: string } = $props();

const on = $derived(state.has(target));
</script>

<button
  type="button"
  class="flag-toggle inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full {className}"
  class:flag-on={on}
  aria-pressed={on}
  aria-label="Flag: {targetLabel(target)}"
  title="Flag this"
  onclick={(e) => {
    e.stopPropagation();
    state.toggle(target);
  }}
>
  <svg width="16" height="16" viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M5 21V4" />
    <path d="M5 4h12l-2 4 2 4H5" />
  </svg>
</button>
