<script lang="ts">
import type { QuestionSegment } from './api';
import Latex from './Latex.svelte';

let { segments }: { segments: QuestionSegment[] } = $props();

// Unknown styles fall back to the prose look, so a style added to the schema
// renders reasonably here before this file knows about it.
const STYLES: Record<string, string> = {
  formula: 'block text-center text-2xl',
  context: 'block text-sm text-gray-500 dark:text-gray-400',
  prose: 'block text-lg font-medium',
};
</script>

<div class="flex flex-col gap-2">
  {#each segments as segment, i (i)}
    <Latex text={segment.text} class={STYLES[segment.style] ?? STYLES.prose} />
  {/each}
</div>
