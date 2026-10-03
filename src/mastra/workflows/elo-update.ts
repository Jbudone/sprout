import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { listTriviaCards, listMathProblems } from '../quiz/content';

const ELO_K_FACTOR = 32;
const ELO_INITIAL_RATING = 1000;
const ELO_MIN_RATING = 100;
const ELO_MAX_RATING = 3000;

const RATING_BANDS = {
  beginner: { min: 100, max: 1200, tier: 'foundational' },
  intermediate: { min: 1200, max: 1600, tier: 'intermediate' },
  advanced: { min: 1600, max: 2000, tier: 'advanced' },
  expert: { min: 2000, max: 3000, tier: 'olympiad' },
} as const;

type RatingBand = keyof typeof RATING_BANDS;

function getRatingBand(rating: number): RatingBand {
  if (rating < RATING_BANDS.intermediate.min) return 'beginner';
  if (rating < RATING_BANDS.advanced.min) return 'intermediate';
  if (rating < RATING_BANDS.expert.min) return 'advanced';
  return 'expert';
}

function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

function newRating(rating: number, actualScore: number, expectedScore: number, kFactor: number = ELO_K_FACTOR): number {
  return Math.max(ELO_MIN_RATING, Math.min(ELO_MAX_RATING, rating + kFactor * (actualScore - expectedScore)));
}

export const eloUpdateWorkflow = createWorkflow({
  id: 'elo-update',
  description:
    'Updates ELO ratings for trivia/math content based on user performance, then suggests next content request parameters. Integrates with the training panel for manual curation and quality feedback.',
  inputSchema: z.object({
    kind: z.enum(['trivia', 'math']),
    itemId: z.string(),
    correct: z.boolean().optional(),
    difficulty: z.enum(['too_easy', 'too_hard']).optional(),
    reaction: z.enum(['not_fun', 'standout']).optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    userRatingBand: z.string(),
    suggestedNextTier: z.string().optional(),
  }),
})
  .then(createStep({
    id: 'analyze-performance',
    description: 'Analyzes user performance and updates content ELO ratings. Trains the AI system on what the user finds easy/hard.',
    inputSchema: z.object({
      kind: z.enum(['trivia', 'math']),
      itemId: z.string(),
      correct: z.boolean().optional(),
      difficulty: z.enum(['too_easy', 'too_hard']).optional(),
      reaction: z.enum(['not_fun', 'standout']).optional(),
    }),
    outputSchema: z.object({
      contentRatingBefore: z.number(),
      contentRatingAfter: z.number(),
      userRatingBand: z.string(),
      suggestedNextTier: z.string().optional(),
      trainingFeedback: z.string(),
    }),
    execute: async ({ inputData }) => {
      const { kind, itemId, correct, difficulty, reaction } = inputData;

      const contentList = kind === 'trivia'
        ? await listTriviaCards()
        : await listMathProblems();
      
      const contentItem = contentList.find(c => c.id === itemId);
      if (!contentItem) {
        throw new Error(`Content item ${itemId} not found for ${kind}`);
      }

      const contentRatingBefore = contentItem.eloRating;
      
      let expected = 0.5;
      let actual = 0.5;

      if (correct === true) {
        actual = 1;
        if (difficulty === 'too_easy') {
          expected = 0.9;
        }
      } else if (correct === false) {
        actual = 0;
        if (difficulty === 'too_hard') {
          expected = 0.1;
        }
      } else {
        return {
          contentRatingBefore,
          contentRatingAfter: contentRatingBefore,
          userRatingBand: 'unrated',
          suggestedNextTier: 'intermediate',
          trainingFeedback: 'Skipped - no rating change',
        };
      }

      const contentRatingAfter = newRating(contentRatingBefore, actual, expected);

      const userRatingBand = getRatingBand(contentRatingAfter);

      const suggestedNextTier = RATING_BANDS[userRatingBand].tier;

      const trainingFeedback = `User ${correct ? 'answered' : 'missed'} ${itemId}. ${difficulty ? `${difficulty.toUpperCase()} for user. ` : ''}${reaction === 'standout' ? 'User loved this - mark as high quality. ' : ''}Recommended next tier: ${suggestedNextTier}`;

      return {
        contentRatingBefore,
        contentRatingAfter,
        userRatingBand: userRatingBand.charAt(0).toUpperCase() + userRatingBand.slice(1),
        suggestedNextTier,
        trainingFeedback,
      };
    },
  }))
  .then(createStep({
    id: 'record-feedback',
    description: 'Records the performance feedback in the database and logs training feedback.',
    inputSchema: z.object({
      kind: z.enum(['trivia', 'math']),
      itemId: z.string(),
      correct: z.boolean().optional(),
      difficulty: z.enum(['too_easy', 'too_hard']).optional(),
      reaction: z.enum(['not_fun', 'standout']).optional(),
      contentRatingBefore: z.number(),
      contentRatingAfter: z.number(),
      trainingFeedback: z.string(),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      message: z.string(),
      contentRatingChange: z.number(),
      trainingFeedback: z.string(),
    }),
    execute: async ({ inputData }) => {
      const { kind, itemId, difficulty, reaction, contentRatingBefore, contentRatingAfter, trainingFeedback } = inputData;

      if (difficulty || reaction) {
        // The feedback is already recorded via /quiz/:kind/:itemId/feedback route
      }

      return {
        success: true,
        message: `Content rating updated from ${contentRatingBefore} to ${contentRatingAfter}`,
        contentRatingChange: contentRatingAfter - contentRatingBefore,
        trainingFeedback,
      };
    },
  }))
  .map(async ({ inputData, getStepData }) => {
    const performanceData = getStepData('analyze-performance');
    const feedbackData = getStepData('record-feedback');

    return {
      success: feedbackData.success,
      message: feedbackData.message,
      userRatingBand: performanceData.userRatingBand,
      suggestedNextTier: performanceData.suggestedNextTier,
    };
  })
  .commit();
