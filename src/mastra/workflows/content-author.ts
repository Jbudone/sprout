import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { TriviaCardSchema, MathProblemSchema } from '../schemas/quiz';
import { getRepoRoot } from '../utils/repo-root';
import { addTriviaCard, defaultDeckForCard } from '../quiz/content-db';
import { verifyTriviaTool } from '../tools/verify-trivia';
import { verifyMathTool } from '../tools/verify-math';
import { contentQualityAgent } from '../agents/content-quality';
import { noopObserve } from '@mastra/core/tools';

const MAX_CONTENT_ATTEMPTS = 3;

const ContentRequestSchema = z.object({
  weekNumber: z.number().int().positive(),
  kind: z.enum(['trivia', 'math']),
  domain: z.enum(['algebra', 'number-theory', 'combinatorics', 'geometry', 'calculus', 'probability', 'linear-algebra', 'analysis']).optional(),
  tier: z.enum(['foundational', 'intermediate', 'advanced', 'olympiad']).optional(),
  category: z.enum([
    'history-of-math',
    'famous-theorems',
    'mathematicians',
    'notation-and-symbols',
    'applied-math',
    'math-in-culture',
    'geography',
    'history',
    'biology',
    'chemistry',
    'science',
    'technology',
    'animals',
    'botany',
    'gemology',
    'geology',
    'fun-facts',
  ]).optional(),
  id: z.string().min(1).optional(),
});

const ItemResultSchema = z.object({
  id: z.string(),
  weekNumber: z.number().int().positive(),
  index: z.number().int().positive(),
  verified: z.boolean(),
  issues: z.array(z.string()),
});

const BatchResultSchema = z.object({
  written: z.array(z.string()),
  failed: z.array(z.object({ index: z.number(), issues: z.array(z.string()) })),
});

async function getContentRoot(): Promise<string> {
  return path.join(await getRepoRoot(), 'content');
}

const generateStep = createStep({
  id: 'generate',
  description: 'Content Author generates one trivia card or math problem.',
  inputSchema: z.object({
    weekNumber: z.number().int().positive(),
    kind: z.enum(['trivia', 'math']),
    domain: z.enum(['algebra', 'number-theory', 'combinatorics', 'geometry', 'calculus', 'probability', 'linear-algebra', 'analysis']).optional(),
    tier: z.enum(['foundational', 'intermediate', 'advanced', 'olympiad']).optional(),
    category: z.enum([
      'history-of-math',
      'famous-theorems',
      'mathematicians',
      'notation-and-symbols',
      'applied-math',
      'math-in-culture',
      'geography',
      'history',
      'biology',
      'chemistry',
      'science',
      'technology',
      'animals',
      'botany',
      'gemology',
      'geology',
      'fun-facts',
    ]).optional(),
    id: z.string().min(1).optional(),
    index: z.number().int().positive(),
  }),
  outputSchema: z.object({
    item: z.union([TriviaCardSchema, MathProblemSchema]).nullable(),
    verified: z.boolean(),
    issues: z.array(z.string()),
  }),
  execute: async ({ inputData, mastra }) => {
    const author = mastra?.getAgent('contentAuthor');
    if (!author) throw new Error('contentAuthor agent is not registered on this Mastra instance');

    const hints = [
      inputData.domain ? `Domain: ${inputData.domain}.` : '',
      inputData.tier ? `Tier: ${inputData.tier}.` : '',
      inputData.category ? `Category: ${inputData.category}.` : '',
    ]
      .filter(Boolean)
      .join(' ');

    const idSection = inputData.id ? `Use this exact ID: ${inputData.id}.` : '';

    const result = await author.generate(
      `Generate one ${inputData.kind} item for weekNumber ${inputData.weekNumber}. ${hints} ${idSection}`,
      { structuredOutput: { schema: inputData.kind === 'trivia' ? TriviaCardSchema : MathProblemSchema } },
    );

    const parsed = inputData.kind === 'trivia'
      ? TriviaCardSchema.parse(result.object)
      : MathProblemSchema.parse(result.object);

    return {
      item: parsed,
      verified: false,
      issues: [],
    };
  },
});

