<script lang="ts">
import { untrack } from 'svelte';
import {
  listQuiz,
  type QuizListItem,
  sendFeedback,
  type TriviaCard,
} from './lib/api';
import FeedbackControl from './lib/FeedbackControl.svelte';
import { FeedbackState } from './lib/feedbackState.svelte';
import { optionTarget } from './lib/feedbackReasons';
import FlagToggle from './lib/FlagToggle.svelte';
import HintLadder from './lib/HintLadder.svelte';
import Latex from './lib/Latex.svelte';
import Provenance from './lib/Provenance.svelte';
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
      targets: feedback.targets ?? [],
      reasons: feedback.reasons ?? [],
    },
  };
}

let fb = $state<FeedbackState | null>(null);
$effect(() => {
  const id = current?.item.id;
  fb = id ? untrack(() => new FeedbackState(current?.feedback ?? null, submitFeedback)) : null;
});
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
      <span>{current.deck?.name ?? current.item.category} · elo {current.item.eloRating}</span>
    </div>

    <div class="sp-card flex items-start gap-2 rounded-2xl border border-gray-200 p-4 dark:border-gray-700">
      <div class="min-w-0 flex-1"><TriviaQuestion segments={current.item.question} /></div>
      {#if fb}<FlagToggle state={fb} target="question" />{/if}
    </div>

    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-2">
        <div class="sp-option opt-correct min-w-0 flex-1 rounded-xl border border-green-500 bg-green-100 px-4 py-3 dark:bg-green-900">
          <Latex text={current.item.correctAnswer} /><span class="ml-2 text-xs font-semibold">✓ Correct answer</span>
        </div>
        {#if fb}<FlagToggle state={fb} target={optionTarget(current.item.correctAnswer)} />{/if}
      </div>
      {#each current.item.distractors as distractor (distractor)}
        <div class="flex items-center gap-2">
          <div class="sp-option min-w-0 flex-1 rounded-xl border border-gray-200 px-4 py-3 text-gray-500 dark:border-gray-700 dark:text-gray-400">
            <Latex text={distractor} />
          </div>
          {#if fb}<FlagToggle state={fb} target={optionTarget(distractor)} />{/if}
        </div>
      {/each}
    </div>

    {#if current.item.acceptableAlternatives.length > 0}
      <p class="text-xs text-gray-400">
        Also accepted: {current.item.acceptableAlternatives.join(' · ')}
      </p>
    {/if}

    <div class="sp-card flex items-start gap-2 rounded-xl bg-gray-50 p-3 text-sm dark:bg-gray-800">
      <div class="min-w-0 flex-1">
      <Latex text={current.item.explanation} />
      <a
        href={current.item.learnMoreArticle}
        target="_blank"
        rel="noreferrer"
        class="mt-2 block text-blue-600 underline">Learn more</a
      >
      </div>
      {#if fb}<FlagToggle state={fb} target="explanation" />{/if}
    </div>

    <Provenance provenance={current.provenance} />

    <HintLadder hints={current.item.hints} feedback={fb} showAll />

    {#if fb}<FeedbackControl state={fb} />{/if}

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
