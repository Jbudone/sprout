import { LocalFilesystem, LocalSandbox, Workspace, type WorkspaceToolsConfig } from '@mastra/core/workspace';

// Scoped per-run via requestContext's `worktreePath`, so one agent instance
// can safely operate on many different git worktree sandboxes (created by
// worktreeTool), each identified by the caller's requestContext rather than
// a fixed directory baked into the agent.
export function createWorktreeWorkspace(id: string, tools?: WorkspaceToolsConfig): Workspace {
  return new Workspace({
    id,
    filesystem: ({ requestContext }) =>
      new LocalFilesystem({ basePath: requestContext.get('worktreePath') as string }),
    sandbox: ({ requestContext }) =>
      new LocalSandbox({ workingDirectory: requestContext.get('worktreePath') as string }),
    sandboxCacheKey: ({ requestContext }) => requestContext.get('worktreePath') as string,
    tools,
  });
}
