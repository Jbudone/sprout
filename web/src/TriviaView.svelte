<script lang="ts">
import { untrack } from 'svelte';
import {
  answerQuiz,
  type Deck,
  listDecks,
  listQuiz,
  listRatings,
  type QuizListItem,
  type RatingChange,
  sendFeedback,
  skipQuiz,
  type TriviaCard,
} from './lib/api';
import DeckBrowser from './lib/DeckBrowser.svelte';
import DeckPicker from './lib/DeckPicker.svelte';
import {
  loadFilter,
  matchesFilter,
  saveFilter,
  shuffleSeed,
  validFilter,
} from './lib/deckFilter';
import FeedbackControl from './lib/FeedbackControl.svelte';
import { FeedbackState } from './lib/feedbackState.svelte';
import { optionTarget } from './lib/feedbackReasons';
import FlagToggle from './lib/FlagToggle.svelte';
import HintLadder from './lib/HintLadder.svelte';
import Latex from './lib/Latex.svelte';
import Provenance from './lib/Provenance.svelte';
import { seededShuffle } from './lib/shuffle';
import { swipeNav } from './lib/swipeNav';
import TriviaQuestion from './lib/TriviaQuestion.svelte';
import LevelChip from './lib/LevelChip.svelte';
import { categoryLabel, feelFor, levelFor, START_RATING } from './lib/levels';

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
let browsing = $state(false);
let justAnswered = $state<{ correct: boolean; rating: RatingChange | null } | null>(null);
// Your Elo per category; a category you haven't answered yet sits at the start rating.
let ratings = $state<Record<string, number>>({});

const current = $derived(items[index]);
const playedCount = $derived(
  items.filter((i) => i.status !== 'unanswered').length,
);
// The feel of a card is judged against your rating *before* it was answered,
// so the badge doesn't change under you the moment you pick.
const feel = $derived(
  current
    ? feelFor(
        current.item.eloRating,
        justAnswered?.rating?.before ?? ratings[current.item.category] ?? START_RATING,
      )
    : null,
);
const levelUp = $derived.by(() => {
  const r = justAnswered?.rating;
  if (!r) return null;
  const now = levelFor(r.after);
  return now.index > levelFor(r.before).index ? now : null;
});
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
  browsing = false;
  filter = next;
  saveFilter(next);
  buildQueue();
}

$effect(() => {
  Promise.all([
    listQuiz<TriviaCard>('trivia'),
    listDecks(),
    listRatings().catch(() => ({ ratings: [] })),
  ])
    .then(([res, deckRes, ratingRes]) => {
      ratings = Object.fromEntries(ratingRes.ratings.map((r) => [r.category, r.rating]));
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
  justAnswered = { correct: result.correct ?? false, rating: result.rating };
  if (result.rating) ratings[result.rating.category] = result.rating.after;
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
      targets: feedback.targets ?? [],
      reasons: feedback.reasons ?? [],
    },
  });
}

// One feedback state per card, rebuilt only when the card changes (not on
// every save) so typing and chip toggles aren't reset by their own save.
let fb = $state<FeedbackState | null>(null);
$effect(() => {
  const id = current?.item.id;
  fb = id ? untrack(() => new FeedbackState(current?.feedback ?? null, submitFeedback)) : null;
});
</script>

