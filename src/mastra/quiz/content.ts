import type { MathProblem, TriviaCard } from '../schemas/quiz';
import { listMathEntries, listTriviaEntries } from './content-db';

// Both trivia decks and math problems live in the content database (see
// content-db.ts); the old content/*.json files only seed an empty database.
export async function listMathProblems(): Promise<MathProblem[]> {
  return listMathEntries();
}

export async function listTriviaCards(): Promise<TriviaCard[]> {
  return (await listTriviaEntries()).map(e => e.card);
}

export async function getMathProblemById(id: string): Promise<MathProblem | undefined> {
  return (await listMathProblems()).find(p => p.id === id);
}

export async function getTriviaCardById(id: string): Promise<TriviaCard | undefined> {
  return (await listTriviaCards()).find(c => c.id === id);
}

// Pure and synchronous so a caller assigning many items in one batch (e.g.
// content-creation's batch builders) can push each pick into `used` before
// the next call, spreading a whole batch across under-represented values
// instead of drawing independently from the same pre-batch snapshot each
// time. Looking at the whole content library (not just the current batch)
// also means breadth is enforced over time, not just within one run.
export function pickLeastUsed<T extends string>(values: readonly T[], used: readonly T[]): T {
  const counts = new Map<T, number>(values.map(v => [v, 0]));
  for (const v of used) counts.set(v, (counts.get(v) ?? 0) + 1);

  const minCount = Math.min(...counts.values());
  const leastUsed = values.filter(v => counts.get(v) === minCount);
  return leastUsed[Math.floor(Math.random() * leastUsed.length)];
}
