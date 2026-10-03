import { createStep, createWorkflow } from '@mastra/core/workflows';
import { noopObserve } from '@mastra/core/tools';
import { RequestContext } from '@mastra/core/request-context';
import { z } from 'zod';
import { worktreeTool } from '../tools/worktree-tool';
import { builderWorkspace } from '../agents/builder';

const FEATURE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const MAX_BUILD_ATTEMPTS = 3;

const BuildCycleSchema = z.object({
  featureId: z.string(),
  plan: z.string(),
  branch: z.string(),
  worktreePath: z.string(),
  baseSha: z.string(),
  approved: z.boolean(),
  reviewNotes: z.string(),
  implementationSummary: z.string(),
});

const HumanDecisionSchema = BuildCycleSchema.extend({
  humanApproved: z.boolean(),
  humanNotes: z.string(),
});

const FinalResultSchema = z.object({
  featureId: z.string(),
  branch: z.string(),
  worktreePath: z.string(),
  status: z.enum(['merged', 'human-rejected', 'review-rejected']),
  summary: z.string(),
});

async function callWorktreeTool(
  input: Parameters<NonNullable<typeof worktreeTool.execute>>[0],
  requestContext: RequestContext,
) {
  if (!worktreeTool.execute) throw new Error('worktreeTool has no execute function');
  const result = await worktreeTool.execute(input, { requestContext, observe: noopObserve });
  if (!result || 'error' in result) {
    throw new Error(`worktree-tool returned invalid output: ${JSON.stringify(result)}`);
  }
  return result;
}

const planStep = createStep({
  id: 'plan',
  description: 'Lead Architect drafts an implementation plan for the requested feature.',
  inputSchema: z.object({
    featureId: z.string().regex(FEATURE_ID_PATTERN),
    request: z.string().min(1),
  }),
  outputSchema: z.object({
    featureId: z.string(),
    plan: z.string(),
  }),
  execute: async ({ inputData, mastra }) => {
    const architect = mastra?.getAgent('architect');
    if (!architect) throw new Error('architect agent is not registered on this Mastra instance');

    const result = await architect.generate(
      `Feature request for the Advanced Math Quiz & Trivia platform:\n\n${inputData.request}\n\nProduce a concise, numbered implementation plan a builder can execute inside an isolated git worktree.`,
    );

    return {
      featureId: inputData.featureId,
      plan: result.text,
    };
  },
});

const createSandboxStep = createStep({
  id: 'create-sandbox',
  description: 'Creates an isolated git worktree sandbox so the plan can be implemented without touching the primary tree.',
  inputSchema: z.object({
    featureId: z.string(),
    plan: z.string(),
  }),
  outputSchema: BuildCycleSchema,
  execute: async ({ inputData, requestContext }) => {
    const result = await callWorktreeTool(
      { action: 'create', featureId: inputData.featureId, branchPrefix: 'exp', baseRef: 'HEAD' },
      requestContext,
    );
    if (!result.success) throw new Error(`Sandbox creation failed: ${result.message}`);
    if (!result.baseSha || !result.baseBranch) {
      throw new Error('worktree-tool did not return baseSha/baseBranch on create.');
    }

    return {
      featureId: inputData.featureId,
      plan: inputData.plan,
      branch: result.branch,
      worktreePath: result.worktreePath,
      baseSha: result.baseSha,
      approved: false,
      reviewNotes: '',
      implementationSummary: '',
    };
  },
});

const implementStep = createStep({
  id: 'implement',
  description: "Builder implements the plan (and any prior review feedback) inside the sandbox worktree.",
  inputSchema: BuildCycleSchema,
  outputSchema: BuildCycleSchema,
  execute: async ({ inputData, mastra }) => {
    const builder = mastra?.getAgent('builder');
    if (!builder) throw new Error('builder agent is not registered on this Mastra instance');

    const requestContext = new RequestContext();
    requestContext.set('worktreePath', inputData.worktreePath);

    const feedbackSection = inputData.reviewNotes
      ? `\n\nThe previous attempt was rejected by the Review Gate. Address this feedback:\n${inputData.reviewNotes}`
      : '';

    const result = await builder.generate(
      `Implement this plan inside the sandbox at ${inputData.worktreePath} (branch ${inputData.branch}):\n\n${inputData.plan}${feedbackSection}`,
      { requestContext },
    );

    return {
      ...inputData,
      approved: false,
      reviewNotes: '',
      implementationSummary: result.text,
    };
  },
});

const reviewStep = createStep({
  id: 'review',
  description: 'Review Gate audits the sandbox diff against the plan before human approval.',
  inputSchema: BuildCycleSchema,
  outputSchema: BuildCycleSchema,
  execute: async ({ inputData, mastra, requestContext }) => {
    const diffResult = await callWorktreeTool(
      { action: 'diff', featureId: inputData.featureId, branchPrefix: 'exp', baseRef: 'HEAD', baseSha: inputData.baseSha },
      requestContext,
    );
    if (!diffResult.success) throw new Error(`Failed to compute sandbox diff: ${diffResult.message}`);

    const reviewer = mastra?.getAgent('reviewer');
    if (!reviewer) throw new Error('reviewer agent is not registered on this Mastra instance');

    const diffText = diffResult.diff && diffResult.diff.length > 0 ? diffResult.diff : '(no changes)';

    const result = await reviewer.generate(
      `Plan:\n${inputData.plan}\n\nBuilder's implementation summary:\n${inputData.implementationSummary}\n\nGit diff:\n${diffText}`,
    );

    return {
      ...inputData,
      approved: /^approved/i.test(result.text.trim()),
      reviewNotes: result.text,
    };
  },
});

