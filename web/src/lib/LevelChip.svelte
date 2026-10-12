<script lang="ts">
import { categoryLabel, levelFor } from './levels';

let {
  category,
  rating,
  compact = false,
}: { category: string; rating: number; compact?: boolean } = $props();

const level = $derived(levelFor(rating));
</script>

<div class="level-chip flex min-w-0 items-center gap-2 text-xs" title="{categoryLabel(category)} rating {Math.round(rating)}">
  <span aria-hidden="true">{level.emoji}</span>
  <span class="min-w-0 truncate font-medium">{compact ? '' : `${categoryLabel(category)} · `}{level.name}</span>
  <span
    class="sp-track h-1.5 w-14 shrink-0 overflow-hidden rounded bg-gray-200 dark:bg-gray-700"
    role="progressbar"
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={Math.round(level.progress * 100)}
    aria-label={level.next ? `Progress to ${level.next}` : 'Top level'}
  >
    <span class="block h-full bg-blue-500 transition-all duration-700" style="width: {level.progress * 100}%"></span>
  </span>
  <span class="text-gray-500 dark:text-gray-400">{Math.round(rating)}</span>
</div>
