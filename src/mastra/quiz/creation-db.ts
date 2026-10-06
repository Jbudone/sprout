import { z } from 'zod';
import { TriviaCardSchema, type TriviaCard } from '../schemas/quiz';
import { getContentClient, type Provenance } from './content-db';
import { type Db, types, upsertSql } from './sql';

// Tables for the Create tab, in content.db next to the decks: generation
// runs, the cards each run produced (pending until you decide), and a log of
// every model call for the usage stats.

export const RunConfigSchema = z.object({
  generator: z.string().min(1),
  reviewers: z.array(z.string().min(1)).max(3),
  // 'all': every reviewer must pass. 'majority': more than half.
  reviewMode: z.enum(['all', 'majority']).default('all'),
  maxAttempts: z.number().int().min(1).max(4).default(2),
});
export type RunConfig = z.infer<typeof RunConfigSchema>;

export const BriefSchema = z.object({
  brief: z.string().min(3),
  exclude: z.array(z.string().min(1)).default([]),
  count: z.number().int().min(1).max(30),
  deckName: z.string().min(1),
  domain: z.string().min(1),
});
export type Brief = z.infer<typeof BriefSchema>;

export type RunStatus = 'running' | 'done' | 'failed';
export type CardStatus = 'pending' | 'approved' | 'rejected' | 'auto_rejected';

export type RunRow = {
  id: string;
  brief: Brief;
  config: RunConfig;
  status: RunStatus;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
};

export type PendingCard = {
  id: string;
  runId: string;
  card: TriviaCard;
  status: CardStatus;
  rejectReason: string | null;
  attempts: number;
  reviewers: Provenance['reviewers'];
  issues: string[];
  createdAt: string;
};

let ready: Promise<Db> | null = null;

async function db(): Promise<Db> {
  if (!ready) {
    ready = (async () => {
      const client = await getContentClient();
      const t = types(client.dialect);
      await client.execute(`
        CREATE TABLE IF NOT EXISTS gen_runs (
          id ${t.key} PRIMARY KEY,
          brief ${t.long} NOT NULL,
          config ${t.long} NOT NULL,
          status ${t.key} NOT NULL,
          error TEXT,
          created_at ${t.key} NOT NULL,
          finished_at ${t.key}
        )
      `);
      await client.execute(`
        CREATE TABLE IF NOT EXISTS pending_cards (
          id ${t.key} PRIMARY KEY,
          run_id ${t.key} NOT NULL,
          data ${t.long} NOT NULL,
          status ${t.key} NOT NULL,
          reject_reason TEXT,
          attempts INTEGER NOT NULL,
          reviewers ${t.long} NOT NULL,
          issues ${t.long} NOT NULL,
          created_at ${t.key} NOT NULL,
          decided_at ${t.key}
        )
      `);
      await client.execute(`
        CREATE TABLE IF NOT EXISTS model_calls (
          id ${t.autoId},
          run_id ${t.key},
          card_id ${t.key},
          role ${t.key} NOT NULL,
          model ${t.key} NOT NULL,
          input_tokens INTEGER,
          output_tokens INTEGER,
          cost DOUBLE,
          latency_ms INTEGER NOT NULL,
          ok INTEGER NOT NULL,
          error TEXT,
          created_at ${t.key} NOT NULL
        )
      `);
      if (!(await client.columns('model_calls')).includes('cost_estimated')) {
        await client.execute('ALTER TABLE model_calls ADD COLUMN cost_estimated INTEGER');
      }
      await client.execute(`CREATE TABLE IF NOT EXISTS settings (\`key\` ${t.key} PRIMARY KEY, \`value\` TEXT NOT NULL)`);
      // A server restart mid-run leaves a run 'running' forever; mark it failed.
      await client.execute({
        sql: "UPDATE gen_runs SET status = 'failed', error = ?, finished_at = ? WHERE status = 'running'",
        args: ['Server restarted while this run was in progress.', new Date().toISOString()],
      });
      return client;
    })();
  }
  return ready;
}

function rowToRun(row: Record<string, unknown>): RunRow {
  return {
    id: row.id as string,
    brief: JSON.parse(row.brief as string),
    config: JSON.parse(row.config as string),
    status: row.status as RunStatus,
    error: (row.error as string | null) ?? null,
    createdAt: row.created_at as string,
    finishedAt: (row.finished_at as string | null) ?? null,
  };
}

