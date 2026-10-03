<script lang="ts">
import {
  answerQuiz,
  listQuiz,
  type QuizListItem,
  sendFeedback,
  skipQuiz,
  type TriviaCard,
} from './lib/api';
import FeedbackControl from './lib/FeedbackControl.svelte';
import Latex from './lib/Latex.svelte';
import { seededShuffle } from './lib/shuffle';
import { swipeNav } from './lib/swipeNav';
import TriviaQuestion from './lib/TriviaQuestion.svelte';

let items = $state<QuizListItem<TriviaCard>[]>([]);
let index = $state(0);
let loading = $state(true);
let error = $state<string | null>(null);
// Only relevant right after the user clicks an option this session — drives
// the correct/wrong flash. Reset whenever the index changes.
let justAnswered = $state<{ correct: boolean } | null>(null);

const current = $derived(items[index]);
const options = $derived(
  current
    ? seededShuffle(
        [current.item.correctAnswer, ...current.item.distractors],
        current.item.id,
      )
    : [],
);

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

function goBack() {
  if (index > 0) {
    index -= 1;
    justAnswered = null;
  }
}

function next() {
  index += 1;
  justAnswered = null;
}

async function choose(option: string) {
  if (!current || current.status === 'answered') return;
  const result = await answerQuiz('trivia', current.item.id, option);
  items[index] = {
    ...current,
    status: 'answered',
    chosenAnswer: option,
    correct: result.correct,
  };
  justAnswered = { correct: result.correct ?? false };
}

async function skip() {
  if (!current) return;
  await skipQuiz('trivia', current.item.id);
  items[index] = { ...current, status: 'skipped' };
  next();
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

<div class="mx-auto flex max-w-md flex-col gap-4 p-4" use:swipeNav={{ onSwipeRight: goBack }}>
  {#if loading}
    <p class="text-center text-gray-500">Loading…</p>
  {:else if error}
    <p class="text-center text-red-600">{error}</p>
  {:else if !current}
    <div class="mt-16 text-center">
      <p class="text-xl font-semibold">You've completed today's trivia!</p>
      <p class="mt-2 text-gray-500">Swipe right to review a past question.</p>
    </div>
  {:else}
    <div class="text-xs text-gray-400">
      {index + 1} / {items.length} · {current.item.category}
    </div>

    <div class="rounded-2xl border border-gray-200 p-4 dark:border-gray-700">
      <TriviaQuestion segments={current.item.question} />
    </div>

    <div class="flex flex-col gap-2">
      {#each options as option (option)}
        {@const isChosen = current.chosenAnswer === option}
        {@const isCorrectOption = option === current.item.correctAnswer}
        {@const answered = current.status === 'answered'}
        <button
          type="button"
          disabled={answered}
          class="rounded-xl border px-4 py-3 text-left transition-colors disabled:cursor-default"
          class:bg-green-100={answered && isCorrectOption}
          class:border-green-500={answered && isCorrectOption}
          class:bg-red-100={answered && isChosen && !isCorrectOption}
          class:border-red-500={answered && isChosen && !isCorrectOption}
          class:dark:bg-green-900={answered && isCorrectOption}
          class:dark:bg-red-900={answered && isChosen && !isCorrectOption}
          onclick={() => choose(option)}
        >
          <Latex text={option} />
        </button>
      {/each}
    </div>

    {#if current.status === 'unanswered'}
      <button type="button" class="self-center text-sm text-gray-400 underline" onclick={skip}> Skip </button>
    {/if}

    {#if current.status === 'answered'}
      {#if justAnswered}
        {#key index}
          <div
            class="rounded-xl p-3 text-center font-semibold"
            class:bg-green-100={justAnswered.correct}
            class:text-green-800={justAnswered.correct}
            class:bg-red-100={!justAnswered.correct}
            class:text-red-800={!justAnswered.correct}
          >
            {justAnswered.correct ? 'Correct! 🎉' : 'Not quite.'}
          </div>
        {/key}
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

      {#key current.item.id}
        <FeedbackControl feedback={current.feedback} onSubmit={submitFeedback} />
      {/key}

      <button type="button" class="rounded-xl bg-blue-600 py-3 font-medium text-white" onclick={next}> Next </button>
    {:else if current.status === 'skipped'}
      {#key current.item.id}
        <FeedbackControl feedback={current.feedback} onSubmit={submitFeedback} />
      {/key}
    {/if}
  {/if}
</div>
