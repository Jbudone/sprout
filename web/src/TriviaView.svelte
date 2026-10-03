<script lang="ts">
import {
  answerQuiz,
  type Deck,
  listDecks,
  listQuiz,
  type QuizListItem,
  sendFeedback,
  skipQuiz,
  type TriviaCard,
} from './lib/api';
import DeckPicker from './lib/DeckPicker.svelte';
import {
  loadFilter,
  matchesFilter,
  saveFilter,
  shuffleSeed,
  validFilter,
} from './lib/deckFilter';
import FeedbackControl from './lib/FeedbackControl.svelte';
import Latex from './lib/Latex.svelte';
import Provenance from './lib/Provenance.svelte';
import { seededShuffle } from './lib/shuffle';
import { swipeNav } from './lib/swipeNav';
import TriviaQuestion from './lib/TriviaQuestion.svelte';

let allItems = $state<QuizListItem<TriviaCard>[]>([]);
let decks = $state<Deck[]>([]);
let filter = $state(loadFilter());
// The shuffled, filtered play queue. Built once per load/filter change (not
// derived) so answering a card doesn't reshuffle the queue under the user.
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

// Cards from every deck, shuffled with a stable seed, narrowed to the picked
// deck or domain. Starts at the first card not yet answered or skipped.
function buildQueue() {
  items = seededShuffle(
    allItems.filter((i) => matchesFilter(i.deck, filter)),
    shuffleSeed(),
  );
  const firstOpen = items.findIndex((i) => i.status === 'unanswered');
  index = firstOpen === -1 ? items.length : firstOpen;
  justAnswered = null;
}

// Writes an updated card to the play queue and to the unfiltered list, so
// progress survives switching decks.
function setCurrent(next: QuizListItem<TriviaCard>) {
  items[index] = next;
  const i = allItems.findIndex((a) => a.item.id === next.item.id);
  if (i !== -1) allItems[i] = next;
}

function changeFilter(next: string) {
  filter = next;
  saveFilter(next);
  buildQueue();
}

$effect(() => {
  Promise.all([listQuiz<TriviaCard>('trivia'), listDecks()])
    .then(([res, deckRes]) => {
      allItems = res.items;
      decks = deckRes.decks;
      filter = validFilter(filter, decks);
      buildQueue();
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
  setCurrent({
    ...current,
    status: 'answered',
    chosenAnswer: option,
    correct: result.correct,
  });
  justAnswered = { correct: result.correct ?? false };
}

async function skip() {
  if (!current) return;
  await skipQuiz('trivia', current.item.id);
  setCurrent({ ...current, status: 'skipped' });
  next();
}

async function submitFeedback(feedback: Parameters<typeof sendFeedback>[2]) {
  if (!current) return;
  await sendFeedback('trivia', current.item.id, feedback);
  setCurrent({
    ...current,
    feedback: {
      difficulty: feedback.difficulty ?? null,
      reaction: feedback.reaction ?? null,
      notes: feedback.notes ?? null,
    },
  });
}
</script>

<div class="mx-auto flex max-w-md flex-col gap-4 p-4" use:swipeNav={{ onSwipeRight: goBack }}>
  {#if decks.length > 0}
    <DeckPicker {decks} value={filter} onChange={changeFilter} />
  {/if}

  {#if loading}
    <p class="text-center text-gray-500">Loading…</p>
  {:else if error}
    <p class="text-center text-red-600">{error}</p>
  {:else if !current}
    <div class="mt-16 text-center">
      <p class="text-xl font-semibold">You've played every card here!</p>
      <p class="mt-2 text-gray-500">Swipe right to review a past question.</p>
    </div>
  {:else}
    <div class="text-xs text-gray-400">
      {index + 1} / {items.length} · {current.deck?.name ?? current.item.category}
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

      <Provenance provenance={current.provenance} />

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
