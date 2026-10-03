import { createStep, createWorkflow } from '@mastra/core/workflows';
import { noopObserve } from '@mastra/core/tools';
import { z } from 'zod';
import { worktreeTool } from '../tools/worktree-tool';
import { ideasTool } from '../tools/ideas-tool';
import { experimenterWorkspace } from '../agents/experimenter';

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const BRANCH_PREFIX = 'idea';

const ExperimentStateSchema = z.object({
  ideaSlug: z.string(),
  branch: z.string(),
  worktreePath: z.string(),
});

const FinalResultSchema = z.object({
  ideaSlug: z.string(),
  status: z.enum(['integrated', 'abandoned']),
  summary: z.string(),
});

async function callWorktreeTool(
  input: Parameters<NonNullable<typeof worktreeTool.execute>>[0],
  requestContext: Parameters<NonNullable<typeof worktreeTool.execute>>[1]['requestContext'],
) {
  if (!worktreeTool.execute) throw new Error('worktreeTool has no execute function');
  const result = await worktreeTool.execute(input, { requestContext, observe: noopObserve });
  if (!result || 'error' in result) {
    throw new Error(`worktree-tool returned invalid output: ${JSON.stringify(result)}`);
  }
  return result;
}

async function callIdeasTool(
  input: Parameters<NonNullable<typeof ideasTool.execute>>[0],
  requestContext: Parameters<NonNullable<typeof ideasTool.execute>>[1]['requestContext'],
) {
  if (!ideasTool.execute) throw new Error('ideasTool has no execute function');
  const result = await ideasTool.execute(input, { requestContext, observe: noopObserve });
  if (!result || 'error' in result) {
    throw new Error(`ideas-tool returned invalid output: ${JSON.stringify(result)}`);
  }
  return result;
}

const loadIdeaStep = createStep({
  id: 'load-idea',
  description: 'Loads the idea and confirms it is still open to experiment on.',
  inputSchema: z.object({ ideaSlug: z.string().regex(SLUG_PATTERN) }),
  outputSchema: z.object({ ideaSlug: z.string(), title: z.string() }),
  execute: async ({ inputData, requestContext }) => {
    const result = await callIdeasTool({ action: 'get', slug: inputData.ideaSlug }, requestContext);
    if (!result.success || !result.idea) throw new Error(`Failed to load idea: ${result.message}`);
    if (result.idea.status === 'integrated') {
      throw new Error(`Idea "${inputData.ideaSlug}" is already integrated — nothing to experiment on.`);
    }

    return { ideaSlug: inputData.ideaSlug, title: result.idea.title };
  },
});

const createExperimentSandboxStep = createStep({
  id: 'create-experiment-sandbox',
  description: 'Creates an isolated git worktree sandbox for the idea and marks it as experimenting.',
  inputSchema: z.object({ ideaSlug: z.string(), title: z.string() }),
  outputSchema: ExperimentStateSchema,
  execute: async ({ inputData, requestContext }) => {
    const created = await callWorktreeTool(
      { action: 'create', featureId: inputData.ideaSlug, branchPrefix: BRANCH_PREFIX, baseRef: 'HEAD' },
      requestContext,
    );
    if (!created.success) throw new Error(`Sandbox creation failed: ${created.message}`);

    await callIdeasTool(
      {
        action: 'updateStatus',
        slug: inputData.ideaSlug,
        status: 'experimenting',
        branch: created.branch,
        worktreePath: created.worktreePath,
      },
      requestContext,
    );

    return { ideaSlug: inputData.ideaSlug, branch: created.branch, worktreePath: created.worktreePath };
  },
});

const experimentDecisionStep = createStep({
  id: 'experiment-decision',
  description: 'Suspends indefinitely for interactive experimentation; resumes to keep going, integrate, or abandon.',
  inputSchema: ExperimentStateSchema,
  outputSchema: FinalResultSchema,
  resumeSchema: z.object({
    decision: z.enum(['keep-experimenting', 'integrate', 'abandon']),
    notes: z.string().optional(),
  }),
  suspendSchema: z.object({
    reason: z.string(),
    ideaSlug: z.string(),
    branch: z.string(),
    worktreePath: z.string(),
  }),
  execute: async ({ inputData, resumeData, suspend, requestContext }) => {
    if (!resumeData || resumeData.decision === 'keep-experimenting') {
      return await suspend({
        reason:
          'Experiment sandbox ready. In Mastra Studio, chat with the `experimenter` agent with requestContext.worktreePath set to this sandbox path. Resume this step with a decision (keep-experimenting / integrate / abandon) when ready.',
        ideaSlug: inputData.ideaSlug,
        branch: inputData.branch,
        worktreePath: inputData.worktreePath,
      });
    }

    if (resumeData.decision === 'integrate') {
      const commitResult = await callWorktreeTool(
        { action: 'commit', featureId: inputData.ideaSlug, branchPrefix: BRANCH_PREFIX, baseRef: 'HEAD' },
        requestContext,
      );
      if (!commitResult.success) throw new Error(`Failed to commit experiment changes: ${commitResult.message}`);

      const mergeResult = await callWorktreeTool(
        { action: 'merge', featureId: inputData.ideaSlug, branchPrefix: BRANCH_PREFIX, baseRef: 'HEAD' },
        requestContext,
      );
      if (!mergeResult.success) throw new Error(`Merge failed: ${mergeResult.message}`);

      const removeResult = await callWorktreeTool(
        { action: 'remove', featureId: inputData.ideaSlug, branchPrefix: BRANCH_PREFIX, baseRef: 'HEAD' },
        requestContext,
      );
      if (!removeResult.success) {
        throw new Error(`Merged ${inputData.branch} but failed to remove the sandbox worktree: ${removeResult.message}`);
      }

      experimenterWorkspace.clearSandboxCache(inputData.worktreePath);

      await callIdeasTool(
        { action: 'updateStatus', slug: inputData.ideaSlug, status: 'integrated', note: resumeData.notes },
        requestContext,
      );

      return {
        ideaSlug: inputData.ideaSlug,
        status: 'integrated' as const,
        summary: `Merged ${inputData.branch} and removed the sandbox worktree.`,
      };
    }

    const removeResult = await callWorktreeTool(
      { action: 'remove', featureId: inputData.ideaSlug, branchPrefix: BRANCH_PREFIX, baseRef: 'HEAD' },
      requestContext,
    );
    if (!removeResult.success) throw new Error(`Failed to remove the sandbox worktree: ${removeResult.message}`);

    experimenterWorkspace.clearSandboxCache(inputData.worktreePath);

    await callIdeasTool(
      { action: 'updateStatus', slug: inputData.ideaSlug, status: 'abandoned', note: resumeData.notes },
      requestContext,
    );

    return {
      ideaSlug: inputData.ideaSlug,
      status: 'abandoned' as const,
      summary: `Removed the sandbox worktree. Branch ${inputData.branch} still exists in git history if this is revisited later.`,
    };
  },
});

export const ideaExperimentWorkflow = createWorkflow({
  id: 'idea-experiment',
  description:
    'Provisions an isolated git worktree sandbox for an idea, then suspends for interactive experimentation (via the experimenter agent in Studio) until a human resumes with a decision to integrate or abandon.',
  inputSchema: z.object({ ideaSlug: z.string().regex(SLUG_PATTERN) }),
  outputSchema: FinalResultSchema,
})
  .then(loadIdeaStep)
  .then(createExperimentSandboxStep)
  .then(experimentDecisionStep)
  .commit();
