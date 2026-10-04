import { randomUUID } from 'node:crypto';
import { createRoute } from '@mastra/server/server-adapter';
import { z } from 'zod';
import { TriviaCardSchema } from '../schemas/quiz';
import { addTriviaCard, type Provenance } from './content-db';
import {
  BriefSchema,
  createRun,
  getSettings,
  monthToDateSpend,
  saveSettings,
  SettingsSchema,
  getPendingCard,
  getRun,
  listRunCards,
  listRuns,
  RunConfigSchema,
  setCardStatus,
} from './creation-db';
import { slugify } from './decks';
import { runGeneration } from './generate';
import { estimateRun } from './pricing';
import { computeStats } from './stats';
import { DEFAULT_GENERATOR, DEFAULT_REVIEWERS, MODEL_OPTIONS, providerAvailable, providerOf } from './models';

const ReviewerSchema = z.object({ model: z.string(), passed: z.boolean(), issues: z.array(z.string()) });
const CardStatusSchema = z.enum(['pending', 'approved', 'rejected', 'auto_rejected']);

const PendingCardSchema = z.object({
  id: z.string(),
  runId: z.string(),
  card: TriviaCardSchema,
  status: CardStatusSchema,
  rejectReason: z.string().nullable(),
  attempts: z.number(),
  reviewers: z.array(ReviewerSchema),
  issues: z.array(z.string()),
  createdAt: z.string(),
});

const RunSchema = z.object({
  id: z.string(),
  brief: BriefSchema,
  config: RunConfigSchema,
  status: z.enum(['running', 'done', 'failed']),
  error: z.string().nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});

const CountsSchema = z.record(z.string(), z.number());

const modelsRoute = createRoute({
  method: 'GET',
  path: '/quiz/create/models',
  responseType: 'json',
  responseSchema: z.object({
    models: z.array(z.object({ id: z.string(), label: z.string(), provider: z.string(), available: z.boolean() })),
    defaults: z.object({ generator: z.string(), reviewers: z.array(z.string()) }),
    openrouterConfigured: z.boolean(),
  }),
  summary: 'Models selectable for generation and review, and whether their API key is configured',
  tags: ['Create'],
  requiresAuth: false,
  handler: async () => ({
    models: MODEL_OPTIONS.map(m => ({ ...m, available: providerAvailable(m.provider) })),
    defaults: { generator: DEFAULT_GENERATOR, reviewers: DEFAULT_REVIEWERS },
    openrouterConfigured: providerAvailable('openrouter'),
  }),
});

const startRunRoute = createRoute({
  method: 'POST',
  path: '/quiz/create/runs',
  responseType: 'json',
  bodySchema: z.object({ brief: BriefSchema, config: RunConfigSchema }),
  responseSchema: z.object({ runId: z.string() }),
  summary: 'Start generating a deck of trivia cards from a brief. Returns immediately; poll the run for progress.',
  tags: ['Create'],
  requiresAuth: false,
  handler: async ({ brief, config }) => {
    // Fail fast when a chosen model's API key is missing, instead of burning a
    // whole run on errors.
    for (const model of [config.generator, ...config.reviewers]) {
      const provider = providerOf(model);
      if (provider !== 'other' && !providerAvailable(provider)) {
        throw new Error(
          `${model} needs ${provider === 'openrouter' ? 'OPENROUTER_API_KEY' : 'GOOGLE_GENERATIVE_AI_API_KEY'} in .env (then restart the dev server).`,
        );
      }
    }
    const [estimate, settings, monthSpend] = await Promise.all([
      estimateRun(brief.count, config),
      getSettings(),
      monthToDateSpend(),
    ]);
    if (estimate.worstCaseUsd > settings.perRunCapUsd) {
      throw new Error(
        `Worst case for this run is about $${estimate.worstCaseUsd.toFixed(2)}, over your $${settings.perRunCapUsd.toFixed(2)} per-run cap. Reduce cards, attempts or reviewers, pick cheaper models, or raise the cap in Stats.`,
      );
    }
    if (monthSpend + estimate.typicalUsd > settings.monthlyCapUsd) {
      throw new Error(
        `This month you have spent $${monthSpend.toFixed(2)} of your $${settings.monthlyCapUsd.toFixed(2)} cap, and this run would typically cost about $${estimate.typicalUsd.toFixed(2)} more. Raise the monthly cap in Stats to continue.`,
      );
    }
    const runId = randomUUID();
    await createRun(runId, brief, config);
    // Deliberately not awaited: generation takes minutes. runGeneration never throws.
    void runGeneration(runId, brief, config, slugify(brief.deckName));
    return { runId };
  },
});

