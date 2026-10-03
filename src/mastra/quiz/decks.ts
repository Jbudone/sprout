import type { TriviaCategory } from '../schemas/quiz';

// Suggested domains, not an enforced list: a deck's domain is free text so a
// new deck (e.g. "Zelda") can introduce a new domain (e.g. "games") without a
// code change. These cover the decks migrated from the old category files.
export const SUGGESTED_DECK_DOMAINS = [
  'math',
  'science',
  'nature',
  'history-geography',
  'technology',
  'games',
  'entertainment',
  'sports',
  'arts',
  'general',
] as const;

// Used when migrating the original category-based cards into decks, and as the
// default deck for workflows that don't name one yet.
export const CATEGORY_DEFAULT_DOMAIN: Record<TriviaCategory, string> = {
  'history-of-math': 'math',
  'famous-theorems': 'math',
  mathematicians: 'math',
  'notation-and-symbols': 'math',
  'applied-math': 'math',
  'math-in-culture': 'math',
  geography: 'history-geography',
  history: 'history-geography',
  biology: 'science',
  chemistry: 'science',
  science: 'science',
  geology: 'science',
  technology: 'technology',
  animals: 'nature',
  botany: 'nature',
  gemology: 'nature',
  'fun-facts': 'general',
  'video-games': 'games',
  'pop-culture': 'entertainment',
  sports: 'sports',
  'art-and-music': 'arts',
  literature: 'arts',
  'food-and-drink': 'general',
};

export function titleCase(slug: string): string {
  return slug
    .split('-')
    .map(w => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