<div class="mx-auto flex max-w-md flex-col gap-4 p-4" use:swipeNav={{ onSwipeRight: goBack }}>
  {#if decks.length > 0}
    <div class="flex items-end gap-2">
      <div class="min-w-0 flex-1"><DeckPicker {decks} value={filter} onChange={changeFilter} /></div>
      <button
        type="button"
        class="shrink-0 rounded-lg border border-gray-300 px-3 py-1 text-sm dark:border-gray-600"
        onclick={() => (browsing = !browsing)}
      >
        {browsing ? 'Close' : 'Decks'}
      </button>
    </div>
    {#if browsing}
      <DeckBrowser {decks} items={allItems} value={filter} onPick={changeFilter} />
    {/if}
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
    <div class="flex flex-col gap-1">
      <div class="flex justify-between text-xs text-gray-400">
        <span>{current.deck?.name ?? current.item.category}</span>
        <span>{index + 1} / {items.length}</span>
      </div>
      <div
        class="sp-track h-1 overflow-hidden rounded bg-gray-200 dark:bg-gray-700"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={items.length}
        aria-valuenow={playedCount}
        aria-label="Cards played in this queue"
      >
        <div class="h-full bg-blue-500 transition-all duration-500" style="width: {items.length ? (100 * playedCount) / items.length : 0}%"></div>
      </div>
    </div>

    <div class="flex items-center justify-between gap-2">
      <LevelChip category={current.item.category} rating={ratings[current.item.category] ?? START_RATING} />
      {#if feel}<span class="feel-badge feel-{feel.feel} shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold" title="Card elo {current.item.eloRating}">{feel.label}</span>{/if}
    </div>

    <div
      class="sp-card flex items-start gap-2 rounded-2xl border border-gray-200 p-4 dark:border-gray-700"
      class:feel-card-boss={feel?.feel === 'boss'}
      class:feel-card-stroll={feel?.feel === 'stroll'}
      class:anim-boom={justAnswered?.correct && feel?.feel === 'boss'}
    >
      <div class="min-w-0 flex-1"><TriviaQuestion segments={current.item.question} /></div>
      {#if fb && current.status !== 'unanswered'}<FlagToggle state={fb} target="question" />{/if}
    </div>

    <div class="flex flex-col gap-2">
      {#each options as option (option)}
        {@const isChosen = current.chosenAnswer === option}
        {@const isCorrectOption = option === current.item.correctAnswer}
        {@const answered = current.status === 'answered'}
        <div class="flex items-center gap-2">
          <button
            type="button"
            disabled={answered}
            class="sp-option min-w-0 flex-1 rounded-xl border px-4 py-3 text-left transition-colors disabled:cursor-default"
            class:anim-pop={justAnswered && isCorrectOption}
            class:anim-shake={justAnswered && isChosen && !isCorrectOption}
            class:opt-correct={answered && isCorrectOption}
            class:opt-wrong={answered && isChosen && !isCorrectOption}
            onclick={() => choose(option)}
          >
            <Latex text={option} />
            {#if answered && isCorrectOption}<span class="ml-2 text-xs font-semibold">✓ Correct answer</span>{/if}
            {#if answered && isChosen && !isCorrectOption}<span class="ml-2 text-xs font-semibold">✗ Your pick</span>{/if}
          </button>
          {#if fb && answered}<FlagToggle state={fb} target={optionTarget(option)} />{/if}
        </div>
      {/each}
    </div>

    {#if current.status === 'unanswered'}
      <HintLadder hints={current.item.hints} />
    {/if}

    {#if current.status === 'unanswered'}
      <button type="button" class="self-center text-sm text-gray-400 underline" onclick={skip}> Skip </button>
    {/if}

    {#if current.status === 'answered'}
      {#if justAnswered}
        {#key index}
          <div
            class="anim-rise rounded-xl p-3 text-center font-semibold"
            class:bg-green-100={justAnswered.correct}
            class:text-green-800={justAnswered.correct}
            class:bg-red-100={!justAnswered.correct}
            class:text-red-800={!justAnswered.correct}
          >
            {justAnswered.correct ? (feel?.feel === 'boss' ? 'Boss defeated! 🔥' : 'Correct! 🎉') : 'Not quite.'}
            {#if justAnswered.rating}
              <span class="ml-1 text-xs font-medium opacity-80">
                {justAnswered.rating.after >= justAnswered.rating.before ? '+' : '−'}{Math.abs(Math.round(justAnswered.rating.after - justAnswered.rating.before))}
              </span>
            {/if}
          </div>
          {#if levelUp}
            <div class="anim-bloom sp-card rounded-xl border border-gray-200 p-3 text-center font-semibold dark:border-gray-700">
              {levelUp.emoji} Level up! {categoryLabel(current.item.category)} is now {levelUp.name}
            </div>
          {/if}
        {/key}
      {/if}

      <div class="sp-card anim-rise flex items-start gap-2 rounded-xl bg-gray-50 p-3 text-sm dark:bg-gray-800">
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

      <HintLadder hints={current.item.hints} feedback={fb} showAll />

      <Provenance provenance={current.provenance} />

      {#if fb}<FeedbackControl state={fb} />{/if}

      <button type="button" class="sp-btn sp-primary rounded-xl bg-blue-600 py-3 font-medium text-white" onclick={next}> Next </button>
    {:else if current.status === 'skipped'}
      {#if fb}<FeedbackControl state={fb} />{/if}
    {/if}
  {/if}
</div>