const EstimateSchema = z.object({
  worstCaseUsd: z.number(),
  typicalUsd: z.number(),
  worstCaseCalls: z.number(),
  unpricedModels: z.array(z.string()),
  perRunCapUsd: z.number(),
  monthlyCapUsd: z.number(),
  monthToDateUsd: z.number(),
});

const estimateRoute = createRoute({
  method: 'POST',
  path: '/quiz/create/estimate',
  responseType: 'json',
  bodySchema: z.object({ count: z.number().int().min(1).max(30), config: RunConfigSchema }),
  responseSchema: EstimateSchema,
  summary: 'Estimated dollar cost of a run, next to the spend caps',
  tags: ['Create'],
  requiresAuth: false,
  handler: async ({ count, config }) => {
    const [estimate, settings, monthSpend] = await Promise.all([estimateRun(count, config), getSettings(), monthToDateSpend()]);
    return { ...estimate, perRunCapUsd: settings.perRunCapUsd, monthlyCapUsd: settings.monthlyCapUsd, monthToDateUsd: monthSpend };
  },
});

const getSettingsRoute = createRoute({
  method: 'GET',
  path: '/quiz/create/settings',
  responseType: 'json',
  responseSchema: SettingsSchema,
  summary: 'Spend caps',
  tags: ['Create'],
  requiresAuth: false,
  handler: async () => getSettings(),
});

const saveSettingsRoute = createRoute({
  method: 'POST',
  path: '/quiz/create/settings',
  responseType: 'json',
  bodySchema: SettingsSchema,
  responseSchema: SettingsSchema,
  summary: 'Update spend caps',
  tags: ['Create'],
  requiresAuth: false,
  handler: async ({ perRunCapUsd, monthlyCapUsd }) => {
    await saveSettings({ perRunCapUsd, monthlyCapUsd });
    return getSettings();
  },
});

const CallStatsSchema = z.object({
  model: z.string(),
  role: z.enum(['generator', 'reviewer']),
  calls: z.number(),
  failedCalls: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  costUsd: z.number(),
  estimatedShare: z.number(),
  avgLatencyMs: z.number(),
});

const statsRoute = createRoute({
  method: 'GET',
  path: '/quiz/stats/summary',
  responseType: 'json',
  responseSchema: z.object({
    settings: SettingsSchema,
    monthToDateUsd: z.number(),
    allTimeUsd: z.number(),
    calls: z.array(CallStatsSchema),
    generators: z.array(
      z.object({
        model: z.string(),
        runs: z.number(),
        cards: z.number(),
        passedReview: z.number(),
        approved: z.number(),
        rejected: z.number(),
        costUsd: z.number(),
        costPerApprovedUsd: z.number().nullable(),
      }),
    ),
    reviewers: z.array(
      z.object({
        model: z.string(),
        reviews: z.number(),
        passed: z.number(),
        decided: z.number(),
        agreed: z.number(),
        costUsd: z.number(),
      }),
    ),
    openrouter: z
      .object({
        totalCredits: z.number(),
        totalUsage: z.number(),
        remaining: z.number(),
        usageMonthly: z.number().nullable(),
      })
      .nullable(),
  }),
  summary: 'Model usage, cost and quality stats, spend against caps, and the OpenRouter balance',
  tags: ['Create'],
  requiresAuth: false,
  handler: async () => computeStats(),
});