function rowToPending(row: Record<string, unknown>): PendingCard {
  return {
    id: row.id as string,
    runId: row.run_id as string,
    card: TriviaCardSchema.parse(JSON.parse(row.data as string)),
    status: row.status as CardStatus,
    rejectReason: (row.reject_reason as string | null) ?? null,
    attempts: Number(row.attempts),
    reviewers: JSON.parse(row.reviewers as string),
    issues: JSON.parse(row.issues as string),
    createdAt: row.created_at as string,
  };
}

export async function createRun(id: string, brief: Brief, config: RunConfig): Promise<void> {
  const client = await db();
  await client.execute({
    sql: "INSERT INTO gen_runs (id, brief, config, status, created_at) VALUES (?, ?, ?, 'running', ?)",
    args: [id, JSON.stringify(brief), JSON.stringify(config), new Date().toISOString()],
  });
}

export async function finishRun(id: string, status: 'done' | 'failed', error?: string): Promise<void> {
  const client = await db();
  await client.execute({
    sql: 'UPDATE gen_runs SET status = ?, error = ?, finished_at = ? WHERE id = ?',
    args: [status, error ?? null, new Date().toISOString(), id],
  });
}

export async function getRun(id: string): Promise<RunRow | null> {
  const client = await db();
  const r = await client.execute({ sql: 'SELECT * FROM gen_runs WHERE id = ?', args: [id] });
  return r.rows[0] ? rowToRun(r.rows[0]) : null;
}

export async function listRuns(limit = 20): Promise<(RunRow & { counts: Record<CardStatus, number> })[]> {
  const client = await db();
  const runs = await client.execute({ sql: 'SELECT * FROM gen_runs ORDER BY created_at DESC LIMIT ?', args: [limit] });
  const counts = await client.execute('SELECT run_id, status, COUNT(*) AS n FROM pending_cards GROUP BY run_id, status');
  return runs.rows.map(row => {
    const run = rowToRun(row);
    const c: Record<CardStatus, number> = { pending: 0, approved: 0, rejected: 0, auto_rejected: 0 };
    for (const k of counts.rows) if (k.run_id === run.id) c[k.status as CardStatus] = Number(k.n);
    return { ...run, counts: c };
  });
}

export async function addPendingCard(input: {
  runId: string;
  card: TriviaCard;
  status: 'pending' | 'auto_rejected';
  attempts: number;
  reviewers: Provenance['reviewers'];
  issues: string[];
}): Promise<void> {
  const client = await db();
  await client.execute({
    sql: `INSERT INTO pending_cards (id, run_id, data, status, attempts, reviewers, issues, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      input.card.id,
      input.runId,
      JSON.stringify(input.card),
      input.status,
      input.attempts,
      JSON.stringify(input.reviewers),
      JSON.stringify(input.issues),
      new Date().toISOString(),
    ],
  });
}

export async function listRunCards(runId: string): Promise<PendingCard[]> {
  const client = await db();
  const r = await client.execute({ sql: 'SELECT * FROM pending_cards WHERE run_id = ? ORDER BY created_at', args: [runId] });
  return r.rows.map(rowToPending);
}

export async function getPendingCard(id: string): Promise<PendingCard | null> {
  const client = await db();
  const r = await client.execute({ sql: 'SELECT * FROM pending_cards WHERE id = ?', args: [id] });
  return r.rows[0] ? rowToPending(r.rows[0]) : null;
}

export async function setCardStatus(id: string, status: 'approved' | 'rejected', reason?: string): Promise<void> {
  const client = await db();
  await client.execute({
    sql: 'UPDATE pending_cards SET status = ?, reject_reason = ?, decided_at = ? WHERE id = ?',
    args: [status, reason ?? null, new Date().toISOString(), id],
  });
}

export async function cardIdTaken(id: string): Promise<boolean> {
  const client = await db();
  const r = await client.execute({
    sql: 'SELECT 1 FROM pending_cards WHERE id = ? UNION SELECT 1 FROM trivia_cards WHERE id = ?',
    args: [id, id],
  });
  return r.rows.length > 0;
}

export async function logModelCall(call: {
  runId: string;
  cardId?: string;
  role: 'generator' | 'reviewer';
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
  costEstimated?: boolean;
  latencyMs: number;
  ok: boolean;
  error?: string;
}): Promise<void> {
  const client = await db();
  await client.execute({
    sql: `INSERT INTO model_calls (run_id, card_id, role, model, input_tokens, output_tokens, cost, cost_estimated, latency_ms, ok, error, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      call.runId,
      call.cardId ?? null,
      call.role,
      call.model,
      call.inputTokens ?? null,
      call.outputTokens ?? null,
      call.cost ?? null,
      call.costEstimated === undefined ? null : call.costEstimated ? 1 : 0,
      call.latencyMs,
      call.ok ? 1 : 0,
      call.error ?? null,
      new Date().toISOString(),
    ],
  });
}

