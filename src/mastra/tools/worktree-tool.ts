import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getRepoRoot } from '../utils/repo-root';

const execFileAsync = promisify(execFile);

// Keeps featureId safe to interpolate into a branch name and directory path
// (no shell is used, but this also blocks path traversal like `../../etc`).
const FEATURE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

export const worktreeTool = createTool({
  id: 'worktree-tool',
  description:
    'Creates, diffs, commits, merges, or removes an isolated git worktree sandbox (for a feature build or an idea experiment), so prototyping never touches the primary working tree.',
  inputSchema: z.object({
    action: z.enum(['create', 'diff', 'commit', 'merge', 'remove']),
    featureId: z
      .string()
      .regex(FEATURE_ID_PATTERN, 'featureId must be alphanumeric, optionally with "-" or "_", up to 64 chars'),
    branchPrefix: z
      .string()
      .regex(/^[a-zA-Z0-9-]{1,32}$/)
      .default('exp')
      .describe('Branch namespace, e.g. "exp" for feature-dev or "idea" for idea-experiment. Must match across all actions for the same sandbox.'),
    baseRef: z.string().default('HEAD').describe('Ref to branch the sandbox from. Only used for "create".'),
    baseSha: z.string().optional().describe('Commit the sandbox branched from. Required for "diff".'),
  }),
  outputSchema: z.object({
    action: z.enum(['create', 'diff', 'commit', 'merge', 'remove']),
    featureId: z.string(),
    branch: z.string(),
    worktreePath: z.string(),
    success: z.boolean(),
    message: z.string(),
    baseSha: z.string().optional(),
    baseBranch: z.string().optional(),
    diff: z.string().optional(),
    hasChanges: z.boolean().optional(),
  }),
  execute: async ({ action, featureId, branchPrefix, baseRef, baseSha }) => {
    const branch = `${branchPrefix}/${featureId}`;
    const repoRoot = await getRepoRoot();
    const worktreePath = path.resolve(repoRoot, '..', 'sandboxes', featureId);

    try {
      if (action === 'create') {
        const [{ stdout: resolvedSha }, { stdout: currentBranch }] = await Promise.all([
          execFileAsync('git', ['rev-parse', baseRef], { cwd: repoRoot }),
          execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot }),
        ]);
        await execFileAsync('git', ['worktree', 'add', '-B', branch, worktreePath, baseRef], { cwd: repoRoot });
        return {
          action,
          featureId,
          branch,
          worktreePath,
          success: true,
          message: `Created worktree sandbox at ${worktreePath} on branch ${branch}.`,
          baseSha: resolvedSha.trim(),
          baseBranch: currentBranch.trim(),
        };
      }

      if (action === 'diff') {
        if (!baseSha) throw new Error('baseSha is required for the "diff" action.');
        // Stage first so new (untracked) files show up too: a plain `git diff`
        // only covers tracked files, which would silently hide anything the
        // builder created rather than edited.
        await execFileAsync('git', ['add', '-A'], { cwd: worktreePath });
        const { stdout } = await execFileAsync('git', ['diff', '--cached', baseSha], { cwd: worktreePath });
        return {
          action,
          featureId,
          branch,
          worktreePath,
          success: true,
          message: stdout.trim().length > 0 ? 'Diff computed.' : 'No changes found in worktree.',
          diff: stdout,
          hasChanges: stdout.trim().length > 0,
        };
      }

      if (action === 'commit') {
        const { stdout: statusOut } = await execFileAsync('git', ['status', '--porcelain'], { cwd: worktreePath });
        if (statusOut.trim().length === 0) {
          return {
            action,
            featureId,
            branch,
            worktreePath,
            success: true,
            message: 'Nothing to commit; worktree already matches its last commit.',
          };
        }
        await execFileAsync('git', ['add', '-A'], { cwd: worktreePath });
        await execFileAsync('git', ['commit', '-m', `${branchPrefix}: ${featureId}`], {
          cwd: worktreePath,
        });
        return {
          action,
          featureId,
          branch,
          worktreePath,
          success: true,
          message: `Committed pending changes on ${branch}.`,
        };
      }

      if (action === 'merge') {
        // Merges into whatever branch is currently checked out in repoRoot.
        // This tool assumes a single-actor workflow where the primary branch
        // hasn't moved since the sandbox was created. Requires the sandbox's
        // changes to already be committed on `branch` (see the "commit" action).
        await execFileAsync('git', ['merge', '--no-ff', branch, '-m', `Merge ${branch}`], {
          cwd: repoRoot,
        });
        return {
          action,
          featureId,
          branch,
          worktreePath,
          success: true,
          message: `Merged ${branch} into the current branch of ${repoRoot}.`,
        };
      }

      await execFileAsync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repoRoot });
      return {
        action,
        featureId,
        branch,
        worktreePath,
        success: true,
        message: `Removed worktree sandbox at ${worktreePath}.`,
      };
    } catch (error) {
      return {
        action,
        featureId,
        branch,
        worktreePath,
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
