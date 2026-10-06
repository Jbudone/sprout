import { createRoute } from '@mastra/server/server-adapter';
import { z } from 'zod';
import { getContentClient } from './content-db';
import { getCreationDb } from './creation-db';
import { getQuizClient } from './db';
import { type Db, upsertSql } from './sql';

// Moves everything between databases (SQLite on a PC <-> MySQL on the droplet),
// doubling as a portable backup. Tables are exported as raw rows and imported
// as upserts keyed on the primary key, so importing twice is harmless and
// never deletes anything. No secrets are in these tables.
const TABLES = {
  content: [
    { table: 'decks', key: 'id' },
    { table: 'trivia_cards', key: 'id' },
    { table: 'math_problems', key: 'id' },
    { table: 'gen_runs', key: 'id' },
    { table: 'pending_cards', key: 'id' },
    { table: 'model_calls', key: 'id' },
    { table: 'settings', key: 'key' },
  ],
  progress: [
    { table: 'quiz_progress', key: 'item_id' },
    { table: 'quiz_feedback', key: 'item_id' },
  ],
} as const;

type Group = keyof typeof TABLES;
const RowSchema = z.record(z.string(), z.unknown());
const GroupDataSchema = z.record(z.string(), z.array(RowSchema));

const ExportSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  content: GroupDataSchema,
  progress: GroupDataSchema,
});

async function clientFor(group: Group): Promise<Db> {
  if (group === 'content') {
    await getCreationDb(); // creates the run/usage tables as well as decks and cards
    return getContentClient();
  }
  return getQuizClient();
}

const exportRoute = createRoute({
  method: 'GET',
  path: '/quiz/admin/export',
  responseType: 'json',
  responseSchema: ExportSchema,
  summary: 'Export all content, runs, usage log, and progress as JSON',
  tags: ['Admin'],
  requiresAuth: false,
  handler: async () => {
    const out: z.infer<typeof ExportSchema> = { version: 1, exportedAt: new Date().toISOString(), content: {}, progress: {} };
    for (const group of Object.keys(TABLES) as Group[]) {
      const client = await clientFor(group);
      for (const { table, key } of TABLES[group]) {
        const result = await client.execute(`SELECT * FROM ${table} ORDER BY \`${key}\``);
        out[group][table] = result.rows.map(r => ({ ...r }));
      }
    }
    return out;
  },
});

const importRoute = createRoute({
  method: 'POST',
  path: '/quiz/admin/import',
  responseType: 'json',
  bodySchema: ExportSchema,
  responseSchema: z.object({ imported: z.record(z.string(), z.number()) }),
  summary: 'Import an export file, upserting rows by primary key (never deletes)',
  tags: ['Admin'],
  requiresAuth: false,
  handler: async data => {
    const imported: Record<string, number> = {};
    for (const group of Object.keys(TABLES) as Group[]) {
      const client = await clientFor(group);
      for (const { table, key } of TABLES[group]) {
        const rows = data[group][table] ?? [];
        // Only columns that exist in this database are written, so an export
        // from a slightly older or newer schema still imports cleanly.
        const known = new Set(await client.columns(table));
        let count = 0;
        for (const row of rows) {
          const cols = Object.keys(row).filter(c => known.has(c));
          if (!cols.includes(key)) throw new Error(`A ${table} row is missing its "${key}" column.`);
          await client.execute({ sql: upsertSql(client.dialect, table, [key], cols), args: cols.map(c => row[c] ?? null) });
          count++;
        }
        imported[table] = count;
      }
    }
    return { imported };
  },
});

export const adminApiRoutes = [exportRoute, importRoute];
