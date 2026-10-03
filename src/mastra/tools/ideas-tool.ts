import path from 'node:path';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getRepoRoot } from '../utils/repo-root';

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const STATUSES = ['proposed', 'experimenting', 'integrated', 'abandoned'] as const;
const FRONTMATTER_KEYS = ['id', 'title', 'status', 'created', 'branch', 'worktreePath'] as const;

type Idea = {
  id: string;
  title: string;
  status: (typeof STATUSES)[number];
  created: string;
  branch: string;
  worktreePath: string;
  description: string;
};

async function getIdeasRoot(): Promise<string> {
  const root = path.join(await getRepoRoot(), 'ideas');
  await mkdir(root, { recursive: true });
  return root;
}

function serializeIdea(idea: Idea): string {
  const frontmatter = FRONTMATTER_KEYS.map(key => `${key}: ${idea[key] ?? ''}`).join('\n');
  return `---\n${frontmatter}\n---\n\n${idea.description}\n`;
}

function parseIdea(raw: string): Idea {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error('Idea file is missing its frontmatter block.');

  const [, frontmatterBlock, body] = match;
  const fields: Record<string, string> = {};
  for (const line of frontmatterBlock.split('\n')) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    fields[key] = value;
  }

  return {
    id: fields.id ?? '',
    title: fields.title ?? '',
    status: (fields.status as Idea['status']) ?? 'proposed',
    created: fields.created ?? '',
    branch: fields.branch ?? '',
    worktreePath: fields.worktreePath ?? '',
    description: body.trim(),
  };
}

async function readIdea(slug: string): Promise<Idea> {
  const filePath = path.join(await getIdeasRoot(), `${slug}.md`);
  const raw = await readFile(filePath, 'utf-8').catch(() => {
    throw new Error(`No idea found with slug "${slug}".`);
  });
  return parseIdea(raw);
}

async function writeIdea(slug: string, idea: Idea): Promise<void> {
  const filePath = path.join(await getIdeasRoot(), `${slug}.md`);
  await writeFile(filePath, serializeIdea(idea));
}

const IdeaSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(STATUSES),
  created: z.string(),
  branch: z.string(),
  worktreePath: z.string(),
  description: z.string(),
});

export const ideasTool = createTool({
  id: 'ideas-tool',
  description:
    'Tracks ideas and experimental features as Markdown files under ideas/ — create, list, get, or update the status of an idea (e.g. when starting or finishing an experiment).',
  inputSchema: z.object({
    action: z.enum(['create', 'list', 'get', 'updateStatus']),
    slug: z
      .string()
      .regex(SLUG_PATTERN, 'slug must be lowercase alphanumeric with optional "-", up to 64 chars')
      .optional()
      .describe('Required for create/get/updateStatus.'),
    title: z.string().optional().describe('Required for create.'),
    description: z.string().optional().describe('Required for create.'),
    status: z.enum(STATUSES).optional().describe('Required for updateStatus.'),
    branch: z.string().optional().describe('updateStatus only.'),
    worktreePath: z.string().optional().describe('updateStatus only.'),
    note: z.string().optional().describe('updateStatus only — appended to the idea file as a dated update.'),
  }),
  outputSchema: z.object({
    action: z.enum(['create', 'list', 'get', 'updateStatus']),
    idea: IdeaSchema.optional(),
    ideas: z.array(IdeaSchema.omit({ description: true })).optional(),
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ action, slug, title, description, status, branch, worktreePath, note }) => {
    try {
      if (action === 'create') {
        if (!slug || !title || !description) throw new Error('slug, title, and description are required for create.');

        const filePath = path.join(await getIdeasRoot(), `${slug}.md`);
        const exists = await readFile(filePath, 'utf-8').then(
          () => true,
          () => false,
        );
        if (exists) throw new Error(`An idea with slug "${slug}" already exists.`);

        const idea: Idea = {
          id: slug,
          title,
          status: 'proposed',
          created: new Date().toISOString().slice(0, 10),
          branch: '',
          worktreePath: '',
          description,
        };
        await writeIdea(slug, idea);
        return { action, idea, success: true, message: `Created idea "${slug}".` };
      }

      if (action === 'list') {
        const files = (await readdir(await getIdeasRoot())).filter(f => f.endsWith('.md'));
        const ideas = await Promise.all(
          files.map(async f => {
            const idea = parseIdea(await readFile(path.join(await getIdeasRoot(), f), 'utf-8'));
            const { description: _description, ...rest } = idea;
            return rest;
          }),
        );
        return { action, ideas, success: true, message: `Found ${ideas.length} idea(s).` };
      }

      if (action === 'get') {
        if (!slug) throw new Error('slug is required for get.');
        const idea = await readIdea(slug);
        return { action, idea, success: true, message: `Loaded idea "${slug}".` };
      }

      if (!slug || !status) throw new Error('slug and status are required for updateStatus.');
      const idea = await readIdea(slug);
      idea.status = status;
      if (branch !== undefined) idea.branch = branch;
      if (worktreePath !== undefined) idea.worktreePath = worktreePath;
      if (note) {
        idea.description += `\n\n## Update (${new Date().toISOString().slice(0, 10)})\n${note}`;
      }
      await writeIdea(slug, idea);
      return { action, idea, success: true, message: `Updated idea "${slug}" to status "${status}".` };
    } catch (error) {
      return {
        action,
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
