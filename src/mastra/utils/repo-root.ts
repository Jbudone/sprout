import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// A relative path (or one derived from import.meta.dirname) is unreliable here:
// mastra dev, mastra build/start, and a direct script all resolve differently,
// and dev bundles everything into .mastra/output/, which doesn't mirror the
// src/ tree depth. Asking git is stable across all of them.
//
// Run from this file's own directory rather than process.cwd(): the dev server
// can end up with a stale working directory (src/mastra/public gets recreated
// on rebuild), after which `git rev-parse` fails with "Unable to read current
// working directory" and every /quiz route 500s. Both src/mastra/utils/ and
// .mastra/output/ are inside the repo, so either resolves to the same root.
// Resolved once at module load so it's only paid once.
const repoRoot = execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: import.meta.dirname }).then(({ stdout }) => stdout.trim());
// Avoid an unhandled rejection if nothing awaits it before it fails.
repoRoot.catch(() => {});

export function getRepoRoot(): Promise<string> {
  return repoRoot;
}
