/**
 * `node dist/db/migrate.js` (or `pnpm --filter @wish/server db:migrate`) —
 * apply pending MySQL migrations without starting the API.
 *
 * The API already migrates at startup when `WISH_STORAGE=mysql`; this entry
 * point exists for controlled runs (documented in the container runbook):
 * inspecting the applied set, migrating before a rollout, or recovering a
 * failed migration. It refuses to run when the storage mode is not mysql, so a
 * typo cannot look like a successful no-op.
 */
import {
  DEFAULT_MIGRATIONS_DIR,
  MIGRATIONS_DIR_ENV,
  createSqlClient,
  resolveDataDirectory,
} from '../infrastructure/mysql/mysql-bootstrap';
import { applyMigrations, loadMigrations } from '../infrastructure/mysql/migrator';
import { describeError } from '../infrastructure/mysql/mysql-support';
import {
  describeMysqlTarget,
  mysqlSettingsFromEnv,
  storageModeFromEnv,
} from '../infrastructure/storage/storage-mode';

async function main(): Promise<void> {
  if (storageModeFromEnv() !== 'mysql') {
    throw new Error(
      'WISH_STORAGE is not "mysql"; set WISH_STORAGE=mysql to migrate the MySQL schema',
    );
  }

  const settings = mysqlSettingsFromEnv();
  const target = describeMysqlTarget(settings);
  const migrationsDir = resolveDataDirectory(
    process.env,
    MIGRATIONS_DIR_ENV,
    DEFAULT_MIGRATIONS_DIR,
  );
  const migrations = loadMigrations(migrationsDir);
  const client = createSqlClient(settings);

  try {
    await client.ping();
    const applied = await applyMigrations(client, migrations);
    console.log(
      JSON.stringify(
        {
          target,
          migrationsDir,
          known: migrations.map((migration) => `${migration.version}_${migration.name}`),
          applied,
          upToDate: applied.length === 0,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.close();
  }
}

void main().catch((error: unknown) => {
  console.error(`wish migration failed: ${describeError(error)}`);
  process.exitCode = 1;
});
