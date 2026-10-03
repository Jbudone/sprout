import type { Client } from '@libsql/client';
import { z } from 'zod';
import { TriviaCardSchema, type TriviaCard } from '../schemas/quiz';
import { getContentClient, type Provenance } from './content-db';

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

let ready: Promise<Client> | null = null;

async function db(): Promise<Client> {
  if (!ready) {
    ready = (async () => {
      const client = await getContentClient();
      await client.execute(`
        CREATE TABLE IF NOT EXISTS gen_runs (
          id TEXT PRIMARY KEY,
          brief TEXT NOT NULL,
          config TEXT NOT NULL,
          status TEXT NOT NULL,
          error TEXT,
          created_at TEXT NOT NULL,
          finished_at TEXT
        )
      `);
      await client.execute(`
        CREATE TABLE IF NOT EXISTS pending_cards (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES gen_runs(id),
          data TEXT NOT NULL,
          status TEXT NOT NULL,
          reject_reason TEXT,
          attempts INTEGER NOT NULL,
          reviewers TEXT NOT NULL,
          issues TEXT NOT NULL,
          created_at TEXT NOT NULL,
          decided_at TEXT
        )
      `);
      await client.execute(`
        CREATE TABLE IF NOT EXISTS model_calls (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id TEXT,
          card_id TEXT,
          role TEXT NOT NULL,
          model TEXT NOT NULL,
          input_tokens INTEGER,
          output_tokens INTEGER,
          cost REAL,
          latency_ms INTEGER NOT NULL,
          ok INTEGER NOT NULL,
          error TEXT,
          created_at TEXT NOT NULL
        )
      `);
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
  latencyMs: number;
  ok: boolean;
  error?: string;
}): Promise<void> {
  const client = await db();
  await client.execute({
    sql: `INSERT INTO model_calls (run_id, card_id, role, model, input_tokens, output_tokens, cost, latency_ms, ok, error, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      call.runId,
      call.cardId ?? null,
      call.role,
      call.model,
      call.inputTokens ?? null,
      call.outputTokens ?? null,
      call.cost ?? null,
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