const listRunsRoute = createRoute({
  method: 'GET',
  path: '/quiz/create/runs',
  responseType: 'json',
  responseSchema: z.object({ runs: z.array(RunSchema.extend({ counts: CountsSchema })) }),
  summary: 'Recent generation runs with card counts by status',
  tags: ['Create'],
  requiresAuth: false,
  handler: async () => ({ runs: await listRuns() }),
});

const getRunRoute = createRoute({
  method: 'GET',
  path: '/quiz/create/runs/:runId',
  responseType: 'json',
  pathParamSchema: z.object({ runId: z.string() }),
  responseSchema: z.object({ run: RunSchema, cards: z.array(PendingCardSchema) }),
  summary: 'One generation run and the cards it produced so far',
  tags: ['Create'],
  requiresAuth: false,
  handler: async ({ runId }) => {
    const run = await getRun(runId);
    if (!run) throw new Error(`No run with id "${runId}".`);
    return { run, cards: await listRunCards(runId) };
  },
});

async function approveCard(cardId: string): Promise<void> {
  const pending = await getPendingCard(cardId);
  if (!pending) throw new Error(`No pending card with id "${cardId}".`);
  if (pending.status === 'approved') throw new Error('Card is already approved.');
  if (pending.status === 'rejected') throw new Error('Card was rejected. Generate a new one instead.');
  const run = await getRun(pending.runId);
  if (!run) throw new Error('The run for this card no longer exists.');

  const provenance: Provenance = {
    runId: run.id,
    generator: run.config.generator,
    attempts: pending.attempts,
    reviewers: pending.reviewers,
    approvedAt: new Date().toISOString(),
  };
  await addTriviaCard(
    pending.card,
    { id: slugify(run.brief.deckName), name: run.brief.deckName, domain: run.brief.domain },
    provenance,
  );
  await setCardStatus(cardId, 'approved');
}

const approveRoute = createRoute({
  method: 'POST',
  path: '/quiz/create/cards/:cardId/approve',
  responseType: 'json',
  pathParamSchema: z.object({ cardId: z.string() }),
  responseSchema: z.object({ success: z.boolean() }),
  summary: "Approve a generated card into the run's deck (also rescues an auto-rejected card)",
  tags: ['Create'],
  requiresAuth: false,
  handler: async ({ cardId }) => {
    await approveCard(cardId);
    return { success: true };
  },
});

const rejectRoute = createRoute({
  method: 'POST',
  path: '/quiz/create/cards/:cardId/reject',
  responseType: 'json',
  pathParamSchema: z.object({ cardId: z.string() }),
  bodySchema: z.object({ reason: z.string().optional() }),
  responseSchema: z.object({ success: z.boolean() }),
  summary: 'Reject a generated card, with an optional reason',
  tags: ['Create'],
  requiresAuth: false,
  handler: async ({ cardId, reason }) => {
    const pending = await getPendingCard(cardId);
    if (!pending) throw new Error(`No pending card with id "${cardId}".`);
    if (pending.status === 'approved') throw new Error('Card is already approved; delete it from its deck instead.');
    await setCardStatus(cardId, 'rejected', reason);
    return { success: true };
  },
});

const approveAllRoute = createRoute({
  method: 'POST',
  path: '/quiz/create/runs/:runId/approve-all',
  responseType: 'json',
  pathParamSchema: z.object({ runId: z.string() }),
  responseSchema: z.object({ approved: z.number() }),
  summary: "Approve every card in a run that passed review and hasn't been decided yet",
  tags: ['Create'],
  requiresAuth: false,
  handler: async ({ runId }) => {
    const cards = (await listRunCards(runId)).filter(c => c.status === 'pending');
    for (const c of cards) await approveCard(c.id);
    return { approved: cards.length };
  },
});

export const createApiRoutes = [
  statsRoute,
  estimateRoute,
  getSettingsRoute,
  saveSettingsRoute,
  modelsRoute,
  startRunRoute,
  listRunsRoute,
  getRunRoute,
  approveRoute,
  rejectRoute,
  approveAllRoute,
];
