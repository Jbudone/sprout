import { type Db, openDb, upsertSql } from './sql';

// Progress and feedback live apart from content (see content-db.ts) so that
// resetting progress can never touch decks or cards. On SQLite this is its own
// file (QUIZ_DB_FILE, default quiz.db); with MYSQL_URL set it is two tables in
// the shared MySQL database.
let clientPromise: Promise<Db> | null = null;

async function getClient(): Promise<Db> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const client = await openDb('QUIZ_DB_FILE', 'quiz.db');
      const key = client.dialect === 'mysql' ? 'VARCHAR(191)' : 'TEXT';
      await client.execute(`
        CREATE TABLE IF NOT EXISTS quiz_progress (
          item_id ${key} PRIMARY KEY,
          kind ${key} NOT NULL,
          status ${key} NOT NULL,
          chosen_answer TEXT,
          correct INTEGER,
          answered_at ${key} NOT NULL
        )
      `);
      await client.execute(`
        CREATE TABLE IF NOT EXISTS quiz_feedback (
          item_id ${key} PRIMARY KEY,
          kind ${key} NOT NULL,
          difficulty ${key},
          reaction ${key},
          notes TEXT,
          updated_at ${key} NOT NULL
        )
      `);
      // SQLite only: migrate the older not_fun boolean column (pre-dates the
      // "standout" positive-feedback option) into the not_fun/standout reaction field.
      if (client.dialect === 'sqlite') {
        const columns = await client.columns('quiz_feedback');
        if (columns.includes('not_fun')) {
          if (!columns.includes('reaction')) await client.execute('ALTER TABLE quiz_feedback ADD COLUMN reaction TEXT');
          await client.execute("UPDATE quiz_feedback SET reaction = 'not_fun' WHERE not_fun = 1 AND reaction IS NULL");
          try {
            await client.execute('ALTER TABLE quiz_feedback DROP COLUMN not_fun');
          } catch {
            // Older SQLite without DROP COLUMN support — a harmless unused column.
          }
        }
      }
      return client;
    })();
  }
  return clientPromise;
}

export type QuizKind = 'math' | 'trivia';
export type ProgressStatus = 'answered' | 'skipped';
export type Difficulty = 'too_easy' | 'too_hard';
export type Reaction = 'not_fun' | 'standout';

export type ProgressRow = {
  itemId: string;
  kind: QuizKind;
  status: ProgressStatus;
  chosenAnswer: string | null;
  correct: boolean | null;
  answeredAt: string;
};

export type FeedbackRow = {
  itemId: string;
  kind: QuizKind;
  difficulty: Difficulty | null;
  reaction: Reaction | null;
  notes: string | null;
  updatedAt: string;
};

export async function getProgressForKind(kind: QuizKind): Promise<Map<string, ProgressRow>> {
  const client = await getClient();
  const result = await client.execute({
    sql: 'SELECT * FROM quiz_progress WHERE kind = ?',
    args: [kind],
  });
  const map = new Map<string, ProgressRow>();
  for (const row of result.rows) {
    map.set(row.item_id as string, {
      itemId: row.item_id as string,
      kind: row.kind as QuizKind,
      status: row.status as ProgressStatus,
      chosenAnswer: (row.chosen_answer as string | null) ?? null,
      correct: row.correct === null ? null : Boolean(row.correct),
      answeredAt: row.answered_at as string,
    });
  }
  return map;
}

export async function getFeedbackForKind(kind: QuizKind): Promise<Map<string, FeedbackRow>> {
  const client = await getClient();
  const result = await client.execute({
    sql: 'SELECT * FROM quiz_feedback WHERE kind = ?',
    args: [kind],
  });
  const map = new Map<string, FeedbackRow>();
  for (const row of result.rows) {
    map.set(row.item_id as string, {
      itemId: row.item_id as string,
      kind: row.kind as QuizKind,
      difficulty: (row.difficulty as Difficulty | null) ?? null,
      reaction: (row.reaction as Reaction | null) ?? null,
      notes: (row.notes as string | null) ?? null,
      updatedAt: row.updated_at as string,
    });
  }
  return map;
}

export async function recordProgress(input: {
  itemId: string;
  kind: QuizKind;
  status: ProgressStatus;
  chosenAnswer?: string;
  correct?: boolean;
}): Promise<void> {
  const client = await getClient();
  await client.execute({
    sql: upsertSql(client.dialect, 'quiz_progress', ['item_id'], ['item_id', 'kind', 'status', 'chosen_answer', 'correct', 'answered_at']),
    args: [
      input.itemId,
      input.kind,
      input.status,
      input.chosenAnswer ?? null,
      input.correct === undefined ? null : input.correct ? 1 : 0,
      new Date().toISOString(),
    ],
  });
}

export async function resetProgress(input: { kind?: QuizKind } = {}): Promise<void> {
  const client = await getClient();
  if (input.kind) {
    await client.execute({ sql: 'DELETE FROM quiz_progress WHERE kind = ?', args: [input.kind] });
    await client.execute({ sql: 'DELETE FROM quiz_feedback WHERE kind = ?', args: [input.kind] });
  } else {
    await client.execute('DELETE FROM quiz_progress');
    await client.execute('DELETE FROM quiz_feedback');
  }
}

export async function recordFeedback(input: {
  itemId: string;
  kind: QuizKind;
  difficulty?: Difficulty | null;
  reaction?: Reaction | null;
  notes?: string | null;
}): Promise<void> {
  const client = await getClient();
  await client.execute({
    sql: upsertSql(client.dialect, 'quiz_feedback', ['item_id'], ['item_id', 'kind', 'difficulty', 'reaction', 'notes', 'updated_at']),
    args: [
      input.itemId,
      input.kind,
      input.difficulty ?? null,
      input.reaction ?? null,
      input.notes ?? null,
      new Date().toISOString(),
    ],
  });
}
