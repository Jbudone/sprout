import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { noopObserve } from '@mastra/core/tools';
import { z } from 'zod';
import {
  MATH_DOMAINS,
  MATH_PROBLEM_TIERS,
  TRIVIA_CATEGORIES,
  MathProblemSchema,
  TriviaCardSchema,
} from '../schemas/quiz';
import { verifyMathTool } from '../tools/verify-math';
import { verifyTriviaTool } from '../tools/verify-trivia';
import { getRepoRoot } from '../utils/repo-root';
import { listMathProblems, listTriviaCards, pickLeastUsed } from '../quiz/content';
import { addTriviaCard, defaultDeckForCard } from '../quiz/content-db';

const MAX_CONTENT_ATTEMPTS = 3;

async function getContentRoot(): Promise<string> {
  return path.join(await getRepoRoot(), 'content');
}

// Optional, user-curated examples of the quality bar and topic breadth to
// aim for. Absent by default — generation proceeds unchanged without it.
async function readReferenceExamples(): Promise<string> {
  const filePath = path.join(await getRepoRoot(), 'reference', 'question-examples.md');
  return readFile(filePath, 'utf-8').catch(() => '');
}

const ContentRequestSchema = z.object({
  weekNumber: z.number().int().positive(),
  mathCount: z.number().int().min(0).max(10).default(1),
  triviaCount: z.number().int().min(0).max(50).default(1),
  domain: z.enum(MATH_DOMAINS).optional(),
  tier: z.enum(MATH_PROBLEM_TIERS).optional(),
  triviaCategory: z.enum(TRIVIA_CATEGORIES).optional(),
});

const MathCycleSchema = z.object({
  weekNumber: z.number().int().positive(),
  index: z.number().int().positive(),
  domain: z.enum(MATH_DOMAINS).optional(),
  tier: z.enum(MATH_PROBLEM_TIERS).optional(),
  problem: MathProblemSchema.nullable(),
  verified: z.boolean(),
  issues: z.array(z.string()),
});

const TriviaCycleSchema = z.object({
  index: z.number().int().positive(),
  category: z.enum(TRIVIA_CATEGORIES).optional(),
  card: TriviaCardSchema.nullable(),
  verified: z.boolean(),
  issues: z.array(z.string()),
});

const BatchResultSchema = z.object({
  written: z.array(z.string()),
  failed: z.array(z.object({ index: z.number(), issues: z.array(z.string()) })),
});

const ContentResultSchema = z.object({
  weekNumber: z.number().int().positive(),
  math: BatchResultSchema,
  trivia: BatchResultSchema,
  summary: z.string(),
});

// ---- Math problem pipeline ----

const buildMathBatchStep = createStep({
  id: 'build-math-batch',
  description: 'Seeds one generation cycle per requested math problem.',
  inputSchema: ContentRequestSchema,
  outputSchema: z.array(MathCycleSchema),
  execute: async ({ inputData }) => {
    // Fetched once and updated locally as domains are assigned, so a
    // multi-item batch spreads across under-represented domains instead of
    // drawing independently from the same pre-batch snapshot each time.
    const usedDomains = inputData.domain ? [] : (await listMathProblems()).map(p => p.domain);

    const cycles = [];
    for (let i = 0; i < inputData.mathCount; i++) {
      const domain = inputData.domain ?? pickLeastUsed(MATH_DOMAINS, usedDomains);
      if (!inputData.domain) usedDomains.push(domain);

      cycles.push({
        weekNumber: inputData.weekNumber,
        index: i + 1,
        domain,
        tier: inputData.tier,
        problem: null,
        verified: false,
        issues: [],
      });
    }
    return cycles;
  },
});

