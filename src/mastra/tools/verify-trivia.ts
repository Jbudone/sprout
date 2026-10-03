import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { TriviaCardSchema } from '../schemas/quiz';
import { NON_DETERMINISTIC_PATTERN } from './verify-math';

const MIN_REFERENCE_LENGTH = 10;

export const verifyTriviaTool = createTool({
  id: 'verify-trivia',
  description:
    'Sanity-checks a trivia card: hint distinctness, whether the correct answer reads as a single deterministic value, whether acceptable alternatives and distractors are non-redundant, and whether the further-reading reference looks substantive.',
  inputSchema: TriviaCardSchema.pick({
    correctAnswer: true,
    acceptableAlternatives: true,
    distractors: true,
    hints: true,
    learnMoreArticle: true,
  }),
  outputSchema: z.object({
    hintsValid: z.boolean(),
    answerDeterministic: z.boolean(),
    distractorsValid: z.boolean(),
    hasReference: z.boolean(),
    issues: z.array(z.string()),
    passed: z.boolean(),
  }),
  execute: async ({ correctAnswer, acceptableAlternatives, distractors, hints, learnMoreArticle }) => {
    const issues: string[] = [];

    const normalizedHints = hints.map(hint => hint.trim().toLowerCase());
    const hintsValid = new Set(normalizedHints).size === normalizedHints.length;
    if (!hintsValid) {
      issues.push('Hints are not all distinct — each of the three hints must add new information.');
    }

    const answerDeterministic = correctAnswer.trim().length > 0 && !NON_DETERMINISTIC_PATTERN.test(correctAnswer);
    if (!answerDeterministic) {
      issues.push('Correct answer reads as non-deterministic (hedging language or empty).');
    }

    const normalizedAnswer = correctAnswer.trim().toLowerCase();
    if (acceptableAlternatives.some(alt => alt.trim().toLowerCase() === normalizedAnswer)) {
      issues.push('acceptableAlternatives duplicates correctAnswer — list only genuinely different accepted phrasings.');
    }

    const hasReference = learnMoreArticle.trim().length >= MIN_REFERENCE_LENGTH;
    if (!hasReference) {
      issues.push('learnMoreArticle is too short to be a useful reference.');
    }

    const normalizedDistractors = distractors.map(d => d.trim().toLowerCase());
    const distractorsDistinct = new Set(normalizedDistractors).size === normalizedDistractors.length;
    if (!distractorsDistinct) {
      issues.push('Distractors are not all distinct from each other.');
    }
    const distractorsOverlapAnswer = normalizedDistractors.some(
      d => d === normalizedAnswer || acceptableAlternatives.some(alt => alt.trim().toLowerCase() === d),
    );
    if (distractorsOverlapAnswer) {
      issues.push('A distractor duplicates correctAnswer or an acceptableAlternative — distractors must be genuinely wrong.');
    }
    const distractorsValid = distractorsDistinct && !distractorsOverlapAnswer;

    return {
      hintsValid,
      answerDeterministic,
      distractorsValid,
      hasReference,
      issues,
      passed: issues.length === 0,
    };
  },
});
