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
  // Math trivia
  'history-of-math',
  'famous-theorems',
  'mathematicians',
  'notation-and-symbols',
  'applied-math',
  'math-in-culture',
  // General trivia
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
] as const;

export type MathDomain = (typeof MATH_DOMAINS)[number];
export type TriviaCategory = (typeof TRIVIA_CATEGORIES)[number];

// A trivia question is a short sequence of styled segments rather than one
// string, so a card can lead with notation and follow it with a smaller
// context line. Renderers fall back to the `prose` look for any style they
// don't handle, so new styles can be added here without a content migration.
export const QUESTION_SEGMENT_STYLES = ['formula', 'context', 'prose'] as const;

export type QuestionSegmentStyle = (typeof QUESTION_SEGMENT_STYLES)[number];

export const QuestionSegmentSchema = z.object({
  text: z.string().min(1),
  style: z.enum(QUESTION_SEGMENT_STYLES),
});

export type QuestionSegment = z.infer<typeof QuestionSegmentSchema>;

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
  // A plain fixed-length array rather than z.tuple(): Gemini's structured-output
  // schema translation (google response_schema) only supports a single `items`
  // schema for arrays, not a per-position tuple schema.
  hints: z.array(z.string().min(1)).length(3),
  stepByStepSolutionLatex: z.array(z.string().min(1)).min(1),
  sanityVerificationNotes: z.string().default(''),
  // Optional quality score metadata added by the content-author workflow
  // or manual curation. Not used by the content-creation workflow (which
  // uses the content-quality agent's passed/failed output instead).
  qualityScore: z.number().int().min(1).max(5).optional(),
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
  question: z.array(QuestionSegmentSchema).min(1).max(3),
  correctAnswer: z.string().min(1),
  acceptableAlternatives: z.array(z.string().min(1)).default([]),
  // Plausible wrong options, one per multiple-choice button alongside the
  // correct answer. Variable length: a question only gets as many options as it
  // has genuinely plausible wrong answers. Distinct from acceptableAlternatives,
  // which are alternate phrasings of the *correct* answer.
  distractors: z.array(z.string().min(1)).min(1).max(3),
  // A plain fixed-length array rather than z.tuple(): Gemini's structured-output
  // schema translation (google response_schema) only supports a single `items`
  // schema for arrays, not a per-position tuple schema.
  hints: z.array(z.string().min(1)).length(3),
  // Shown to the user immediately after answering — distinct from learnMoreArticle,
  // which is a further-reading link rather than an inline explanation.
  explanation: z.string().min(1),
  learnMoreArticle: z.string().min(1),
  // Optional quality score metadata added by the content-author workflow
  // or manual curation. Not used by the content-creation workflow (which
  // uses the content-quality agent's passed/failed output instead).
  qualityScore: z.number().int().min(1).max(5).optional(),
});

export type TriviaCard = z.infer<typeof TriviaCardSchema>;
