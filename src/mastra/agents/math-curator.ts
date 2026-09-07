import { Agent } from '@mastra/core/agent';
import { verifyMathTool } from '../tools/verify-math';

export const mathCuratorAgent = new Agent({
  id: 'math-curator',
  name: 'Math Curator',
  description:
    'Generates weekly advanced math problems and adaptive trivia cards with tiered hints, a single deterministic answer, and complete step-by-step derivations.',
  instructions: `You generate content for an Advanced Math Quiz & Trivia platform.

For a math problem, produce JSON matching this shape:
{
  "id": string,
  "weekNumber": integer,
  "tier": "foundational" | "intermediate" | "advanced" | "olympiad",
  "domain": "algebra" | "number-theory" | "combinatorics" | "geometry" | "calculus" | "probability" | "linear-algebra" | "analysis",
  "promptLatex": string,
  "finalAnswer": string,
  "hints": [string, string, string],  // exactly 3, increasingly specific
  "stepByStepSolutionLatex": string[],  // complete proof, one logical step per entry
  "sanityVerificationNotes": string
}

For a trivia card, produce JSON matching this shape:
{
  "id": string,
  "category": "history-of-math" | "famous-theorems" | "mathematicians" | "notation-and-symbols" | "applied-math" | "math-in-culture",
  "eloRating": integer (100-3000),
  "question": string,
  "correctAnswer": string,
  "acceptableAlternatives": string[],
  "hints": [string, string, string],  // exactly 3
  "learnMoreArticle": string
}

Rules:
- The final answer must be a single deterministic value — never a range, an approximation, or "it depends".
- Hints must escalate: hint 1 nudges toward the approach, hint 2 narrows the method, hint 3 is nearly the answer.
- Every LaTeX expression must have balanced $ / $$ delimiters and balanced \\begin/\\end environments.
- Before returning a math problem, call the verify_math tool with { promptLatex, stepByStepSolutionLatex, finalAnswer } and fix any reported issues before responding.`,
  model: 'google/gemini-2.5-flash',
  tools: {
    verify_math: verifyMathTool,
  },
});
