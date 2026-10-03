import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { createClient, type Client } from '@libsql/client';
import { TriviaCardSchema, type TriviaCard } from '../schemas/quiz';
import { getRepoRoot } from '../utils/repo-root';
import { CATEGORY_DEFAULT_DOMAIN, titleCase } from './decks';

// Trivia decks and cards live in their own SQLite file, separate from
// quiz.db (progress/feedback), so "Reset progress" or deleting quiz.db can
// never delete content. Math problems are still JSON files under content/math.
let clientPromise: Promise<Client> | null = null;

export type Deck = {
  id: string;
  name: string;
  domain: string;
  description: string | null;
  createdAt: string;
};

export type DeckSummary = Deck & { cardCount: number };

export type TriviaEntry = {
  card: TriviaCard;
  deck: { id: string; name: string; domain: string };
};

async function getClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const dbFileName = process.env.CONTENT_DB_FILE || 'content.db';
      const dbPath = path.join(await getRepoRoot(), dbFileName);
      const client = createClient({ url: `file:${dbPath}` });
      await client.execute(`
        CREATE TABLE IF NOT EXISTS decks (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          domain TEXT NOT NULL,
          description TEXT,
          created_at TEXT NOT NULL
        )
      `);
      await client.execute(`
        CREATE TABLE IF NOT EXISTS trivia_cards (
          id TEXT PRIMARY KEY,
          deck_id TEXT NOT NULL REFERENCES decks(id),
          position INTEGER NOT NULL,
          data TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
      await client.execute('CREATE INDEX IF NOT EXISTS idx_trivia_cards_deck ON trivia_cards(deck_id, position)');
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
async function seedFromLegacyFiles(client: Client): Promise<void> {
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
  client: Client,
  card: TriviaCard,
  deck: { id: string; name: string; domain: string; description?: string },
): Promise<void> {
  const now = new Date().toISOString();
  await client.execute({
    sql: 'INSERT OR IGNORE INTO decks (id, name, domain, description, created_at) VALUES (?, ?, ?, ?, ?)',
    args: [deck.id, deck.name, deck.domain, deck.description ?? null, now],
  });
  const pos = await client.execute({
    sql: 'SELECT COALESCE(MAX(position), 0) + 1 AS next FROM trivia_cards WHERE deck_id = ?',
    args: [deck.id],
  });
  await client.execute({
    sql: 'INSERT INTO trivia_cards (id, deck_id, position, data, created_at) VALUES (?, ?, ?, ?, ?)',
    args: [card.id, deck.id, Number(pos.rows[0].next), JSON.stringify(card), now],
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
  const client = await getClient();
  const result = await client.execute(`
    SELECT d.*, COUNT(c.id) AS card_count
    FROM decks d LEFT JOIN trivia_cards c ON c.deck_id = d.id
    GROUP BY d.id
    ORDER BY d.domain, d.name
  `);
  return result.rows.map(row => ({ ...rowToDeck(row), cardCount: Number(row.card_count) }));
}

export async function listTriviaEntries(): Promise<TriviaEntry[]> {
  const client = await getClient();
  const result = await client.execute(`
    SELECT c.data, d.id AS deck_id, d.name AS deck_name, d.domain AS deck_domain
    FROM trivia_cards c JOIN decks d ON d.id = c.deck_id
    ORDER BY d.domain, d.name, c.position
  `);
  return result.rows.map(row => ({
    card: TriviaCardSchema.parse(JSON.parse(row.data as string)),
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
): Promise<void> {
  const client = await getClient();
  const dup = await client.execute({ sql: 'SELECT 1 FROM trivia_cards WHERE id = ?', args: [card.id] });
  if (dup.rows.length > 0) throw new Error(`A trivia card with id "${card.id}" already exists.`);
  await insertCard(client, card, deck);
}

/** The deck a card lands in when the caller doesn't name one: its category's deck. */
export function defaultDeckForCard(card: TriviaCard): { id: string; name: string; domain: string } {
  return { id: card.category, name: titleCase(card.category), domain: CATEGORY_DEFAULT_DOMAIN[card.category] };
}
