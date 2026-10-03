import { Agent } from '@mastra/core/agent';
import { WORKSPACE_TOOLS } from '@mastra/core/workspace';
import { createWorktreeWorkspace } from '../lib/worktree-workspace';

// Unlike builderWorkspace, this keeps delete approval on: a human drives this
// agent interactively (via Studio, setting requestContext.worktreePath to the
// sandbox from ideaExperimentWorkflow), so the usual safety default applies.
export const experimenterWorkspace = createWorktreeWorkspace('experimenter-workspace', {
  [WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE]: {
    requireReadBeforeWrite: true,
  },
  [WORKSPACE_TOOLS.FILESYSTEM.EDIT_FILE]: {
    requireReadBeforeWrite: true,
  },
  [WORKSPACE_TOOLS.FILESYSTEM.DELETE]: {
    requireApproval: true,
  },
});

export const experimenterAgent = new Agent({
  id: 'experimenter',
  name: 'Experimenter',
  description:
    'Interactively explores an idea inside its isolated git worktree sandbox — set requestContext.worktreePath to the sandbox from ideaExperimentWorkflow before chatting.',
  instructions: `You help explore an experimental idea inside an isolated git worktree sandbox. A human is driving this conversation interactively — there is no plan to follow and no fixed spec.

Approach:
- Start from the idea's own description (the human will share it, or you can ask).
- Try things. It's fine for the sandbox to be messy, half-finished, or to end up somewhere different from where it started — that's the point of an experiment.
- Keep the human in the loop on what you're trying and why, and flag tradeoffs or surprises as you find them.
- There is no requirement to keep the build green throughout, but if the human seems ready to wrap up, it's worth checking whether things build/run before they decide whether to integrate or abandon.
- When the human seems satisfied with a direction, summarize what you did, what worked, what didn't, and anything worth carrying into the idea's notes regardless of whether it gets integrated.`,
  model: 'google/gemini-2.5-flash',
  defaultOptions: {
    maxSteps: 100,
  },
  workspace: experimenterWorkspace,
});
