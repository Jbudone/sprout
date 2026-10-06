import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { TriviaCardSchema, type TriviaCard } from '../schemas/quiz';
import { getRepoRoot } from '../utils/repo-root';
import { CATEGORY_DEFAULT_DOMAIN, titleCase } from './decks';
import { type Db, insertIgnoreSql, openDb, types } from './sql';

// Trivia decks and cards live in their own SQLite file, separate from
// quiz.db (progress/feedback), so "Reset progress" or deleting quiz.db can
// never delete content. Math problems are still JSON files under content/math.
let clientPromise: Promise<Db> | null = null;

export type Deck = {
  id: string;
  name: string;
  domain: string;
  description: string | null;
  createdAt: string;
};

export type DeckSummary = Deck & { cardCount: number };

// Where a card came from and who checked it. Null for cards that predate
// tracking (the original migrated cards).
export type Provenance = {
  runId: string;
  generator: string;
  attempts: number;
  reviewers: { model: string; passed: boolean; issues: string[] }[];
  approvedAt: string;
};

export type TriviaEntry = {
  card: TriviaCard;
  provenance: Provenance | null;
  deck: { id: string; name: string; domain: string };
};

export async function getContentClient(): Promise<Db> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const client = await openDb('CONTENT_DB_FILE', 'content.db');
      const t = types(client.dialect);
      await client.execute(`
        CREATE TABLE IF NOT EXISTS decks (
          id ${t.key} PRIMARY KEY,
          name ${t.key} NOT NULL,
          domain ${t.key} NOT NULL,
          description TEXT,
          created_at ${t.key} NOT NULL
        )
      `);
      await client.execute(`
        CREATE TABLE IF NOT EXISTS trivia_cards (
          id ${t.key} PRIMARY KEY,
          deck_id ${t.key} NOT NULL,
          position INTEGER NOT NULL,
          data ${t.long} NOT NULL,
          created_at ${t.key} NOT NULL
        )
      `);
      // Added after the first release; older files get the column here.
      if (!(await client.columns('trivia_cards')).includes('provenance')) {
        await client.execute(`ALTER TABLE trivia_cards ADD COLUMN provenance ${t.long}`);
      }
      // MySQL has no CREATE INDEX IF NOT EXISTS, so check first.
      const hasIndex =
        client.dialect === 'mysql'
          ? (await client.execute("SHOW INDEX FROM trivia_cards WHERE Key_name = 'idx_trivia_cards_deck'")).rows.length > 0
          : false;
      if (!hasIndex) {
        await client.execute(
          client.dialect === 'mysql'
            ? 'CREATE INDEX idx_trivia_cards_deck ON trivia_cards(deck_id, position)'
            : 'CREATE INDEX IF NOT EXISTS idx_trivia_cards_deck ON trivia_cards(deck_id, position)',
        );
      }
      await seedFromLegacyFiles(client);
      return client;
    })();
  }
  return clientPromise;
}

// One-time migration: the original content/trivia/week-N-M.json files become
// one deck per category. Only runs while the table is empty, so it never
// re-imports after cards have been added, edited, or deleted. The JSON files
// are left in place as a backup.
async function seedFromLegacyFiles(client: Db): Promise<void> {
  const existing = await client.execute('SELECT COUNT(*) AS n FROM trivia_cards');
  if (Number(existing.rows[0].n) > 0) return;

  const dir = path.join(await getRepoRoot(), 'content', 'trivia');
  const names = (await readdir(dir).catch(() => [] as string[]))
    .map(name => ({ name, m: name.match(/^week-(\d+)-(\d+)\.json$/) }))
    .filter((f): f is { name: string; m: RegExpMatchArray } => f.m !== null)
    .sort((a, b) => Number(a.m[1]) - Number(b.m[1]) || Number(a.m[2]) - Number(b.m[2]));

  for (const { name } of names) {
    const card = TriviaCardSchema.parse(JSON.parse(await readFile(path.join(dir, name), 'utf-8')));
    await insertCard(client, card, {
      id: card.category,
      name: titleCase(card.category),
      domain: CATEGORY_DEFAULT_DOMAIN[card.category],
    });
  }
}

async function insertCard(
  client: Db,
  card: TriviaCard,
  deck: { id: string; name: string; domain: string; description?: string },
  provenance: Provenance | null = null,
): Promise<void> {
  const now = new Date().toISOString();
  await client.execute({
    sql: insertIgnoreSql(client.dialect, 'decks', ['id', 'name', 'domain', 'description', 'created_at']),
    args: [deck.id, deck.name, deck.domain, deck.description ?? null, now],
  });
  const pos = await client.execute({
    sql: 'SELECT COALESCE(MAX(position), 0) + 1 AS next FROM trivia_cards WHERE deck_id = ?',
    args: [deck.id],
  });
  await client.execute({
    sql: 'INSERT INTO trivia_cards (id, deck_id, position, data, created_at, provenance) VALUES (?, ?, ?, ?, ?, ?)',
    args: [card.id, deck.id, Number(pos.rows[0].next), JSON.stringify(card), now, provenance ? JSON.stringify(provenance) : null],
  });
}

function rowToDeck(row: Record<string, unknown>): Deck {
  return {
    id: row.id as string,
    name: row.name as string,
    domain: row.domain as string,
    description: (row.description as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

export async function listDecks(): Promise<DeckSummary[]> {
  const client = await getContentClient();
  const result = await client.execute(`
    SELECT d.*, COUNT(c.id) AS card_count
    FROM decks d LEFT JOIN trivia_cards c ON c.deck_id = d.id
    GROUP BY d.id
    ORDER BY d.domain, d.name
  `);
  return result.rows.map(row => ({ ...rowToDeck(row), cardCount: Number(row.card_count) }));
}

export async function listTriviaEntries(): Promise<TriviaEntry[]> {
  const client = await getContentClient();
  const result = await client.execute(`
    SELECT c.data, c.provenance, d.id AS deck_id, d.name AS deck_name, d.domain AS deck_domain
    FROM trivia_cards c JOIN decks d ON d.id = c.deck_id
    ORDER BY d.domain, d.name, c.position
  `);
  return result.rows.map(row => ({
    card: TriviaCardSchema.parse(JSON.parse(row.data as string)),
    provenance: row.provenance ? (JSON.parse(row.provenance as string) as Provenance) : null,
    deck: { id: row.deck_id as string, name: row.deck_name as string, domain: row.deck_domain as string },
  }));
}

/**
 * Adds a trivia card to a deck, creating the deck if it doesn't exist yet.
 * Throws if a card with the same id already exists, so a workflow can never
 * silently overwrite existing content.
 */
export async function addTriviaCard(
  card: TriviaCard,
  deck: { id: string; name: string; domain: string; description?: string },
  provenance: Provenance | null = null,
): Promise<void> {
  const client = await getContentClient();
  const dup = await client.execute({ sql: 'SELECT 1 FROM trivia_cards WHERE id = ?', args: [card.id] });
  if (dup.rows.length > 0) throw new Error(`A trivia card with id "${card.id}" already exists.`);
  await insertCard(client, card, deck, provenance);
}

/** The deck a card lands in when the caller doesn't name one: its category's deck. */
export function defaultDeckForCard(card: TriviaCard): { id: string; name: string; domain: string } {
  return { id: card.category, name: titleCase(card.category), domain: CATEGORY_DEFAULT_DOMAIN[card.category] };
}
