/**
 * MySQL startup preparation (no database).
 *
 * The contract this protects: `memory` mode touches MySQL at all; `mysql` mode
 * either proves the database reachable and applies migrations, or fails with a
 * clear error. It must never fall back silently — that would look healthy while
 * dropping persistence.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  StorageUnavailableError,
  initializeMysqlStorage,
  resolveDataDirectory,
} from '../../src/infrastructure/mysql/mysql-bootstrap';
import { SqlMigrationError } from '../../src/infrastructure/mysql/migrator';
import { StorageConfigurationError } from '../../src/infrastructure/storage/storage-mode';
import { FakeSqlClient } from './support/fake-sql-client';

const env = (values: Record<string, string | undefined>): NodeJS.ProcessEnv =>
  values as NodeJS.ProcessEnv;

const dirs: string[] = [];

function migrationDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'wish-bootstrap-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function migrationClient(
  recorded: ReadonlyArray<{ version: string; checksum: string }> = [],
): FakeSqlClient {
  return new FakeSqlClient((sql) => {
    if (sql.startsWith('SELECT version, checksum FROM schema_migrations')) {
      return { rows: recorded };
    }
    if (sql.startsWith('INSERT INTO schema_migrations')) return { affectedRows: 1 };
    return undefined;
  });
}

describe('initializeMysqlStorage', () => {
  it('does nothing in the default memory mode', async () => {
    const factory = jest.fn(() => new FakeSqlClient());

    await expect(
      initializeMysqlStorage({ env: env({}), createClient: factory, migrationsDir: '/nonexistent' }),
    ).resolves.toBeNull();
    expect(factory).not.toHaveBeenCalled();
  });

  it('refuses to start when MySQL is unreachable', async () => {
    const client = new FakeSqlClient();
    client.pingError = new Error('connect ECONNREFUSED 10.0.0.5:3306');

    const failure = initializeMysqlStorage({
      env: env({ WISH_STORAGE: 'mysql', WISH_DB_HOST: 'mysql', WISH_DB_NAME: 'wish' }),
      createClient: () => client,
      migrationsDir: migrationDir({ '0001_initial.sql': 'CREATE TABLE t (a INT);' }),
    });

    await expect(failure).rejects.toBeInstanceOf(StorageUnavailableError);
    await expect(failure).rejects.toThrow(/mysql:3306\/wish/);
    await expect(failure).rejects.toThrow(/refusing to start instead of falling back to memory/);
    expect(client.closed).toBe(true);
  });

  it('pings, applies pending migrations and closes the check connection', async () => {
    const dir = migrationDir({ '0001_initial.sql': 'CREATE TABLE t (a INT);' });
    const client = migrationClient();

    const report = await initializeMysqlStorage({
      env: env({ WISH_STORAGE: 'mysql', WISH_DB_HOST: 'mysql' }),
      createClient: () => client,
      migrationsDir: dir,
    });

    expect(report).toEqual({
      target: 'mysql:3306/wish',
      migrationsDir: dir,
      applied: ['0001'],
    });
    expect(client.closed).toBe(true);
    expect(client.statements[0].sql).toContain('CREATE TABLE IF NOT EXISTS schema_migrations');
    expect(client.lastStatement(/CREATE TABLE t/).sql).toBe('CREATE TABLE t (a INT)');
  });

  it('reports a database schema that is ahead of the build', async () => {
    const dir = migrationDir({ '0001_initial.sql': 'CREATE TABLE t (a INT);' });
    const client = migrationClient([{ version: '0009', checksum: 'c'.repeat(64) }]);

    await expect(
      initializeMysqlStorage({
        env: env({ WISH_STORAGE: 'mysql' }),
        createClient: () => client,
        migrationsDir: dir,
      }),
    ).rejects.toBeInstanceOf(SqlMigrationError);
    expect(client.closed).toBe(true);
  });

  it('reports an unreadable migrations directory instead of starting', async () => {
    const client = migrationClient();

    await expect(
      initializeMysqlStorage({
        env: env({ WISH_STORAGE: 'mysql' }),
        createClient: () => client,
        migrationsDir: join(tmpdir(), 'wish-missing-migrations-0000'),
      }),
    ).rejects.toThrow(/migrations directory not readable/);
    expect(client.closed).toBe(true);
  });
});

describe('resolveDataDirectory', () => {
  it('prefers the explicit environment variable', () => {
    expect(
      resolveDataDirectory(env({ WISH_DB_MIGRATIONS_DIR: '/app/db/migrations' }), 'WISH_DB_MIGRATIONS_DIR', 'db/migrations'),
    ).toBe('/app/db/migrations');
  });

  it('walks up from the module to the repository db directory', () => {
    const resolved = resolveDataDirectory(env({}), 'WISH_DB_MIGRATIONS_DIR', 'db/migrations');
    expect(resolved.endsWith(join('db', 'migrations'))).toBe(true);
  });

  it('refuses when neither the variable nor the directory resolves', () => {
    expect(() =>
      resolveDataDirectory(
        env({ WISH_DB_SEED_DIR: '' }),
        'WISH_DB_SEED_DIR_UNUSED',
        join('no-such-dir', 'anywhere'),
      ),
    ).toThrow(StorageConfigurationError);
  });
});
