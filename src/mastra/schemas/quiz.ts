import { z } from 'zod';

export const MATH_DOMAINS = [
  'algebra',
  'number-theory',
  'combinatorics',
  'geometry',
  'calculus',
  'probability',
  'linear-algebra',
  'analysis',
] as const;

export const MATH_PROBLEM_TIERS = ['foundational', 'intermediate', 'advanced', 'olympiad'] as const;

export const TRIVIA_CATEGORIES = [
  'history-of-math',
  'famous-theorems',
  'mathematicians',
  'notation-and-symbols',
  'applied-math',
  'math-in-culture',
] as const;

/**
 * A weekly advanced math problem: single deterministic answer, exactly three
 * tiered hints, and a complete step-by-step derivation.
 */
export const MathProblemSchema = z.object({
  id: z.string().min(1),
  weekNumber: z.number().int().positive(),
  tier: z.enum(MATH_PROBLEM_TIERS),
  domain: z.enum(MATH_DOMAINS),
  promptLatex: z.string().min(1),
  finalAnswer: z.string().min(1),
  hints: z.tuple([z.string().min(1), z.string().min(1), z.string().min(1)]),
  stepByStepSolutionLatex: z.array(z.string().min(1)).min(1),
  sanityVerificationNotes: z.string().default(''),
});

export type MathProblem = z.infer<typeof MathProblemSchema>;

/**
 * An adaptive trivia card: conceptual question, tiered hints, and further
 * reading for a correct or attempted answer.
 */
export const TriviaCardSchema = z.object({
  id: z.string().min(1),
  category: z.enum(TRIVIA_CATEGORIES),
  eloRating: z.number().int().min(100).max(3000),
  question: z.string().min(1),
  correctAnswer: z.string().min(1),
  acceptableAlternatives: z.array(z.string().min(1)).default([]),
  hints: z.tuple([z.string().min(1), z.string().min(1), z.string().min(1)]),
  learnMoreArticle: z.string().min(1),
});

export type TriviaCard = z.infer<typeof TriviaCardSchema>;
