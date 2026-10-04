import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { Agent } from '@mastra/core/agent';
import { noopObserve } from '@mastra/core/tools';
import { z } from 'zod';
import { contentQualityAgent } from '../agents/content-quality';
import { mathCuratorAgent } from '../agents/math-curator';
import { TriviaCardSchema, type TriviaCard } from '../schemas/quiz';
import { verifyTriviaTool } from '../tools/verify-trivia';
import { getRepoRoot } from '../utils/repo-root';
import {
  addPendingCard,
  cardIdTaken,
  finishRun,
  getSettings,
  logModelCall,
  monthToDateSpend,
  questionsForDedupe,
  type Brief,
  type RunConfig,
} from './creation-db';
import { costFor } from './pricing';
import { slugify } from './decks';
import type { Provenance } from './content-db';

const CONCURRENCY = 3;

type Reviewer = Provenance['reviewers'][number];

// Spend tracking for one run. `spent` is this run's cost so far; the run stops
// as soon as it reaches the per-run cap or uses up what is left of the
// monthly cap. Cost is exact when the provider reports it, else tokens x price.
type Budget = { runCap: number; monthlyRoom: number; spent: number; stopReason: string | null };

class SpendCapReached extends Error {}

function checkBudget(b: Budget) {
  if (!b.stopReason && b.spent >= b.runCap) b.stopReason = `per-run cap of $${b.runCap.toFixed(2)}`;
  if (!b.stopReason && b.spent >= b.monthlyRoom) b.stopReason = 'monthly cap';
  if (b.stopReason) throw new SpendCapReached(b.stopReason);
}

async function recordCall(
  budget: Budget,
  call: { runId: string; cardId?: string; role: 'generator' | 'reviewer'; model: string; latencyMs: number; ok: boolean; error?: string },
  usage?: { inputTokens?: number; outputTokens?: number; cost?: number },
) {
  const priced = usage
    ? await costFor(call.model, { input: usage.inputTokens, output: usage.outputTokens }, usage.cost)
    : undefined;
  if (priced) budget.spent += priced.cost;
  await logModelCall({
    ...call,
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    cost: priced?.cost,
    costEstimated: priced?.estimated,
  });
}

const ReviewSchema = z.object({ passed: z.boolean(), issues: z.array(z.string()) });

async function readReferenceExamples(): Promise<string> {
  const filePath = path.join(await getRepoRoot(), 'reference', 'question-examples.md');
  return readFile(filePath, 'utf-8').catch(() => '');
}

// Fresh agent per model, reusing the registered agents' instructions so there
// is one place to edit prompts. Not registered on the Mastra instance: the
// model is a per-run choice, not a fixed part of the app.
async function agentFor(base: Agent, role: string, model: string): Promise<Agent> {
  return new Agent({
    id: `${role}-${slugify(model)}`,
    name: `${role} (${model})`,
    instructions: await base.getInstructions(),
    model: model as never,
  });
}

function usageOf(result: { usage?: unknown; providerMetadata?: unknown }) {
  const u = (result.usage ?? {}) as Record<string, number | undefined>;
  // OpenRouter reports the real cost in provider metadata when available.
  const meta = result.providerMetadata as { openrouter?: { usage?: { cost?: number } } } | undefined;
  return {
    inputTokens: u.inputTokens ?? u.promptTokens,
    outputTokens: u.outputTokens ?? u.completionTokens,
    cost: meta?.openrouter?.usage?.cost,
  };
}

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2));
}

function tooSimilar(a: string, b: string): boolean {
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return false;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.min(wa.size, wb.size) >= 0.8;
}

function cardText(card: TriviaCard): string {
  return [
    ...card.question.map(s => s.text),
    card.correctAnswer,
    ...card.distractors,
    card.explanation,
  ]
    .join(' ')
    .toLowerCase();
}

/** Deterministic checks: the existing trivia verifier, the exclusion list, and near-duplicates. */
async function mechanicalIssues(card: TriviaCard, exclude: string[], existing: string[]): Promise<string[]> {
  if (!verifyTriviaTool.execute) throw new Error('verifyTriviaTool has no execute function');
  const result = await verifyTriviaTool.execute(
    {
      correctAnswer: card.correctAnswer,
      acceptableAlternatives: card.acceptableAlternatives,
      distractors: card.distractors,
      hints: card.hints,
      learnMoreArticle: card.learnMoreArticle,
    },
    { requestContext: undefined as never, observe: noopObserve },
  );
  const issues = result && !('error' in result) ? [...result.issues] : ['Mechanical verifier returned invalid output.'];

  const text = cardText(card);
  for (const term of exclude) {
    if (text.includes(term.toLowerCase())) issues.push(`Mentions excluded term "${term}" — remove it and ask about something else.`);
  }
  const question = card.question.map(s => s.text).join(' ');
  if (existing.some(q => tooSimilar(q, question))) {
    issues.push('Too similar to a question already in this deck or run — pick a different fact.');
  }
  return issues;
}

function passes(reviews: Reviewer[], mode: RunConfig['reviewMode']): boolean {
  if (reviews.length === 0) return true;
  const passed = reviews.filter(r => r.passed).length;
  return mode === 'all' ? passed === reviews.length : passed > reviews.length / 2;
}