/** Existing questions (approved + still pending) for a deck name, used to avoid duplicates. */
export async function questionsForDedupe(deckId: string, runId: string): Promise<string[]> {
  const client = await db();
  const approved = await client.execute({ sql: 'SELECT data FROM trivia_cards WHERE deck_id = ?', args: [deckId] });
  const pending = await client.execute({
    sql: "SELECT data FROM pending_cards WHERE run_id = ? AND status != 'rejected'",
    args: [runId],
  });
  return [...approved.rows, ...pending.rows].map(r => {
    const card = JSON.parse(r.data as string) as TriviaCard;
    return card.question.map(s => s.text).join(' ');
  });
}

// ---- spend caps ----

export const SettingsSchema = z.object({
  perRunCapUsd: z.number().min(0.01).max(1000),
  monthlyCapUsd: z.number().min(0.01).max(10000),
});
export type Settings = z.infer<typeof SettingsSchema>;

const DEFAULT_SETTINGS: Settings = { perRunCapUsd: 1, monthlyCapUsd: 5 };

export async function getSettings(): Promise<Settings> {
  const client = await db();
  const r = await client.execute('SELECT `key`, `value` FROM settings');
  const stored = Object.fromEntries(r.rows.map(row => [row.key as string, Number(row.value)]));
  return {
    perRunCapUsd: stored.perRunCapUsd > 0 ? stored.perRunCapUsd : DEFAULT_SETTINGS.perRunCapUsd,
    monthlyCapUsd: stored.monthlyCapUsd > 0 ? stored.monthlyCapUsd : DEFAULT_SETTINGS.monthlyCapUsd,
  };
}

export async function saveSettings(settings: Settings): Promise<void> {
  const client = await db();
  for (const [key, value] of Object.entries(settings)) {
    await client.execute({ sql: upsertSql(client.dialect, 'settings', ['key'], ['key', 'value']), args: [key, String(value)] });
  }
}

/** Start of the current calendar month (UTC), as an ISO string. */
function monthStartIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** Spend logged by this app this month (all runs). */
export async function monthToDateSpend(): Promise<number> {
  const client = await db();
  const r = await client.execute({
    sql: 'SELECT COALESCE(SUM(cost), 0) AS total FROM model_calls WHERE created_at >= ?',
    args: [monthStartIso()],
  });
  return Number(r.rows[0].total);
}

export async function runSpend(runId: string): Promise<number> {
  const client = await db();
  const r = await client.execute({ sql: 'SELECT COALESCE(SUM(cost), 0) AS total FROM model_calls WHERE run_id = ?', args: [runId] });
  return Number(r.rows[0].total);
}

/** Average tokens per successful call for a model and role, from the last 50 calls; null if never used. */
export async function getObservedTokens(model: string, role: 'generator' | 'reviewer'): Promise<{ input: number; output: number } | null> {
  const client = await db();
  const r = await client.execute({
    sql: `SELECT AVG(input_tokens) AS i, AVG(output_tokens) AS o, COUNT(*) AS n FROM
            (SELECT input_tokens, output_tokens FROM model_calls
             WHERE model = ? AND role = ? AND ok = 1 AND input_tokens IS NOT NULL AND output_tokens IS NOT NULL
             ORDER BY id DESC LIMIT 50) AS recent`,
    args: [model, role],
  });
  const row = r.rows[0];
  return Number(row.n) > 0 ? { input: Number(row.i), output: Number(row.o) } : null;
}

export { db as getCreationDb };
