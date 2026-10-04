import type { Deck, DeckRef } from './api';

// A filter is stored as a string so it fits in a <select> value and
// localStorage: 'all', 'domain:<domain>', or 'deck:<deckId>'.
export type DeckFilter = string;

export const ALL_DECKS: DeckFilter = 'all';

const STORAGE_KEY = 'sprout-deck-filter';

export function matchesFilter(
  deck: DeckRef | null,
  filter: DeckFilter,
): boolean {
  if (filter === ALL_DECKS || !deck) return true;
  if (filter.startsWith('domain:'))
    return deck.domain === filter.slice('domain:'.length);
  if (filter.startsWith('deck:'))
    return deck.id === filter.slice('deck:'.length);
  return true;
}

// Drops a stored filter whose deck/domain no longer exists, so a deleted deck
// can't leave the quiz permanently empty.
export function validFilter(filter: DeckFilter, decks: Deck[]): DeckFilter {
  if (
    filter.startsWith('domain:') &&
    decks.some((d) => `domain:${d.domain}` === filter)
  )
    return filter;
  if (
    filter.startsWith('deck:') &&
    decks.some((d) => `deck:${d.id}` === filter)
  )
    return filter;
  return ALL_DECKS;
}

export function loadFilter(): DeckFilter {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? ALL_DECKS;
  } catch {
    return ALL_DECKS;
  }
}

export function saveFilter(filter: DeckFilter) {
  try {
    localStorage.setItem(STORAGE_KEY, filter);
  } catch {
    // Storage can be unavailable (private mode); the filter just won't persist.
  }
}

// Stable per-browser seed so the shuffled order survives a reload instead of
// reshuffling and changing which card comes next.
export function shuffleSeed(): string {
  const key = 'sprout-shuffle-seed';
  try {
    let seed = localStorage.getItem(key);
    if (!seed) {
      seed = Math.random().toString(36).slice(2);
      localStorage.setItem(key, seed);
    }
    return seed;
  } catch {
    return 'default';
  }
}

const DOMAIN_LABELS: Record<string, string> = {
  'history-geography': 'History & Geography',
};

export function domainLabel(domain: string): string {
  return (
    DOMAIN_LABELS[domain] ??
    domain
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
  );
}
