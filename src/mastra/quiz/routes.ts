import { createRoute } from '@mastra/server/server-adapter';
import { z } from 'zod';
import { MathProblemSchema, TriviaCardSchema } from '../schemas/quiz';
import { getFeedbackForKind, getProgressForKind, recordFeedback, recordProgress, resetProgress } from './db';
import { getMathProblemById, getTriviaCardById, listMathProblems } from './content';
import { listDecks, listTriviaEntries } from './content-db';
import { adminApiRoutes } from './admin-routes';
import { createApiRoutes } from './create-routes';

const KindParamSchema = z.object({ kind: z.enum(['math', 'trivia']) });
const KindItemParamSchema = z.object({ kind: z.enum(['math', 'trivia']), itemId: z.string() });

const FeedbackEnvelopeSchema = z.object({
  difficulty: z.enum(['too_easy', 'too_hard']).nullable(),
  reaction: z.enum(['not_fun', 'standout']).nullable(),
  notes: z.string().nullable(),
});

const DeckRefSchema = z.object({ id: z.string(), name: z.string(), domain: z.string() });

const ProvenanceSchema = z.object({
  runId: z.string(),
  generator: z.string(),
  attempts: z.number(),
  reviewers: z.array(z.object({ model: z.string(), passed: z.boolean(), issues: z.array(z.string()) })),
  approvedAt: z.string(),
});

const QuizListItemSchema = z.object({
  item: z.union([MathProblemSchema, TriviaCardSchema]),
  // Who wrote and checked a trivia card; null for cards that predate tracking.
  provenance: ProvenanceSchema.nullable(),
  // Trivia cards belong to a deck; math problems don't (yet).
  deck: DeckRefSchema.nullable(),
  status: z.enum(['unanswered', 'answered', 'skipped']),
  chosenAnswer: z.string().nullable(),
  correct: z.boolean().nullable(),
  feedback: FeedbackEnvelopeSchema.nullable(),
});

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

const listQuizRoute = createRoute({
  method: 'GET',
  path: '/quiz/:kind',
  responseType: 'json',
  pathParamSchema: KindParamSchema,
  responseSchema: z.object({ items: z.array(QuizListItemSchema) }),
  summary: 'List quiz content for a kind, annotated with progress and feedback',
  tags: ['Quiz'],
  requiresAuth: false,
  handler: async ({ kind }) => {
    const [entries, progress, feedback] = await Promise.all([
      kind === 'math'
        ? listMathProblems().then(items => items.map(item => ({ item, deck: null, provenance: null })))
        : listTriviaEntries().then(items => items.map(e => ({ item: e.card, deck: e.deck, provenance: e.provenance }))),
      getProgressForKind(kind),
      getFeedbackForKind(kind),
    ]);

    return {
      items: entries.map(({ item, deck, provenance }) => {
        const p = progress.get(item.id);
        const f = feedback.get(item.id);
        return {
          item,
          deck,
          provenance,
          status: p?.status ?? ('unanswered' as const),
          chosenAnswer: p?.chosenAnswer ?? null,
          correct: p?.correct ?? null,
          feedback: f ? { difficulty: f.difficulty, reaction: f.reaction, notes: f.notes } : null,
        };
      }),
    };
  },
});

const DeckSchema = z.object({
  id: z.string(),
  name: z.string(),
  domain: z.string(),
  description: z.string().nullable(),
  createdAt: z.string(),
  cardCount: z.number(),
});

const listDecksRoute = createRoute({
  method: 'GET',
  path: '/quiz/trivia/decks',
  responseType: 'json',
  responseSchema: z.object({ decks: z.array(DeckSchema) }),
  summary: 'List trivia decks with their domain and card count',
  tags: ['Quiz'],
  requiresAuth: false,
  handler: async () => ({ decks: await listDecks() }),
});

const answerQuizRoute = createRoute({
  method: 'POST',
  path: '/quiz/:kind/:itemId/answer',
  responseType: 'json',
  pathParamSchema: KindItemParamSchema,
  bodySchema: z.object({ chosenAnswer: z.string().optional() }),
  responseSchema: z.object({ success: z.boolean(), correct: z.boolean().nullable() }),
  summary: 'Record an answer for a quiz item',
  tags: ['Quiz'],
  requiresAuth: false,
  handler: async ({ kind, itemId, chosenAnswer }) => {
    if (kind === 'trivia') {
      if (!chosenAnswer) throw new Error('chosenAnswer is required for trivia answers.');
      const card = await getTriviaCardById(itemId);
      if (!card) throw new Error(`No trivia card found with id "${itemId}".`);

      const normalizedChoice = normalize(chosenAnswer);
      const correct =
        normalize(card.correctAnswer) === normalizedChoice ||
        card.acceptableAlternatives.some(alt => normalize(alt) === normalizedChoice);

      await recordProgress({ itemId, kind, status: 'answered', chosenAnswer, correct });
      return { success: true, correct };
    }

    const problem = await getMathProblemById(itemId);
    if (!problem) throw new Error(`No math problem found with id "${itemId}".`);

    await recordProgress({ itemId, kind, status: 'answered' });
    return { success: true, correct: null };
  },
});

const skipQuizRoute = createRoute({
  method: 'POST',
  path: '/quiz/:kind/:itemId/skip',
  responseType: 'json',
  pathParamSchema: KindItemParamSchema,
  responseSchema: z.object({ success: z.boolean() }),
  summary: 'Mark a quiz item as skipped',
  tags: ['Quiz'],
  requiresAuth: false,
  handler: async ({ kind, itemId }) => {
    await recordProgress({ itemId, kind, status: 'skipped' });
    return { success: true };
  },
});

const feedbackQuizRoute = createRoute({
  method: 'POST',
  path: '/quiz/:kind/:itemId/feedback',
  responseType: 'json',
  pathParamSchema: KindItemParamSchema,
  bodySchema: z.object({
    difficulty: z.enum(['too_easy', 'too_hard']).nullable().optional(),
    reaction: z.enum(['not_fun', 'standout']).nullable().optional(),
    notes: z.string().nullable().optional(),
  }),
  responseSchema: z.object({ success: z.boolean() }),
  summary: 'Record feedback for a quiz item',
  tags: ['Quiz'],
  requiresAuth: false,
  handler: async ({ kind, itemId, difficulty, reaction, notes }) => {
    await recordFeedback({ itemId, kind, difficulty, reaction, notes });
    return { success: true };
  },
});

const resetQuizRoute = createRoute({
  method: 'POST',
  path: '/quiz/reset',
  responseType: 'json',
  bodySchema: z.object({ kind: z.enum(['math', 'trivia']).optional() }),
  responseSchema: z.object({ success: z.boolean() }),
  summary: 'Reset progress and feedback (all, or just one kind)',
  tags: ['Quiz'],
  requiresAuth: false,
  handler: async ({ kind }) => {
    await resetProgress({ kind });
    return { success: true };
  },
});

export const quizApiRoutes = [...adminApiRoutes, ...createApiRoutes, listQuizRoute, listDecksRoute, answerQuizRoute, skipQuizRoute, feedbackQuizRoute, resetQuizRoute];
