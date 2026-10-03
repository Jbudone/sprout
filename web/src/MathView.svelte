<script lang="ts">
import {
  answerQuiz,
  listQuiz,
  type MathProblem,
  type QuizListItem,
  sendFeedback,
} from './lib/api';
import FeedbackControl from './lib/FeedbackControl.svelte';
import Latex from './lib/Latex.svelte';
import { swipeNav } from './lib/swipeNav';

let items = $state<QuizListItem<MathProblem>[]>([]);
let index = $state(0);
let loading = $state(true);
let error = $state<string | null>(null);

const current = $derived(items[index]);

$effect(() => {
  listQuiz<MathProblem>('math')
    .then((res) => {
      items = res.items;
    })
    .catch((e) => {
      error = e instanceof Error ? e.message : String(e);
    })
    .finally(() => {
      loading = false;
    });
});

function goBack() {
  if (index > 0) index -= 1;
}

function next() {
  index += 1;
}

async function reveal() {
  if (!current || current.status === 'answered') return;
  await answerQuiz('math', current.item.id);
  items[index] = { ...current, status: 'answered' };
}

async function submitFeedback(feedback: Parameters<typeof sendFeedback>[2]) {
  if (!current) return;
  await sendFeedback('math', current.item.id, feedback);
  items[index] = {
    ...current,
    feedback: {
      difficulty: feedback.difficulty ?? null,
      reaction: feedback.reaction ?? null,
      notes: feedback.notes ?? null,
    },
  };
}
</script>

<div class="mx-auto flex max-w-md flex-col gap-4 p-4" use:swipeNav={{ onSwipeRight: goBack }}>
  {#if loading}
    <p class="text-center text-gray-500">Loading…</p>
  {:else if error}
    <p class="text-center text-red-600">{error}</p>
  {:else if !current}
    <div class="mt-16 text-center">
      <p class="text-xl font-semibold">You've completed today's math problems!</p>
      <p class="mt-2 text-gray-500">Swipe right to review a past problem.</p>
    </div>
  {:else}
    <div class="text-xs text-gray-400">
      {index + 1} / {items.length} · {current.item.tier} · {current.item.domain}
    </div>

    <div class="rounded-2xl border border-gray-200 p-4 dark:border-gray-700">
      <Latex text={current.item.promptLatex} class="text-lg" />
    </div>

    {#if current.status !== 'answered'}
      <div class="flex flex-col gap-2">
        {#each current.item.hints as hint (hint)}
          <details class="rounded-xl border border-gray-200 p-3 text-sm dark:border-gray-700">
            <summary class="cursor-pointer text-gray-500">Hint</summary>
            <div class="mt-2"><Latex text={hint} /></div>
          </details>
        {/each}
      </div>

      <p class="text-center text-sm text-gray-500">Work it out on paper, then reveal the solution.</p>
      <button type="button" class="rounded-xl bg-blue-600 py-3 font-medium text-white" onclick={reveal}>
        Reveal solution
      </button>
    {:else}
      <div class="rounded-xl bg-gray-50 p-3 text-sm dark:bg-gray-800">
        <p class="font-semibold">Final answer:</p>
        <Latex text={current.item.finalAnswer} />
      </div>

      <div class="flex flex-col gap-2">
        {#each current.item.stepByStepSolutionLatex as step, i (i)}
          <div class="rounded-xl border border-gray-200 p-3 text-sm dark:border-gray-700">
            <Latex text={step} />
          </div>
        {/each}
      </div>

      {#key current.item.id}
        <FeedbackControl feedback={current.feedback} onSubmit={submitFeedback} />
      {/key}

      <button type="button" class="rounded-xl bg-blue-600 py-3 font-medium text-white" onclick={next}> Next </button>
    {/if}
  {/if}
</div>
