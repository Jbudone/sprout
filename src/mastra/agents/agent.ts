import { pathToFileURL } from 'node:url';
import { Agent } from '@mastra/core/agent';
import { TaskSignalProvider } from '@mastra/core/signals';
import { askUserTool, webFetchTool, webSearchTool } from '@mastra/core/tools';
import { LocalFilesystem, LocalSandbox, WORKSPACE_TOOLS, Workspace } from '@mastra/core/workspace';
import { Memory } from '@mastra/memory';
import { startScheduleTool, stopScheduleTool } from '../tools/schedule-tools';
import { ideasTool } from '../tools/ideas-tool';

const workspacePath = 'workspace';

const workspace = new Workspace({
  id: 'agent-workspace',
  name: 'Agent Workspace',
  filesystem: new LocalFilesystem({
    basePath: workspacePath,
  }),
  sandbox: new LocalSandbox({
    workingDirectory: workspacePath,
  }),
  tools: {
    [WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE]: {
      requireReadBeforeWrite: true,
    },
    [WORKSPACE_TOOLS.FILESYSTEM.EDIT_FILE]: {
      requireReadBeforeWrite: true,
    },
    [WORKSPACE_TOOLS.FILESYSTEM.DELETE]: {
      requireApproval: true,
    },
  },
});

export const agent = new Agent({
  id: 'agent',
  name: 'Agent',
  description:
    'A project assistant for an Advanced Math Quiz & Trivia platform — managing trivia content, reviewing ideas, running workflows, and answering questions about the project.',
  metadata: {
    suggestedPrompts: [
      'List all trivia content in the library.',
      'What ideas are currently proposed?',
      'How do I add new trivia content?',
      'What is the quality bar for trivia cards?',
    ],
  },
  instructions: `You are the project assistant for an Advanced Math Quiz & Trivia platform built with Mastra. Your job is to help users work with trivia content, review ideas, and understand how to use this harness.

When the user greets you or does not have a specific task, invite them to try one of the suggested prompts.

Core responsibilities:
- Help users add, review, and manage trivia and math content (via the content-creation workflow or direct curation).
- Track and report on ideas (proposed, experimenting, integrated, abandoned).
- Report on project state: what content exists, what quality checks pass/fail, what's queued.
- Answer questions about the project architecture, workflows, and quality standards.

Ask concise questions when something is unclear. When the user wants to log, list, or check on an idea, use the ideas tool — it's a durable file-based tracker, not conversation memory.

For local files in the workspace, end with a plain-text URL using ${pathToFileURL(`${workspacePath}/`).href}; avoid Markdown links, localhost, /workspace, relative paths, and static-file servers.
`,
  model: 'google/gemini-3.5-flash',
  defaultOptions: {
    maxSteps: 100,
    autoResumeSuspendedTools: true,
  },
  memory: new Memory({
    options: {
      generateTitle: true,
      observationalMemory: {
        model: 'google/gemini-3.5-flash',
      },
    },
  }),
  workspace,
  tools: {
    ask_user: askUserTool,
    start_schedule: startScheduleTool,
    stop_schedule: stopScheduleTool,
    web_fetch: webFetchTool,
    web_search: webSearchTool,
    ideas: ideasTool,
  },
  signals: [new TaskSignalProvider()],
});
