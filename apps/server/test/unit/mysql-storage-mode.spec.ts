/**
 * Storage selection rules (MySQL data-layer slice): `memory` stays the default
 * so the existing behaviour is untouched, `mysql` is explicit, and an unknown
 * value refuses to start instead of guessing a store.
 */
import {
  DEFAULT_STORAGE_MODE,
  MYSQL_SETTING_DEFAULTS,
  StorageConfigurationError,
  describeMysqlTarget,
  mysqlSettingsFromEnv,
  parseStorageMode,
  storageModeFromEnv,
} from '../../src/infrastructure/storage/storage-mode';

const env = (values: Record<string, string | undefined>): NodeJS.ProcessEnv =>
  values as NodeJS.ProcessEnv;

describe('parseStorageMode', () => {
  it('defaults to the in-memory adapters when WISH_STORAGE is absent', () => {
    expect(DEFAULT_STORAGE_MODE).toBe('memory');
    expect(parseStorageMode(undefined)).toBe('memory');
    expect(parseStorageMode('')).toBe('memory');
    expect(parseStorageMode('   ')).toBe('memory');
  });

  it('selects mysql explicitly, ignoring case and padding', () => {
    expect(parseStorageMode('mysql')).toBe('mysql');
    expect(parseStorageMode('  MySQL ')).toBe('mysql');
    expect(parseStorageMode('memory')).toBe('memory');
  });

  it('refuses an unknown store instead of falling back', () => {
    expect(() => parseStorageMode('postgres')).toThrow(StorageConfigurationError);
    expect(() => parseStorageMode('postgres')).toThrow(/WISH_STORAGE/);
    expect(() => parseStorageMode('true')).toThrow(/memory\|mysql/);
  });

  it('reads the process environment through the same rule', () => {
    expect(storageModeFromEnv(env({}))).toBe('memory');
    expect(storageModeFromEnv(env({ WISH_STORAGE: 'mysql' }))).toBe('mysql');
    expect(() => storageModeFromEnv(env({ WISH_STORAGE: 'sqlite' }))).toThrow(
      StorageConfigurationError,
    );
  });
});

describe('mysqlSettingsFromEnv', () => {
  it('fills local-development defaults that match docker-compose', () => {
    const settings = mysqlSettingsFromEnv(env({}));
    expect(settings).toEqual({
      host: MYSQL_SETTING_DEFAULTS.host,
      port: MYSQL_SETTING_DEFAULTS.port,
      user: MYSQL_SETTING_DEFAULTS.user,
      password: '',
      database: MYSQL_SETTING_DEFAULTS.database,
      connectionLimit: MYSQL_SETTING_DEFAULTS.connectionLimit,
    });
    expect(describeMysqlTarget(settings)).toBe('127.0.0.1:3306/wish');
  });

  it('reads the compose variable names', () => {
    const settings = mysqlSettingsFromEnv(
      env({
        WISH_DB_HOST: 'mysql',
        WISH_DB_PORT: '3307',
        WISH_DB_USER: 'wish_app',
        WISH_DB_PASSWORD: 'secret-value',
        WISH_DB_NAME: 'wish_dev',
        WISH_DB_CONNECTION_LIMIT: '4',
      }),
    );
    expect(settings).toEqual({
      host: 'mysql',
      port: 3307,
      user: 'wish_app',
      password: 'secret-value',
      database: 'wish_dev',
      connectionLimit: 4,
    });
  });

  it('refuses a non-integer or out-of-range port', () => {
    expect(() => mysqlSettingsFromEnv(env({ WISH_DB_PORT: '3306abc' }))).toThrow(
      /WISH_DB_PORT/,
    );
    expect(() => mysqlSettingsFromEnv(env({ WISH_DB_PORT: '0' }))).toThrow(/WISH_DB_PORT/);
    expect(() => mysqlSettingsFromEnv(env({ WISH_DB_PORT: '70000' }))).toThrow(/WISH_DB_PORT/);
  });

  it('refuses an unusable connection limit', () => {
    expect(() => mysqlSettingsFromEnv(env({ WISH_DB_CONNECTION_LIMIT: '0' }))).toThrow(
      /WISH_DB_CONNECTION_LIMIT/,
    );
    expect(() => mysqlSettingsFromEnv(env({ WISH_DB_CONNECTION_LIMIT: 'lots' }))).toThrow(
      /WISH_DB_CONNECTION_LIMIT/,
    );
  });

  it('never puts the password into the target description used in logs', () => {
    const settings = mysqlSettingsFromEnv(env({ WISH_DB_PASSWORD: 'super-secret-value' }));
    expect(describeMysqlTarget(settings)).not.toContain('super-secret-value');
  });
});