const buildCycleWorkflow = createWorkflow({
  id: 'build-cycle',
  description: 'Implements the plan, then runs it through the Review Gate.',
  inputSchema: BuildCycleSchema,
  outputSchema: BuildCycleSchema,
})
  .then(implementStep)
  .then(reviewStep)
  .commit();

const humanApprovalStep = createStep({
  id: 'human-approval',
  description: 'Suspends the workflow until a human approves merging the reviewed branch.',
  inputSchema: BuildCycleSchema,
  outputSchema: HumanDecisionSchema,
  resumeSchema: z.object({
    approved: z.boolean(),
    notes: z.string().optional(),
  }),
  suspendSchema: z.object({
    reason: z.string(),
    branch: z.string(),
    worktreePath: z.string(),
    reviewNotes: z.string(),
  }),
  execute: async ({ inputData, resumeData, suspend }) => {
    if (!resumeData) {
      return await suspend({
        reason: 'Review Gate approved this branch. Confirm to merge it into the primary branch.',
        branch: inputData.branch,
        worktreePath: inputData.worktreePath,
        reviewNotes: inputData.reviewNotes,
      });
    }

    return {
      ...inputData,
      humanApproved: resumeData.approved,
      humanNotes: resumeData.notes ?? '',
    };
  },
});

const mergeOrRejectStep = createStep({
  id: 'merge-or-reject',
  description: 'Merges the sandbox branch and cleans up on human approval, or leaves it in place on rejection.',
  inputSchema: HumanDecisionSchema,
  outputSchema: FinalResultSchema,
  execute: async ({ inputData, requestContext }) => {
    if (!inputData.humanApproved) {
      return {
        featureId: inputData.featureId,
        branch: inputData.branch,
        worktreePath: inputData.worktreePath,
        status: 'human-rejected' as const,
        summary: `Human rejected the merge.${
          inputData.humanNotes ? ` Notes: ${inputData.humanNotes}` : ''
        } The sandbox worktree at ${inputData.worktreePath} was left in place for manual inspection.`,
      };
    }

    const commitResult = await callWorktreeTool(
      { action: 'commit', featureId: inputData.featureId, branchPrefix: 'exp', baseRef: 'HEAD' },
      requestContext,
    );
    if (!commitResult.success) throw new Error(`Failed to commit sandbox changes: ${commitResult.message}`);

    const mergeResult = await callWorktreeTool(
      { action: 'merge', featureId: inputData.featureId, branchPrefix: 'exp', baseRef: 'HEAD' },
      requestContext,
    );
    if (!mergeResult.success) throw new Error(`Merge failed: ${mergeResult.message}`);

    const removeResult = await callWorktreeTool(
      { action: 'remove', featureId: inputData.featureId, branchPrefix: 'exp', baseRef: 'HEAD' },
      requestContext,
    );
    if (!removeResult.success) {
      throw new Error(`Merged ${inputData.branch} but failed to remove the sandbox worktree: ${removeResult.message}`);
    }

    builderWorkspace.clearSandboxCache(inputData.worktreePath);

    return {
      featureId: inputData.featureId,
      branch: inputData.branch,
      worktreePath: inputData.worktreePath,
      status: 'merged' as const,
      summary: `Merged ${inputData.branch} and removed the sandbox worktree.`,
    };
  },
});

const humanGateAndMergeWorkflow = createWorkflow({
  id: 'human-gate-and-merge',
  description: 'Pauses for human approval, then merges the branch and cleans up the sandbox.',
  inputSchema: BuildCycleSchema,
  outputSchema: FinalResultSchema,
})
  .then(humanApprovalStep)
  .then(mergeOrRejectStep)
  .commit();

const reportRejectionStep = createStep({
  id: 'report-rejection',
  description: 'Reports that the build/review cycle was rejected after the maximum number of attempts.',
  inputSchema: BuildCycleSchema,
  outputSchema: FinalResultSchema,
  execute: async ({ inputData }) => ({
    featureId: inputData.featureId,
    branch: inputData.branch,
    worktreePath: inputData.worktreePath,
    status: 'review-rejected' as const,
    summary: `Rejected after ${MAX_BUILD_ATTEMPTS} build/review attempts. Last review notes:\n${inputData.reviewNotes}\n\nThe sandbox worktree at ${inputData.worktreePath} was left in place for manual inspection.`,
  }),
});

export const featureDevWorkflow = createWorkflow({
  id: 'feature-dev',
  description:
    'Plans a feature, implements it inside an isolated git worktree sandbox, loops through Builder/Review Gate cycles until approved (or a max attempt count is hit), then waits for human approval before merging and cleaning up.',
  inputSchema: z.object({
    featureId: z.string().regex(FEATURE_ID_PATTERN).describe('Short slug used for the exp/<id> branch and sandbox dir.'),
    request: z.string().min(1),
  }),
  outputSchema: FinalResultSchema,
})
  .then(planStep)
  .then(createSandboxStep)
  .dountil(
    buildCycleWorkflow,
    async ({ inputData, iterationCount }) => inputData.approved || iterationCount >= MAX_BUILD_ATTEMPTS,
  )
  .branch([
    [async ({ inputData }) => inputData.approved, humanGateAndMergeWorkflow],
    [async ({ inputData }) => !inputData.approved, reportRejectionStep],
  ])
  .map(async ({ inputData }) => inputData['human-gate-and-merge'] ?? inputData['report-rejection'])
  .commit();