const generateMathStep = createStep({
  id: 'generate-math',
  description: 'Math Curator generates one math problem (addressing any prior verification feedback).',
  inputSchema: MathCycleSchema,
  outputSchema: MathCycleSchema,
  execute: async ({ inputData, mastra }) => {
    const curator = mastra?.getAgent('mathCurator');
    if (!curator) throw new Error('mathCurator agent is not registered on this Mastra instance');

    const hints = [
      inputData.domain ? `Domain: ${inputData.domain}.` : '',
      inputData.tier ? `Tier: ${inputData.tier}.` : '',
    ]
      .filter(Boolean)
      .join(' ');
    const feedback = inputData.issues.length
      ? `\n\nThe previous attempt failed these checks — fix them:\n${inputData.issues.join('\n')}`
      : '';
    const examples = await readReferenceExamples();
    const referenceSection = examples
      ? `\n\nReference examples of the quality and topic breadth to aim for (do not copy verbatim):\n${examples}`
      : '';

    const result = await curator.generate(
      `Generate one math problem for weekNumber ${inputData.weekNumber}. ${hints}${feedback}${referenceSection}`,
      { structuredOutput: { schema: MathProblemSchema } },
    );

    return { ...inputData, problem: MathProblemSchema.parse(result.object), verified: false, issues: [] };
  },
});

const verifyMathStep = createStep({
  id: 'verify-math-step',
  description: 'Independently re-verifies the generated math problem.',
  inputSchema: MathCycleSchema,
  outputSchema: MathCycleSchema,
  execute: async ({ inputData, requestContext }) => {
    if (!inputData.problem) throw new Error('verify-math-step received no problem to verify');
    if (!verifyMathTool.execute) throw new Error('verifyMathTool has no execute function');

    const result = await verifyMathTool.execute(
      {
        promptLatex: inputData.problem.promptLatex,
        stepByStepSolutionLatex: inputData.problem.stepByStepSolutionLatex,
        finalAnswer: inputData.problem.finalAnswer,
      },
      { requestContext, observe: noopObserve },
    );
    if (!result || 'error' in result) throw new Error(`verify-math returned invalid output: ${JSON.stringify(result)}`);

    return { ...inputData, verified: result.passed, issues: result.issues };
  },
});

const qualityJudgeMathStep = createStep({
  id: 'quality-judge-math',
  description: 'Judges fun/difficulty-fit/proof-clarity for a mechanically-valid math problem.',
  inputSchema: MathCycleSchema,
  outputSchema: MathCycleSchema,
  execute: async ({ inputData, mastra }) => {
    // Skip the LLM call entirely if the mechanical check already failed —
    // it's going to retry regardless, so there's nothing useful to judge yet.
    if (!inputData.verified || !inputData.problem) return inputData;

    const judge = mastra?.getAgent('contentQuality');
    if (!judge) throw new Error('contentQuality agent is not registered on this Mastra instance');

    const context = [
      inputData.tier ? `Requested tier: ${inputData.tier}.` : `Actual tier: ${inputData.problem.tier}.`,
      inputData.domain ? `Requested domain: ${inputData.domain}.` : `Actual domain: ${inputData.problem.domain}.`,
    ].join(' ');
    const examples = await readReferenceExamples();
    const referenceSection = examples
      ? `\n\nReference examples of the quality bar and pitfalls to judge against (do not require an exact match, these are calibration, not a checklist):\n${examples}`
      : '';

    const result = await judge.generate(
      `Judge this math problem. ${context}\n\n${JSON.stringify(inputData.problem, null, 2)}${referenceSection}`,
      { structuredOutput: { schema: z.object({ passed: z.boolean(), issues: z.array(z.string()) }) } },
    );

    return { ...inputData, verified: result.object.passed, issues: result.object.issues };
  },
});

const mathGenerateVerifyCycle = createWorkflow({
  id: 'math-generate-verify',
  inputSchema: MathCycleSchema,
  outputSchema: MathCycleSchema,
})
  .then(generateMathStep)
  .then(verifyMathStep)
  .then(qualityJudgeMathStep)
  .commit();

const mathItemWorkflow = createWorkflow({
  id: 'math-item',
  inputSchema: MathCycleSchema,
  outputSchema: MathCycleSchema,
})
  .dountil(
    mathGenerateVerifyCycle,
    async ({ inputData, iterationCount }) => inputData.verified || iterationCount >= MAX_CONTENT_ATTEMPTS,
  )
  .commit();

