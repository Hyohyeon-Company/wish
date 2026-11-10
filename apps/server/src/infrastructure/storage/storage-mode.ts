/**
 * Persistence storage selection (recorded decision, MySQL data-layer slice).
 *
 * `WISH_STORAGE` chooses the adapter behind the existing repository ports:
 *
 * - `memory` (default) — the in-process adapters the earlier slices shipped.
 *   Keeping it the default means the existing unit/e2e suites and a bare local
 *   run behave exactly as before.
 * - `mysql` — the SQL adapters in `infrastructure/mysql`. When MySQL is
 *   unreachable the API refuses to start (see `initializeMysqlStorage`); it
 *   never falls back to `memory`, because a silent fallback would report a
 *   healthy API while dropping every write on restart.
 *
 * An unknown value is a configuration error raised at startup: the store is
 * never guessed.
 */

export const STORAGE_MODES = ['memory', 'mysql'] as const;
export type StorageMode = (typeof STORAGE_MODES)[number];

export const DEFAULT_STORAGE_MODE: StorageMode = 'memory';

/** Invalid or incomplete persistence configuration (startup refusal). */
export class StorageConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageConfigurationError';
  }
}

export function parseStorageMode(raw: string | undefined): StorageMode {
  if (raw === undefined || raw.trim() === '') return DEFAULT_STORAGE_MODE;
  const value = raw.trim().toLowerCase();
  if ((STORAGE_MODES as readonly string[]).includes(value)) {
    return value as StorageMode;
  }
  throw new StorageConfigurationError(
    `WISH_STORAGE must be one of ${STORAGE_MODES.join('|')}, got "${raw}"`,
  );
}

export function storageModeFromEnv(env: NodeJS.ProcessEnv = process.env): StorageMode {
  return parseStorageMode(env.WISH_STORAGE);
}

/** Connection settings the MySQL adapter needs; no secrets are logged. */
export interface MysqlSettings {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
  readonly connectionLimit: number;
}

/**
 * Local-development defaults that match `docker-compose.yml`. Production
 * values come from the environment (the compose file passes them through);
 * the defaults exist so a single-container run against a local MySQL works
 * without exporting every variable.
 */
export const MYSQL_SETTING_DEFAULTS = {
  host: '127.0.0.1',
  port: 3306,
  user: 'wish',
  database: 'wish',
  connectionLimit: 10,
} as const;

const MAX_CONNECTION_LIMIT = 100;

function requireText(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return raw.trim();
}

function requireInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new StorageConfigurationError(
      `${name} must be an integer between ${min} and ${max}, got "${raw}"`,
    );
  }
  return value;
}

export function mysqlSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): MysqlSettings {
  return {
    host: requireText(env, 'WISH_DB_HOST', MYSQL_SETTING_DEFAULTS.host),
    port: requireInteger(env, 'WISH_DB_PORT', MYSQL_SETTING_DEFAULTS.port, 1, 65535),
    user: requireText(env, 'WISH_DB_USER', MYSQL_SETTING_DEFAULTS.user),
    // An empty password is legal for a local socket/user; it is never
    // defaulted to something secret-looking, and it is never logged.
    password: env.WISH_DB_PASSWORD ?? '',
    database: requireText(env, 'WISH_DB_NAME', MYSQL_SETTING_DEFAULTS.database),
    connectionLimit: requireInteger(
      env,
      'WISH_DB_CONNECTION_LIMIT',
      MYSQL_SETTING_DEFAULTS.connectionLimit,
      1,
      MAX_CONNECTION_LIMIT,
    ),
  };
}

/** One-line description of the target used in startup errors (no password). */
export function describeMysqlTarget(settings: MysqlSettings): string {
  return `${settings.host}:${settings.port}/${settings.database}`;
}
