/**
 * Migration runner behaviour (no database): version ordering, drift refusal,
 * schema-ahead refusal and the "apply only what is missing" rule. The runner
 * executes one statement at a time and records each applied version with the
 * checksum of the file it applied, so an edited migration cannot silently
 * diverge between environments.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MIGRATIONS_TABLE,
  SqlMigrationError,
  applyMigrations,
  checksumOf,
  loadMigrations,
} from '../../src/infrastructure/mysql/migrator';
import { FakeSqlClient } from './support/fake-sql-client';

const dirs: string[] = [];

function migrationDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'wish-migrations-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

interface RecordedInsert {
  readonly version: string;
  readonly checksum: string;
}

function clientWith(recorded: ReadonlyArray<{ version: string; checksum: string }>): {
  client: FakeSqlClient;
  inserted: RecordedInsert[];
} {
  const inserted: RecordedInsert[] = [];
  const client = new FakeSqlClient((sql, params) => {
    if (sql.startsWith(`SELECT version, checksum FROM ${MIGRATIONS_TABLE}`)) {
      return { rows: recorded };
    }
    if (sql.startsWith(`INSERT INTO ${MIGRATIONS_TABLE}`)) {
      inserted.push({ version: String(params[0]), checksum: String(params[2]) });
      return { affectedRows: 1 };
    }
    return undefined;
  });
  return { client, inserted };
}

describe('loadMigrations', () => {
  it('orders migrations by version and keeps name + checksum', () => {
    const dir = migrationDir({
      '0002_add_index.sql': 'ALTER TABLE t ADD KEY i (a);',
      '0001_initial.sql': 'CREATE TABLE t (a INT);',
    });
    const migrations = loadMigrations(dir);
    expect(migrations.map((migration) => migration.version)).toEqual(['0001', '0002']);
    expect(migrations[0].name).toBe('initial');
    expect(migrations[0].checksum).toBe(checksumOf('CREATE TABLE t (a INT);'));
    expect(migrations[0].statements).toEqual(['CREATE TABLE t (a INT)']);
  });

  it('refuses a file name outside the versioned pattern', () => {
    const dir = migrationDir({ 'init.sql': 'SELECT 1;' });
    expect(() => loadMigrations(dir)).toThrow(/0001_name\.sql/);
  });

  it('refuses the same version twice', () => {
    const dir = migrationDir({
      '0001_initial.sql': 'SELECT 1;',
      '0001_again.sql': 'SELECT 2;',
    });
    expect(() => loadMigrations(dir)).toThrow(/duplicate migration version 0001/);
  });

  it('refuses an empty or unreadable directory', () => {
    expect(() => loadMigrations(migrationDir({}))).toThrow(/no \*\.sql migration files/);
    expect(() => loadMigrations(join(tmpdir(), 'wish-does-not-exist-0000'))).toThrow(
      /migrations directory not readable/,
    );
  });
});

describe('applyMigrations', () => {
  it('creates the bookkeeping table and applies only the missing versions', async () => {
    const dir = migrationDir({
      '0001_initial.sql': 'CREATE TABLE t (a INT);',
      '0002_extra.sql': 'CREATE TABLE u (b INT);',
    });
    const migrations = loadMigrations(dir);
    const { client, inserted } = clientWith([
      { version: '0001', checksum: migrations[0].checksum },
    ]);

    const applied = await applyMigrations(client, migrations);

    expect(applied).toEqual(['0002']);
    expect(client.statements[0].sql).toContain(MIGRATIONS_TABLE);
    expect(client.lastStatement(/CREATE TABLE u/).sql).toBe('CREATE TABLE u (b INT)');
    expect(inserted).toEqual([{ version: '0002', checksum: migrations[1].checksum }]);
    // The already-applied migration was not executed again.
    expect(client.statementsMatching(/CREATE TABLE t/)).toHaveLength(0);
  });

  it('records the applied timestamp it is given', async () => {
    const dir = migrationDir({ '0001_initial.sql': 'CREATE TABLE t (a INT);' });
    const { client } = clientWith([]);
    const at = new Date('2026-11-10T09:00:00.000Z');

    await applyMigrations(client, loadMigrations(dir), () => at);

    expect(client.lastStatement(/INSERT INTO schema_migrations/).params).toEqual([
      '0001',
      'initial',
      expect.stringMatching(/^[0-9a-f]{64}$/),
      at,
    ]);
  });

  it('refuses a migration that changed after it was applied', async () => {
    const dir = migrationDir({ '0001_initial.sql': 'CREATE TABLE t (a INT);' });
    const migrations = loadMigrations(dir);
    const { client } = clientWith([{ version: '0001', checksum: 'a'.repeat(64) }]);

    await expect(applyMigrations(client, migrations)).rejects.toThrow(SqlMigrationError);
    await expect(applyMigrations(client, migrations)).rejects.toThrow(/changed after it was applied/);
  });

  it('refuses a database schema that is ahead of the build', async () => {
    const dir = migrationDir({ '0001_initial.sql': 'CREATE TABLE t (a INT);' });
    const migrations = loadMigrations(dir);
    const { client } = clientWith([
      { version: '0001', checksum: migrations[0].checksum },
      { version: '0002', checksum: 'b'.repeat(64) },
    ]);

    await expect(applyMigrations(client, migrations)).rejects.toThrow(
      /schema is ahead of this build/,
    );
  });

  it('reports which statement of which migration failed', async () => {
    const dir = migrationDir({
      '0001_initial.sql': 'CREATE TABLE t (a INT);\nCREATE TABLE u (b INT);',
    });
    const client = new FakeSqlClient((sql) =>
      sql === 'CREATE TABLE u (b INT)' ? { error: new Error('syntax error') } : undefined,
    );

    await expect(applyMigrations(client, loadMigrations(dir))).rejects.toThrow(
      /migration 0001 \(initial\) failed on statement 2\/2: syntax error/,
    );
  });
});