async function generateOne(args: {
  budget: Budget;
  runId: string;
  slot: number;
  brief: Brief;
  config: RunConfig;
  deckId: string;
  generatorAgent: Agent;
  reviewerAgents: { model: string; agent: Agent }[];
  examples: string;
}): Promise<void> {
  const { budget, runId, slot, brief, config, deckId, generatorAgent, reviewerAgents, examples } = args;
  let feedback: string[] = [];
  let lastCard: TriviaCard | null = null;
  let lastReviews: Reviewer[] = [];
  let attempts = 0;

  while (attempts < config.maxAttempts) {
    attempts++;
    const existing = await questionsForDedupe(deckId, runId);
    const prompt = [
      `Generate one trivia card for a deck called "${brief.deckName}". This is card ${slot} of ${brief.count}.`,
      `Deck brief from the user (follow it, including any difficulty mix across the deck):\n${brief.brief}`,
      brief.exclude.length ? `Never mention any of these: ${brief.exclude.join('; ')}.` : '',
      'Choose the category that fits best. Set eloRating to match the difficulty the brief asks for.',
      existing.length
        ? `Questions already in this deck/run — do not repeat or closely paraphrase any:\n- ${existing.join('\n- ')}`
        : '',
      feedback.length ? `The previous attempt failed these checks — fix every one:\n${feedback.join('\n')}` : '',
      examples ? `Reference examples of the quality bar (do not copy):\n${examples}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    // --- generate ---
    checkBudget(budget);
    const t0 = Date.now();
    let card: TriviaCard;
    try {
      const result = await generatorAgent.generate(prompt, { structuredOutput: { schema: TriviaCardSchema } });
      card = TriviaCardSchema.parse(result.object);
      await recordCall(budget, { runId, role: 'generator', model: config.generator, latencyMs: Date.now() - t0, ok: true }, usageOf(result));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await recordCall(budget, { runId, role: 'generator', model: config.generator, latencyMs: Date.now() - t0, ok: false, error: message });
      feedback = [`The generator call failed: ${message}`];
      continue;
    }

    // Ids are assigned here so a model can never collide with or overwrite an existing card.
    let id = `${slugify(brief.deckName)}-${Math.random().toString(36).slice(2, 8)}`;
    while (await cardIdTaken(id)) id = `${slugify(brief.deckName)}-${Math.random().toString(36).slice(2, 8)}`;
    card = { ...card, id };
    lastCard = card;

    // --- mechanical ---
    const mech = await mechanicalIssues(card, brief.exclude, existing);
    if (mech.length > 0) {
      feedback = mech;
      lastReviews = [];
      continue;
    }

    // --- reviewers (parallel) ---
    const reviews: Reviewer[] = await Promise.all(
      reviewerAgents.map(async ({ model, agent }): Promise<Reviewer> => {
        checkBudget(budget);
        const start = Date.now();
        try {
          const result = await agent.generate(
            [
              `Judge this trivia card. eloRating: ${card.eloRating}. Category: ${card.category}.`,
              `The card is for a deck called "${brief.deckName}" with this brief:\n${brief.brief}`,
              'Also check FACTUAL ACCURACY: confirm the correct answer is actually correct and every distractor is actually wrong, and that the explanation contains no false claims. If you are not confident a claim is true, fail the card and name the claim. Also fail it if it ignores the brief.',
              JSON.stringify(card, null, 2),
              examples ? `Calibration examples (not a checklist):\n${examples}` : '',
            ]
              .filter(Boolean)
              .join('\n\n'),
            { structuredOutput: { schema: ReviewSchema } },
          );
          await recordCall(budget, { runId, cardId: card.id, role: 'reviewer', model, latencyMs: Date.now() - start, ok: true }, usageOf(result));
          return { model, passed: result.object.passed, issues: result.object.issues };
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          await recordCall(budget, { runId, cardId: card.id, role: 'reviewer', model, latencyMs: Date.now() - start, ok: false, error: message });
          // A reviewer that errors counts as not passing, so a broken model can't wave cards through.
          return { model, passed: false, issues: [`Reviewer call failed: ${message}`] };
        }
      }),
    );
    lastReviews = reviews;

    if (passes(reviews, config.reviewMode)) {
      await addPendingCard({ runId, card, status: 'pending', attempts, reviewers: reviews, issues: [] });
      return;
    }
    feedback = reviews.filter(r => !r.passed).flatMap(r => r.issues);
  }

  if (lastCard) {
    await addPendingCard({ runId, card: lastCard, status: 'auto_rejected', attempts, reviewers: lastReviews, issues: feedback });
  }
}

/** Runs a whole generation job. Never throws: failures are recorded on the run. */
export async function runGeneration(runId: string, brief: Brief, config: RunConfig, deckId: string): Promise<void> {
  try {
    const examples = await readReferenceExamples();
    const generatorAgent = await agentFor(mathCuratorAgent, 'generator', config.generator);
    const reviewerAgents = await Promise.all(
      config.reviewers.map(async model => ({ model, agent: await agentFor(contentQualityAgent, 'reviewer', model) })),
    );

    const settings = await getSettings();
    const budget: Budget = {
      runCap: settings.perRunCapUsd,
      monthlyRoom: settings.monthlyCapUsd - (await monthToDateSpend()),
      spent: 0,
      stopReason: null,
    };

    let next = 1;
    const worker = async () => {
      while (next <= brief.count) {
        const slot = next++;
        await generateOne({ budget, runId, slot, brief, config, deckId, generatorAgent, reviewerAgents, examples });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, brief.count) }, worker));
    await finishRun(runId, 'done');
  } catch (e) {
    if (e instanceof SpendCapReached) {
      await finishRun(runId, 'done', `Stopped early: the ${e.message} was reached. Raise it in Stats if you want runs to go further.`);
      return;
    }
    await finishRun(runId, 'failed', e instanceof Error ? e.message : String(e));
  }
}
