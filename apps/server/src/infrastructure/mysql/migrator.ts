/**
 * Versioned SQL migrations for the MySQL storage option.
 *
 * A migration is `db/migrations/<4-digit version>_<name>.sql`. The runner
 * records every applied version in `schema_migrations` together with the
 * SHA-256 of the file it applied, so:
 *
 * - a re-run applies only versions that are missing;
 * - an edited migration that was already applied is refused (checksum drift),
 *   instead of silently diverging between environments;
 * - a database that already carries a version this build does not know is
 *   refused too — the schema would be ahead of the code that queries it.
 *
 * MySQL commits DDL implicitly, so "apply this migration" is not one atomic
 * unit. The schema statements are written idempotently (`CREATE TABLE IF NOT
 * EXISTS`, `ON DUPLICATE KEY UPDATE`) so a retry after a partial failure is
 * safe; a failure is still raised, never ignored.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SqlClient } from './sql-client';
import { describeError } from './mysql-support';
import { splitSqlStatements } from './sql-script';

export const MIGRATIONS_TABLE = 'schema_migrations';
export const MIGRATION_FILE_PATTERN = /^(\d{4})_([a-z0-9][a-z0-9_-]*)\.sql$/;

const CREATE_MIGRATIONS_TABLE = `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
  version CHAR(8) NOT NULL,
  name VARCHAR(200) NOT NULL,
  checksum CHAR(64) NOT NULL,
  applied_at DATETIME(3) NOT NULL,
  PRIMARY KEY (version)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci`;

export class SqlMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SqlMigrationError';
  }
}

export interface SqlMigration {
  readonly version: string;
  readonly name: string;
  readonly path: string;
  readonly checksum: string;
  readonly statements: readonly string[];
}

export function checksumOf(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** Reads and validates every `.sql` migration in `dir`, ordered by version. */
export function loadMigrations(dir: string): SqlMigration[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    throw new SqlMigrationError(
      `migrations directory not readable: ${dir} (set WISH_DB_MIGRATIONS_DIR to the directory that holds db/migrations)`,
    );
  }

  const files = entries.filter((entry) => entry.endsWith('.sql')).sort();
  if (files.length === 0) {
    throw new SqlMigrationError(`no *.sql migration files found in ${dir}`);
  }

  const seen = new Map<string, string>();
  const migrations: SqlMigration[] = [];
  for (const file of files) {
    const match = MIGRATION_FILE_PATTERN.exec(file);
    if (match === null) {
      throw new SqlMigrationError(
        `migration file name must look like 0001_name.sql, got "${file}" in ${dir}`,
      );
    }
    const [, version, name] = match;
    const duplicate = seen.get(version);
    if (duplicate !== undefined) {
      throw new SqlMigrationError(
        `duplicate migration version ${version}: "${duplicate}" and "${file}" in ${dir}`,
      );
    }
    seen.set(version, file);

    const path = join(dir, file);
    const content = readFileSync(path, 'utf8');
    const statements = splitSqlStatements(content);
    if (statements.length === 0) {
      throw new SqlMigrationError(`migration ${file} contains no statement`);
    }
    migrations.push({ version, name, path, checksum: checksumOf(content), statements });
  }

  return migrations.sort((a, b) => a.version.localeCompare(b.version));
}

interface RecordedMigrationRow {
  readonly version: string;
  readonly checksum: string;
}

/**
 * Applies every migration that is not recorded yet, in version order, and
 * answers the versions applied by this run. Already-applied versions are
 * verified against their checksum and skipped.
 */
export async function applyMigrations(
  client: SqlClient,
  migrations: readonly SqlMigration[],
  now: () => Date = () => new Date(),
): Promise<readonly string[]> {
  await client.execute(CREATE_MIGRATIONS_TABLE);

  const recorded = await client.query<RecordedMigrationRow>(
    `SELECT version, checksum FROM ${MIGRATIONS_TABLE}`,
  );
  const recordedByVersion = new Map(recorded.map((row) => [row.version, row.checksum]));

  const knownVersions = new Set(migrations.map((migration) => migration.version));
  for (const version of recordedByVersion.keys()) {
    if (!knownVersions.has(version)) {
      throw new SqlMigrationError(
        `database schema is ahead of this build: migration ${version} is applied but missing from the migrations directory`,
      );
    }
  }

  const appliedNow: string[] = [];
  for (const migration of migrations) {
    const appliedChecksum = recordedByVersion.get(migration.version);
    if (appliedChecksum !== undefined) {
      if (appliedChecksum !== migration.checksum) {
        throw new SqlMigrationError(
          `migration ${migration.version} (${migration.name}) changed after it was applied: recorded checksum ${appliedChecksum}, current ${migration.checksum}`,
        );
      }
      continue;
    }

    for (const [index, statement] of migration.statements.entries()) {
      try {
        await client.execute(statement);
      } catch (error) {
        throw new SqlMigrationError(
          `migration ${migration.version} (${migration.name}) failed on statement ${index + 1}/${migration.statements.length}: ${describeError(error)}`,
        );
      }
    }

    await client.execute(
      `INSERT INTO ${MIGRATIONS_TABLE} (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)`,
      [migration.version, migration.name, migration.checksum, now()],
    );
    appliedNow.push(migration.version);
  }

  return appliedNow;
}
