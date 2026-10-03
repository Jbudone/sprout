// Deterministic shuffle seeded by the item id, so swiping back to review a
// trivia question later shows the options in the same order as before.
export function seededShuffle<T>(items: T[], seed: string): T[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++)
    h = (Math.imul(h, 31) + seed.charCodeAt(i)) | 0;

  function next(): number {
    h = (Math.imul(h, 1664525) + 1013904223) | 0;
    return (h >>> 0) / 4294967296;
  }

  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
