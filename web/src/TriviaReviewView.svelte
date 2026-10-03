<script lang="ts">
import {
  listQuiz,
  type QuizListItem,
  sendFeedback,
  type TriviaCard,
} from './lib/api';
import FeedbackControl from './lib/FeedbackControl.svelte';
import Latex from './lib/Latex.svelte';
import { swipeNav } from './lib/swipeNav';
import TriviaQuestion from './lib/TriviaQuestion.svelte';

let items = $state<QuizListItem<TriviaCard>[]>([]);
let index = $state(0);
let loading = $state(true);
let error = $state<string | null>(null);

const current = $derived(items[index]);

$effect(() => {
  listQuiz<TriviaCard>('trivia')
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

function prev() {
  if (index > 0) index -= 1;
}

function next() {
  if (index < items.length - 1) index += 1;
}

async function submitFeedback(feedback: Parameters<typeof sendFeedback>[2]) {
  if (!current) return;
  await sendFeedback('trivia', current.item.id, feedback);
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

<div
  class="mx-auto flex max-w-md flex-col gap-4 p-4"
  use:swipeNav={{ onSwipeRight: prev, onSwipeLeft: next }}
>
  {#if loading}
    <p class="text-center text-gray-500">Loading…</p>
  {:else if error}
    <p class="text-center text-red-600">{error}</p>
  {:else if !current}
    <p class="mt-16 text-center text-gray-500">No trivia cards yet.</p>
  {:else}
    <div class="flex items-center justify-between text-xs text-gray-400">
      <span>{index + 1} / {items.length}</span>
      <span>{current.item.category} · elo {current.item.eloRating}</span>
    </div>

    <div class="rounded-2xl border border-gray-200 p-4 dark:border-gray-700">
      <TriviaQuestion segments={current.item.question} />
    </div>

    <div class="flex flex-col gap-2">
      <div class="rounded-xl border border-green-500 bg-green-100 px-4 py-3 dark:bg-green-900">
        <Latex text={current.item.correctAnswer} />
      </div>
      {#each current.item.distractors as distractor (distractor)}
        <div class="rounded-xl border border-gray-200 px-4 py-3 text-gray-500 dark:border-gray-700 dark:text-gray-400">
          <Latex text={distractor} />
        </div>
      {/each}
    </div>

    {#if current.item.acceptableAlternatives.length > 0}
      <p class="text-xs text-gray-400">
        Also accepted: {current.item.acceptableAlternatives.join(' · ')}
      </p>
    {/if}

    <div class="rounded-xl bg-gray-50 p-3 text-sm dark:bg-gray-800">
      <Latex text={current.item.explanation} />
      <a
        href={current.item.learnMoreArticle}
        target="_blank"
        rel="noreferrer"
        class="mt-2 block text-blue-600 underline">Learn more</a
      >
    </div>

    <details class="rounded-xl border border-gray-200 p-3 text-sm dark:border-gray-700">
      <summary class="cursor-pointer font-medium text-gray-500 dark:text-gray-400">Hints</summary>
      <ol class="mt-2 flex list-decimal flex-col gap-2 pl-5">
        {#each current.item.hints as hint (hint)}
          <li><Latex text={hint} /></li>
        {/each}
      </ol>
    </details>

    {#key current.item.id}
      <FeedbackControl feedback={current.feedback} startOpen onSubmit={submitFeedback} />
    {/key}

    <div class="flex items-center justify-between">
      <button
        type="button"
        class="text-sm text-gray-400 underline disabled:opacity-40"
        disabled={index === 0}
        onclick={prev}>‹ Prev</button
      >
      <button
        type="button"
        class="text-sm text-gray-400 underline disabled:opacity-40"
        disabled={index >= items.length - 1}
        onclick={next}>Next ›</button
      >
    </div>
  {/if}
</div>
