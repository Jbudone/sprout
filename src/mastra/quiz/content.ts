import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { MathProblemSchema, TriviaCardSchema, type MathProblem, type TriviaCard } from '../schemas/quiz';
import { getRepoRoot } from '../utils/repo-root';
import type { QuizKind } from './db';

const FILENAME_PATTERN = /^week-(\d+)-(\d+)\.json$/;

async function listContentFiles(kind: QuizKind): Promise<string[]> {
  const dir = path.join(await getRepoRoot(), 'content', kind);
  const files = await readdir(dir).catch(() => [] as string[]);

  return files
    .map(name => ({ name, match: name.match(FILENAME_PATTERN) }))
    .filter((f): f is { name: string; match: RegExpMatchArray } => f.match !== null)
    .sort((a, b) => {
      const [, weekA, indexA] = a.match;
      const [, weekB, indexB] = b.match;
      return Number(weekA) - Number(weekB) || Number(indexA) - Number(indexB);
    })
    .map(f => path.join(dir, f.name));
}

export async function listMathProblems(): Promise<MathProblem[]> {
  const files = await listContentFiles('math');
  return Promise.all(files.map(async f => MathProblemSchema.parse(JSON.parse(await readFile(f, 'utf-8')))));
}

export async function listTriviaCards(): Promise<TriviaCard[]> {
  const files = await listContentFiles('trivia');
  return Promise.all(files.map(async f => TriviaCardSchema.parse(JSON.parse(await readFile(f, 'utf-8')))));
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
