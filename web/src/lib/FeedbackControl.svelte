<script lang="ts">
import type { Difficulty, Feedback, Reaction } from './api';

let {
  feedback = null,
  startOpen = false,
  onSubmit,
}: {
  feedback?: Feedback | null;
  startOpen?: boolean;
  onSubmit: (feedback: Partial<Feedback>) => void;
} = $props();

let open = $state(startOpen);
let difficulty = $state<Difficulty | null>(feedback?.difficulty ?? null);
let reaction = $state<Reaction | null>(feedback?.reaction ?? null);
let notes = $state(feedback?.notes ?? '');

function submit() {
  onSubmit({ difficulty, reaction, notes: notes.trim() || null });
}

function toggleDifficulty(value: Difficulty) {
  difficulty = difficulty === value ? null : value;
  submit();
}

function toggleReaction(value: Reaction) {
  reaction = reaction === value ? null : value;
  submit();
}
</script>

<div class="mt-3 rounded-xl border border-gray-200 dark:border-gray-700 p-3 text-sm">
  <button
    type="button"
    class="w-full text-left font-medium text-gray-500 dark:text-gray-400"
    onclick={() => (open = !open)}
  >
    Feedback on this question {open ? '▲' : '▼'}
  </button>
  {#if open}
    <div class="mt-3 flex flex-col gap-3">
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="rounded-full border px-3 py-1 transition-colors"
          class:bg-amber-500={reaction === 'standout'}
          class:text-white={reaction === 'standout'}
          class:border-amber-500={reaction === 'standout'}
          onclick={() => toggleReaction('standout')}
        >
          ⭐ Standout
        </button>
        <button
          type="button"
          class="rounded-full border px-3 py-1 transition-colors"
          class:bg-blue-600={difficulty === 'too_easy'}
          class:text-white={difficulty === 'too_easy'}
          class:border-blue-600={difficulty === 'too_easy'}
          onclick={() => toggleDifficulty('too_easy')}
        >
          Too easy
        </button>
        <button
          type="button"
          class="rounded-full border px-3 py-1 transition-colors"
          class:bg-blue-600={difficulty === 'too_hard'}
          class:text-white={difficulty === 'too_hard'}
          class:border-blue-600={difficulty === 'too_hard'}
          onclick={() => toggleDifficulty('too_hard')}
        >
          Too hard
        </button>
        <button
          type="button"
          class="rounded-full border px-3 py-1 transition-colors"
          class:bg-gray-600={reaction === 'not_fun'}
          class:text-white={reaction === 'not_fun'}
          class:border-gray-600={reaction === 'not_fun'}
          onclick={() => toggleReaction('not_fun')}
        >
          Not fun
        </button>
      </div>
      <textarea
        class="w-full rounded-lg border p-2 text-sm dark:bg-gray-800"
        rows="2"
        placeholder="Optional notes..."
        bind:value={notes}
        onblur={submit}
      ></textarea>
    </div>
  {/if}
</div>