const persistMathStep = createStep({
  id: 'persist-math',
  description: 'Writes verified math problems to the content library; leaves unverified ones unwritten.',
  inputSchema: z.array(MathCycleSchema),
  outputSchema: BatchResultSchema,
  execute: async ({ inputData }) => {
    const written: string[] = [];
    const failed: { index: number; issues: string[] }[] = [];

    const mathRoot = path.join(await getContentRoot(), 'math');
    await mkdir(mathRoot, { recursive: true });
    for (const item of inputData) {
      if (item.verified && item.problem) {
        const filePath = path.join(mathRoot, `week-${item.weekNumber}-${item.index}.json`);
        await writeFile(filePath, JSON.stringify(item.problem, null, 2));
        written.push(filePath);
      } else {
        failed.push({ index: item.index, issues: item.issues });
      }
    }

    return { written, failed };
  },
});

const mathPipelineWorkflow = createWorkflow({
  id: 'math-pipeline',
  inputSchema: ContentRequestSchema,
  outputSchema: BatchResultSchema,
})
  .then(buildMathBatchStep)
  .foreach(mathItemWorkflow)
  .then(persistMathStep)
  .commit();

// ---- Trivia card pipeline ----

const buildTriviaBatchStep = createStep({
  id: 'build-trivia-batch',
  description: 'Seeds one generation cycle per requested trivia card.',
  inputSchema: ContentRequestSchema,
  outputSchema: z.array(TriviaCycleSchema),
  execute: async ({ inputData }) => {
    // See buildMathBatchStep — same fetch-once-then-track-locally pattern.
    const usedCategories = inputData.triviaCategory ? [] : (await listTriviaCards()).map(c => c.category);

    const cycles = [];
    for (let i = 0; i < inputData.triviaCount; i++) {
      const category = inputData.triviaCategory ?? pickLeastUsed(TRIVIA_CATEGORIES, usedCategories);
      if (!inputData.triviaCategory) usedCategories.push(category);

      cycles.push({
        index: i + 1,
        category,
        card: null,
        verified: false,
        issues: [],
      });
    }
    return cycles;
  },
});

const generateTriviaStep = createStep({
  id: 'generate-trivia',
  description: 'Math Curator generates one trivia card (addressing any prior verification feedback).',
  inputSchema: TriviaCycleSchema,
  outputSchema: TriviaCycleSchema,
  execute: async ({ inputData, mastra }) => {
    const curator = mastra?.getAgent('mathCurator');
    if (!curator) throw new Error('mathCurator agent is not registered on this Mastra instance');

    const hints = inputData.category ? `Category: ${inputData.category}.` : '';
    const feedback = inputData.issues.length
      ? `\n\nThe previous attempt failed these checks — fix them:\n${inputData.issues.join('\n')}`
      : '';
    const examples = await readReferenceExamples();
    const referenceSection = examples
      ? `\n\nReference examples of the quality and topic breadth to aim for (do not copy verbatim):\n${examples}`
      : '';

    const result = await curator.generate(`Generate one trivia card. ${hints}${feedback}${referenceSection}`, {
      structuredOutput: { schema: TriviaCardSchema },
    });

    return { ...inputData, card: TriviaCardSchema.parse(result.object), verified: false, issues: [] };
  },
});

const verifyTriviaStep = createStep({
  id: 'verify-trivia-step',
  description: 'Independently re-verifies the generated trivia card.',
  inputSchema: TriviaCycleSchema,
  outputSchema: TriviaCycleSchema,
  execute: async ({ inputData, requestContext }) => {
    if (!inputData.card) throw new Error('verify-trivia-step received no card to verify');
    if (!verifyTriviaTool.execute) throw new Error('verifyTriviaTool has no execute function');

    const result = await verifyTriviaTool.execute(
      {
        correctAnswer: inputData.card.correctAnswer,
        acceptableAlternatives: inputData.card.acceptableAlternatives,
        distractors: inputData.card.distractors,
        hints: inputData.card.hints,
        learnMoreArticle: inputData.card.learnMoreArticle,
      },
      { requestContext, observe: noopObserve },
    );
    if (!result || 'error' in result) throw new Error(`verify-trivia returned invalid output: ${JSON.stringify(result)}`);

    return { ...inputData, verified: result.passed, issues: result.issues };
  },
});

