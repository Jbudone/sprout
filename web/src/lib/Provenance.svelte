<script lang="ts">
import type { Provenance } from './api';

let { provenance }: { provenance: Provenance | null } = $props();

// "google/gemini-2.5-flash" and "openrouter/anthropic/claude-sonnet-5.5" both
// shorten to the last path segment.
const short = (model: string) => model.split('/').pop() ?? model;
</script>

<p class="text-xs text-gray-400">
  {#if provenance}
    Written by {short(provenance.generator)}
    {#if provenance.attempts > 1}({provenance.attempts} attempts){/if}
    {#if provenance.reviewers.length > 0}
      · checked by
      {#each provenance.reviewers as r, i (i)}
        <span title={r.issues.join('\n')}>{short(r.model)} {r.passed ? '✓' : '✗'}</span>{i <
        provenance.reviewers.length - 1
          ? ', '
          : ''}
      {/each}
    {:else}
      · not reviewed
    {/if}
  {:else}
    Origin not tracked (made before model tracking)
  {/if}
</p>
