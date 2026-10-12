// Category levels and card "feel", both derived from Elo ratings: the player's
// rating per category (stored server-side) against the card's own rating.
export const START_RATING = 1500;

export const LEVELS = [
  { name: 'Seedling', emoji: '🌱', min: -Infinity },
  { name: 'Sprout', emoji: '🌿', min: 1550 },
  { name: 'Sapling', emoji: '🪴', min: 1650 },
  { name: 'Grove', emoji: '🌳', min: 1750 },
] as const;

// The Seedling bar fills from here so a slump below 1500 still shows progress.
const FLOOR = 1400;

export type LevelInfo = {
  index: number;
  name: string;
  emoji: string;
  // 0..1 progress towards the next level (1 at the top level).
  progress: number;
  next: string | null;
};

export function levelFor(rating: number): LevelInfo {
  let index = 0;
  for (let i = 0; i < LEVELS.length; i++) if (rating >= LEVELS[i].min) index = i;
  const level = LEVELS[index];
  const next = LEVELS[index + 1];
  const from = index === 0 ? FLOOR : level.min;
  const progress = next ? Math.min(1, Math.max(0, (rating - from) / (next.min - from))) : 1;
  return { index, name: level.name, emoji: level.emoji, progress, next: next?.name ?? null };
}

export type Feel = 'stroll' | 'fair' | 'boss';

const FEEL_LABEL: Record<Feel, string> = {
  stroll: '🌿 Stroll',
  fair: '⚔️ Fair fight',
  boss: '🔥 Boss card',
};

// A card 100+ above your category rating is a stretch; 100+ below is easy.
export function feelFor(cardElo: number, rating: number): { feel: Feel; label: string } {
  const gap = cardElo - rating;
  const feel: Feel = gap >= 100 ? 'boss' : gap <= -100 ? 'stroll' : 'fair';
  return { feel, label: FEEL_LABEL[feel] };
}

export function categoryLabel(category: string): string {
  const words = category.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
