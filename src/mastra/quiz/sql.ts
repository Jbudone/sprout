import path from 'node:path';
import { createClient } from '@libsql/client';
import mysql from 'mysql2/promise';
import { getRepoRoot } from '../utils/repo-root';

// The app's own tables (quiz progress, decks, cards, runs, usage log) run on
// SQLite files for local development and on MySQL when MYSQL_URL is set (the
// droplet deployment). This is the thin layer that hides the difference: one
// execute() shape, plus helpers for the few SQL constructs that differ.
export type Row = Record<string, unknown>;
export type Dialect = 'sqlite' | 'mysql';

export interface Db {
  dialect: Dialect;
  execute(query: string | { sql: string; args?: unknown[] }): Promise<{ rows: Row[] }>;
  /** Column names of a table, empty if it doesn't exist. */
  columns(table: string): Promise<string[]>;
}

export function usingMysql(): boolean {
  return !!process.env.MYSQL_URL;
}

function normalize(query: string | { sql: string; args?: unknown[] }) {
  return typeof query === 'string' ? { sql: query, args: [] as unknown[] } : { sql: query.sql, args: query.args ?? [] };
}

let mysqlDb: Promise<Db> | null = null;

function openMysql(): Promise<Db> {
  if (!mysqlDb) {
    mysqlDb = (async () => {
      const pool = mysql.createPool({
        uri: process.env.MYSQL_URL,
        charset: 'utf8mb4',
        waitForConnections: true,
        connectionLimit: 5,
        decimalNumbers: true,
        ...(process.env.MYSQL_SSL === 'true' ? { ssl: { rejectUnauthorized: true } } : {}),
      });
      const db: Db = {
        dialect: 'mysql',
        async execute(query) {
          const { sql, args } = normalize(query);
          // query(), not execute(): prepared statements reject numeric LIMIT parameters.
          const [result] = await pool.query(sql, args);
          return { rows: Array.isArray(result) ? (result as Row[]) : [] };
        },
        async columns(table) {
          const [rows] = await pool.query(
            'SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
            [table],
          );
          return (rows as Row[]).map(r => r.name as string);
        },
      };
      return db;
    })();
  }
  return mysqlDb;
}

const sqliteDbs = new Map<string, Promise<Db>>();

function openSqlite(envVar: string, defaultFile: string): Promise<Db> {
  const fileName = process.env[envVar] || defaultFile;
  let existing = sqliteDbs.get(fileName);
  if (!existing) {
    existing = (async () => {
      const client = createClient({ url: `file:${path.join(await getRepoRoot(), fileName)}` });
      const db: Db = {
        dialect: 'sqlite',
        execute: async query => {
          const { sql, args } = normalize(query);
          return { rows: (await client.execute({ sql, args: args as never })).rows as unknown as Row[] };
        },
        async columns(table) {
          const r = await client.execute(`PRAGMA table_info(${table})`);
          return r.rows.map(row => row.name as string);
        },
      };
      return db;
    })();
    sqliteDbs.set(fileName, existing);
  }
  return existing;
}

/**
 * The database for one logical store. With MYSQL_URL set, everything shares
 * one MySQL database (table names don't collide); otherwise each store is its
 * own SQLite file named by `envVar` (default `defaultFile`).
 */
export function openDb(envVar: string, defaultFile: string): Promise<Db> {
  return usingMysql() ? openMysql() : openSqlite(envVar, defaultFile);
}

// ---- dialect helpers ----

/** Column types: MySQL needs a length on anything used as a key. */
export const types = (d: Dialect) => ({
  key: d === 'mysql' ? 'VARCHAR(191)' : 'TEXT',
  long: d === 'mysql' ? 'MEDIUMTEXT' : 'TEXT',
  autoId: d === 'mysql' ? 'BIGINT PRIMARY KEY AUTO_INCREMENT' : 'INTEGER PRIMARY KEY AUTOINCREMENT',
});

/** INSERT that updates the non-key columns when the key already exists. */
export function upsertSql(d: Dialect, table: string, keyCols: string[], cols: string[]): string {
  const q = (c: string) => `\`${c}\``;
  const insert = `INSERT INTO ${table} (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  const update = cols.filter(c => !keyCols.includes(c));
  if (d === 'mysql') return `${insert} ON DUPLICATE KEY UPDATE ${update.map(c => `${q(c)} = VALUES(${q(c)})`).join(', ')}`;
  return `${insert} ON CONFLICT(${keyCols.map(q).join(', ')}) DO UPDATE SET ${update.map(c => `${q(c)} = excluded.${q(c)}`).join(', ')}`;
}

/** INSERT that silently does nothing when the key already exists. */
export function insertIgnoreSql(d: Dialect, table: string, cols: string[]): string {
  return `INSERT ${d === 'mysql' ? 'IGNORE' : 'OR IGNORE'} INTO ${table} (${cols.map(c => `\`${c}\``).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
}
