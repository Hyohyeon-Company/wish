/**
 * Startup preparation for the MySQL storage option.
 *
 * `initializeMysqlStorage()` is a no-op unless `WISH_STORAGE=mysql`. In mysql
 * mode it proves the database is reachable, applies pending migrations and
 * then closes the check connection; the serving pool is created by
 * `MysqlModule`. Any failure is raised — the API must not start, and it must
 * never fall back to the in-memory adapters, because that fallback would look
 * like a working service while silently dropping persistence.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  StorageConfigurationError,
  describeMysqlTarget,
  mysqlSettingsFromEnv,
  storageModeFromEnv,
  type MysqlSettings,
} from '../storage/storage-mode';
import { Mysql2SqlClient, type SqlClient } from './sql-client';
import { applyMigrations, loadMigrations } from './migrator';
import { describeError } from './mysql-support';

export const MIGRATIONS_DIR_ENV = 'WISH_DB_MIGRATIONS_DIR';
export const SEED_DIR_ENV = 'WISH_DB_SEED_DIR';
export const DEFAULT_MIGRATIONS_DIR = join('db', 'migrations');
export const DEFAULT_SEED_DIR = join('db', 'seed');

/** The configured database exists but cannot be used. */
export class StorageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageUnavailableError';
  }
}

export function createSqlClient(
  settings: MysqlSettings = mysqlSettingsFromEnv(),
): SqlClient {
  return Mysql2SqlClient.fromSettings(settings);
}

/**
 * Resolves a data directory (`db/migrations`, `db/seed`): the environment
 * variable wins; otherwise the nearest ancestor of this module that contains
 * the directory. The container image bakes `db/` at `/app/db` and also sets
 * the variable explicitly, so both paths stay obvious.
 */
export function resolveDataDirectory(
  env: NodeJS.ProcessEnv,
  variable: string,
  relativePath: string,
): string {
  const configured = env[variable];
  if (configured !== undefined && configured.trim() !== '') return resolve(configured.trim());

  let directory = __dirname;
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(directory, relativePath);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new StorageConfigurationError(
    `could not locate ${relativePath} from ${__dirname}; set ${variable} explicitly`,
  );
}

export interface MysqlStorageReport {
  readonly target: string;
  readonly migrationsDir: string;
  readonly applied: readonly string[];
}

export interface InitializeMysqlStorageOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly createClient?: (settings: MysqlSettings) => SqlClient;
  readonly migrationsDir?: string;
}

export async function initializeMysqlStorage(
  options: InitializeMysqlStorageOptions = {},
): Promise<MysqlStorageReport | null> {
  const env = options.env ?? process.env;
  if (storageModeFromEnv(env) !== 'mysql') return null;

  const settings = mysqlSettingsFromEnv(env);
  const target = describeMysqlTarget(settings);
  const client = (options.createClient ?? createSqlClient)(settings);

  try {
    try {
      await client.ping();
    } catch (error) {
      throw new StorageUnavailableError(
        `WISH_STORAGE=mysql but MySQL at ${target} is not reachable (${describeError(error)}); refusing to start instead of falling back to memory`,
      );
    }

    const migrationsDir =
      options.migrationsDir ??
      resolveDataDirectory(env, MIGRATIONS_DIR_ENV, DEFAULT_MIGRATIONS_DIR);
    const applied = await applyMigrations(client, loadMigrations(migrationsDir));
    return { target, migrationsDir, applied };
  } finally {
    await client.close().catch(() => undefined);
  }
}