const qualityJudgeTriviaStep = createStep({
  id: 'quality-judge-trivia',
  description: 'Judges fun/difficulty-fit for a mechanically-valid trivia card.',
  inputSchema: TriviaCycleSchema,
  outputSchema: TriviaCycleSchema,
  execute: async ({ inputData, mastra }) => {
    if (!inputData.verified || !inputData.card) return inputData;

    const judge = mastra?.getAgent('contentQuality');
    if (!judge) throw new Error('contentQuality agent is not registered on this Mastra instance');

    const context = inputData.category
      ? `Requested category: ${inputData.category}.`
      : `Actual category: ${inputData.card.category}.`;
    const examples = await readReferenceExamples();
    const referenceSection = examples
      ? `\n\nReference examples of the quality bar and pitfalls to judge against (do not require an exact match, these are calibration, not a checklist):\n${examples}`
      : '';

    const result = await judge.generate(
      `Judge this trivia card. ${context} eloRating: ${inputData.card.eloRating}.\n\n${JSON.stringify(inputData.card, null, 2)}${referenceSection}`,
      { structuredOutput: { schema: z.object({ passed: z.boolean(), issues: z.array(z.string()) }) } },
    );

    return { ...inputData, verified: result.object.passed, issues: result.object.issues };
  },
});

const triviaGenerateVerifyCycle = createWorkflow({
  id: 'trivia-generate-verify',
  inputSchema: TriviaCycleSchema,
  outputSchema: TriviaCycleSchema,
})
  .then(generateTriviaStep)
  .then(verifyTriviaStep)
  .then(qualityJudgeTriviaStep)
  .commit();

const triviaItemWorkflow = createWorkflow({
  id: 'trivia-item',
  inputSchema: TriviaCycleSchema,
  outputSchema: TriviaCycleSchema,
})
  .dountil(
    triviaGenerateVerifyCycle,
    async ({ inputData, iterationCount }) => inputData.verified || iterationCount >= MAX_CONTENT_ATTEMPTS,
  )
  .commit();

const persistTriviaStep = createStep({
  id: 'persist-trivia',
  description: 'Adds verified trivia cards to the deck for their category; leaves unverified ones unwritten.',
  inputSchema: z.array(TriviaCycleSchema),
  outputSchema: BatchResultSchema,
  execute: async ({ inputData }) => {
    const written: string[] = [];
    const failed: { index: number; issues: string[] }[] = [];

    for (const item of inputData) {
      if (item.verified && item.card) {
        try {
          await addTriviaCard(item.card, defaultDeckForCard(item.card));
          written.push(`deck:${defaultDeckForCard(item.card).id}/${item.card.id}`);
        } catch (e) {
          failed.push({ index: item.index, issues: [e instanceof Error ? e.message : String(e)] });
        }
      } else {
        failed.push({ index: item.index, issues: item.issues });
      }
    }

    return { written, failed };
  },
});

const triviaPipelineWorkflow = createWorkflow({
  id: 'trivia-pipeline',
  inputSchema: ContentRequestSchema,
  outputSchema: BatchResultSchema,
})
  .then(buildTriviaBatchStep)
  // Trivia items are independent (no shared state, distinct output files),
  // so a handful can generate concurrently — meaningful once triviaCount
  // gets into the dozens rather than the day-to-day 10-20.
  .foreach(triviaItemWorkflow, { concurrency: 5 })
  .then(persistTriviaStep)
  .commit();

// ---- Outer workflow ----

export const contentCreationWorkflow = createWorkflow({
  id: 'content-creation',
  description:
    "Generates and independently verifies a week's math problems and trivia cards, writing verified items to the content library and leaving anything that fails verification unwritten.",
  inputSchema: ContentRequestSchema,
  outputSchema: ContentResultSchema,
})
  .parallel([mathPipelineWorkflow, triviaPipelineWorkflow])
  .map(async ({ inputData, getInitData }) => {
    const { weekNumber } = getInitData<z.infer<typeof ContentRequestSchema>>();
    const math = inputData['math-pipeline'];
    const trivia = inputData['trivia-pipeline'];
    const failedCount = math.failed.length + trivia.failed.length;

    return {
      weekNumber,
      math,
      trivia,
      summary:
        `Week ${weekNumber}: wrote ${math.written.length} math problem(s) and ${trivia.written.length} trivia card(s).` +
        (failedCount > 0
          ? ` ${failedCount} item(s) failed verification after ${MAX_CONTENT_ATTEMPTS} attempts and were not written.`
          : ''),
    };
  })
  .commit();
