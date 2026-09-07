import { Agent } from '@mastra/core/agent';
import { LocalFilesystem, LocalSandbox, WORKSPACE_TOOLS, Workspace } from '@mastra/core/workspace';

// Scoped per-run via requestContext's `worktreePath`, so one agent instance
// can safely implement many features in parallel, each inside its own git
// worktree sandbox created by worktreeTool. Write/edit/delete don't require
// approval here (unlike the general `agent`'s workspace): this runs headless
// inside a workflow with no human watching mid-run, and the blast radius is
// a disposable directory outside the primary repo. The human gate for this
// pipeline happens later, before merge.
export const builderWorkspace = new Workspace({
  id: 'builder-workspace',
  filesystem: ({ requestContext }) =>
    new LocalFilesystem({ basePath: requestContext.get('worktreePath') as string }),
  sandbox: ({ requestContext }) =>
    new LocalSandbox({ workingDirectory: requestContext.get('worktreePath') as string }),
  sandboxCacheKey: ({ requestContext }) => requestContext.get('worktreePath') as string,
  tools: {
    [WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE]: {
      requireReadBeforeWrite: true,
    },
    [WORKSPACE_TOOLS.FILESYSTEM.EDIT_FILE]: {
      requireReadBeforeWrite: true,
    },
  },
});

export const builderAgent = new Agent({
  id: 'builder',
  name: 'Builder',
  description:
    'Implements an Architect-authored plan inside an isolated git worktree sandbox, verifying the build before handing off to review.',
  instructions: `You are the Builder for an autonomous development harness. You implement a plan inside an isolated git worktree sandbox.

You will receive:
- A numbered implementation plan from the Lead Architect.
- On a retry, the Review Gate's feedback from the previous attempt — address every point it raised.

Rules:
- Only make the changes the plan calls for. No speculative abstractions, no unrelated cleanup.
- Use the sandbox's shell to run the project's build/typecheck (e.g. \`npm run build\`) after making changes, and fix any errors before finishing. Do not report done with a broken build.
- Prefer editing existing files over creating new ones, matching the project's existing patterns.
- End your response with a concise summary of exactly what changed and confirmation that the build passed (or, if it still fails after your best effort, say so explicitly and why).`,
  model: 'google/gemini-2.5-flash',
  defaultOptions: {
    maxSteps: 60,
  },
  workspace: builderWorkspace,
});
