<script lang="ts">
import type { Deck, QuizListItem, TriviaCard } from './api';
import { ALL_DECKS, type DeckFilter, domainLabel } from './deckFilter';

let {
  decks,
  items,
  value,
  onPick,
}: {
  decks: Deck[];
  items: QuizListItem<TriviaCard>[];
  value: DeckFilter;
  onPick: (v: DeckFilter) => void;
} = $props();

const ICONS: Record<string, string> = {
  math: '➗',
  science: '🔬',
  nature: '🌿',
  'history-geography': '🌍',
  technology: '💻',
  games: '🎮',
  entertainment: '🎬',
  sports: '⚽',
  arts: '🎨',
  general: '✨',
};

const domains = $derived([...new Set(decks.map((d) => d.domain))].sort());

function played(deckId: string) {
  return items.filter((i) => i.deck?.id === deckId && i.status !== 'unanswered')
    .length;
}

function playedInDomain(domain: string) {
  return items.filter(
    (i) => i.deck?.domain === domain && i.status !== 'unanswered',
  ).length;
}

const icon = (domain: string) => ICONS[domain] ?? '🃏';
const totalPlayed = $derived(
  items.filter((i) => i.status !== 'unanswered').length,
);
</script>

<div class="flex flex-col gap-4 rounded-2xl border border-gray-200 p-3 dark:border-gray-700">
  <button
    type="button"
    class="flex items-center justify-between rounded-xl border px-4 py-3 text-left {value === ALL_DECKS
      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
      : 'border-gray-200 dark:border-gray-700'}"
    onclick={() => onPick(ALL_DECKS)}
  >
    <span class="font-medium">🎲 All decks, shuffled</span>
    <span class="text-xs text-gray-500">{totalPlayed} / {items.length} played</span>
  </button>

  {#each domains as domain (domain)}
    {@const inDomain = decks.filter((d) => d.domain === domain)}
    {@const domainTotal = inDomain.reduce((n, d) => n + d.cardCount, 0)}
    <section class="flex flex-col gap-2">
      <button
        type="button"
        class="flex items-center justify-between text-left"
        onclick={() => onPick(`domain:${domain}`)}
      >
        <h3 class="font-medium {value === `domain:${domain}` ? 'text-blue-600' : ''}">
          {icon(domain)} {domainLabel(domain)}
        </h3>
        <span class="text-xs text-gray-500">play all · {playedInDomain(domain)} / {domainTotal}</span>
      </button>
      <div class="grid grid-cols-2 gap-2">
        {#each inDomain as deck (deck.id)}
          {@const done = played(deck.id)}
          <button
            type="button"
            class="flex flex-col gap-1 rounded-xl border p-3 text-left {value === `deck:${deck.id}`
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
              : 'border-gray-200 dark:border-gray-700'}"
            onclick={() => onPick(`deck:${deck.id}`)}
          >
            <span class="text-2xl" aria-hidden="true">{icon(deck.domain)}</span>
            <span class="text-sm font-medium">{deck.name}</span>
            <span class="text-xs text-gray-500">{done} / {deck.cardCount} played</span>
            <span class="h-1 overflow-hidden rounded bg-gray-200 dark:bg-gray-700">
              <span
                class="block h-full bg-green-500"
                style="width: {deck.cardCount ? (100 * done) / deck.cardCount : 0}%"
              ></span>
            </span>
          </button>
        {/each}
      </div>
    </section>
  {/each}
</div>