const verifyStep = createStep({
  id: 'verify-step',
  description: 'Independently re-verifies the generated item.',
  inputSchema: z.object({
    item: z.union([TriviaCardSchema, MathProblemSchema]).nullable(),
    kind: z.enum(['trivia', 'math']),
    verified: z.boolean(),
    issues: z.array(z.string()),
  }),
  outputSchema: z.object({
    item: z.union([TriviaCardSchema, MathProblemSchema]).nullable(),
    verified: z.boolean(),
    issues: z.array(z.string()),
  }),
  execute: async ({ inputData, requestContext }) => {
    if (!inputData.item) {
      return { item: null, verified: false, issues: ['No item to verify.'] };
    }

    if (inputData.kind === 'trivia') {
      if (!verifyTriviaTool.execute) throw new Error('verifyTriviaTool has no execute function');
      const result = await verifyTriviaTool.execute(
        {
          correctAnswer: inputData.item.correctAnswer,
          acceptableAlternatives: inputData.item.acceptableAlternatives,
          distractors: inputData.item.distractors,
          hints: inputData.item.hints,
          learnMoreArticle: inputData.item.learnMoreArticle,
        },
        { requestContext, observe: noopObserve },
      );
      if (!result || 'error' in result) throw new Error(`verify-trivia returned invalid output: ${JSON.stringify(result)}`);
      return { ...inputData, verified: result.passed, issues: result.issues };
    } else {
      if (!verifyMathTool.execute) throw new Error('verifyMathTool has no execute function');
      const result = await verifyMathTool.execute(
        {
          promptLatex: inputData.item.promptLatex,
          stepByStepSolutionLatex: inputData.item.stepByStepSolutionLatex,
          finalAnswer: inputData.item.finalAnswer,
        },
        { requestContext, observe: noopObserve },
      );
      if (!result || 'error' in result) throw new Error(`verify-math returned invalid output: ${JSON.stringify(result)}`);
      return { ...inputData, verified: result.passed, issues: result.issues };
    }
  },
});

const qualityJudgeStep = createStep({
  id: 'quality-judge',
  description: 'Judges fun/difficulty-fit for a mechanically-valid item.',
  inputSchema: z.object({
    item: z.union([TriviaCardSchema, MathProblemSchema]).nullable(),
    kind: z.enum(['trivia', 'math']),
    verified: z.boolean(),
    issues: z.array(z.string()),
  }),
  outputSchema: z.object({
    item: z.union([TriviaCardSchema, MathProblemSchema]).nullable(),
    verified: z.boolean(),
    issues: z.array(z.string()),
  }),
  execute: async ({ inputData, mastra }) => {
    if (!inputData.verified || !inputData.item) {
      return inputData;
    }

    const judge = mastra?.getAgent('contentQuality');
    if (!judge) throw new Error('contentQuality agent is not registered on this Mastra instance');

    const context = inputData.kind === 'trivia'
      ? `Category: ${inputData.item.category}. eloRating: ${inputData.item.eloRating}.`
      : `Domain: ${inputData.item.domain}. Tier: ${inputData.item.tier}.`;

    const result = await judge.generate(
      `Judge this ${inputData.kind} item. ${context}\n\n${JSON.stringify(inputData.item, null, 2)}`,
      { structuredOutput: { schema: z.object({ passed: z.boolean(), issues: z.array(z.string()) }) } },
    );

    return { ...inputData, verified: result.object.passed, issues: result.object.issues };
  },
});

const persistStep = createStep({
  id: 'persist',
  description: 'Writes verified items to the content library.',
  inputSchema: z.array(z.object({
    item: z.union([TriviaCardSchema, MathProblemSchema]).nullable(),
    kind: z.enum(['trivia', 'math']),
    verified: z.boolean(),
    issues: z.array(z.string()),
    weekNumber: z.number().int().positive(),
    index: z.number().int().positive(),
  })),
  outputSchema: BatchResultSchema,
  execute: async ({ inputData }) => {
    const written: string[] = [];
    const failed: { index: number; issues: string[] }[] = [];

    const root = await getContentRoot();
    for (const item of inputData) {
      if (item.verified && item.item && item.kind === 'trivia') {
        const card = TriviaCardSchema.parse(item.item);
        try {
          await addTriviaCard(card, defaultDeckForCard(card));
          written.push(`deck:${defaultDeckForCard(card).id}/${card.id}`);
        } catch (e) {
          failed.push({ index: item.index, issues: [e instanceof Error ? e.message : String(e)] });
        }
      } else if (item.verified && item.item) {
        const kindRoot = path.join(root, item.kind);
        await mkdir(kindRoot, { recursive: true });
        const filePath = path.join(kindRoot, `week-${item.weekNumber}-${item.index}.json`);
        await writeFile(filePath, JSON.stringify(item.item, null, 2));
        written.push(filePath);
      } else {
        failed.push({ index: item.index, issues: item.issues });
      }
    }

    return { written, failed };
  },
});

export const contentAuthorWorkflow = createWorkflow({
  id: 'content-author',
  description:
    'Generates and verifies a single trivia card or math problem via the content-author agent, then persists verified items to the content library.',
  inputSchema: ContentRequestSchema,
  outputSchema: BatchResultSchema,
})
  .then(generateStep)
  .then(verifyStep)
  .then(qualityJudgeStep)
  .then(persistStep)
  .commit();
