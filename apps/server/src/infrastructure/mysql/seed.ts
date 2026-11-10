/**
 * Demo seed execution (plan C0 "Docker/MySQL 구성").
 *
 * The seed is deliberately separate from migrations: it creates no schema and
 * runs only when asked (`node dist/db/seed.js`). Its statements carry fixed
 * UUIDs and `ON DUPLICATE KEY UPDATE` no-ops, so re-running it never
 * duplicates a listing. The whole script runs in one transaction — a failing
 * statement leaves the previously seeded data untouched.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { splitSqlStatements } from './sql-script';
import type { SqlClient } from './sql-client';

export const DEFAULT_SEED_FILE = 'demo.sql';

export class SqlSeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SqlSeedError';
  }
}

export function loadSeedStatements(dir: string, file: string = DEFAULT_SEED_FILE): string[] {
  const path = join(dir, file);
  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    throw new SqlSeedError(`seed file not readable: ${path}`);
  }
  const statements = splitSqlStatements(content);
  if (statements.length === 0) throw new SqlSeedError(`seed file contains no statement: ${path}`);
  return statements;
}

export interface SeedReport {
  readonly file: string;
  readonly statements: number;
}

export async function applySeed(
  client: SqlClient,
  dir: string,
  file: string = DEFAULT_SEED_FILE,
): Promise<SeedReport> {
  const statements = loadSeedStatements(dir, file);
  await client.transaction(async () => {
    for (const statement of statements) {
      await client.execute(statement);
    }
  });
  return { file, statements: statements.length };
}
