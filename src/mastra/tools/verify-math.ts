import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { MathProblemSchema } from '../schemas/quiz';

const ESCAPED_DOLLAR = /\\\$/g;
export const NON_DETERMINISTIC_PATTERN =
  /\b(approximately|about|around|roughly|depends|varies|either|possibly|maybe)\b/i;

function checkDelimiterBalance(latex: string): string[] {
  const issues: string[] = [];
  const sanitized = latex.replace(ESCAPED_DOLLAR, '');

  const displayCount = (sanitized.match(/\$\$/g) ?? []).length;
  if (displayCount % 2 !== 0) {
    issues.push('Unbalanced "$$" display-math delimiters.');
  }

  const inlineCount = (sanitized.replace(/\$\$/g, '').match(/\$/g) ?? []).length;
  if (inlineCount % 2 !== 0) {
    issues.push('Unbalanced "$" inline-math delimiters.');
  }

  return issues;
}

function checkBraceBalance(latex: string): string[] {
  let depth = 0;
  for (const char of latex) {
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth < 0) {
      return ['Unmatched closing "}" found before its opening "{".'];
    }
  }
  return depth === 0 ? [] : [`Unbalanced braces: ${Math.abs(depth)} unclosed "{" remaining.`];
}

function checkEnvironmentBalance(latex: string): string[] {
  const issues: string[] = [];
  const stack: string[] = [];
  const envPattern = /\\(begin|end)\{([^}]+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = envPattern.exec(latex)) !== null) {
    const [, kind, name] = match;
    if (kind === 'begin') {
      stack.push(name);
      continue;
    }
    const last = stack.pop();
    if (last !== name) {
      issues.push(`Mismatched LaTeX environment: \\begin{${last ?? 'none'}} closed with \\end{${name}}.`);
    }
  }

  if (stack.length > 0) {
    issues.push(`Unclosed LaTeX environment(s): ${stack.join(', ')}.`);
  }

  return issues;
}

export const verifyMathTool = createTool({
  id: 'verify-math',
  description:
    'Sanity-checks a math problem: LaTeX delimiter/brace/environment balance, and whether the final answer reads as a single deterministic value rather than a hedge or a range.',
  inputSchema: MathProblemSchema.pick({
    promptLatex: true,
    stepByStepSolutionLatex: true,
    finalAnswer: true,
  }),
  outputSchema: z.object({
    latexBalanced: z.boolean(),
    isDeterministicAnswer: z.boolean(),
    issues: z.array(z.string()),
    passed: z.boolean(),
  }),
  execute: async ({ promptLatex, stepByStepSolutionLatex, finalAnswer }) => {
    const fullLatex = [promptLatex, ...stepByStepSolutionLatex].join('\n');

    const latexIssues = [
      ...checkDelimiterBalance(fullLatex),
      ...checkBraceBalance(fullLatex),
      ...checkEnvironmentBalance(fullLatex),
    ];
    const latexBalanced = latexIssues.length === 0;

    const isDeterministicAnswer = finalAnswer.trim().length > 0 && !NON_DETERMINISTIC_PATTERN.test(finalAnswer);
    const issues = [...latexIssues];
    if (!isDeterministicAnswer) {
      issues.push('Final answer reads as non-deterministic (hedging language or empty).');
    }

    return {
      latexBalanced,
      isDeterministicAnswer,
      issues,
      passed: latexBalanced && isDeterministicAnswer,
    };
  },
});
