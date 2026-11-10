/**
 * `node dist/db/seed.js` (or `pnpm --filter @wish/server db:seed`) — apply the
 * demo seed (`db/seed/demo.sql`) to a migrated MySQL database.
 *
 * Kept out of startup on purpose: seeding demo listings is a deliberate
 * environment action, not part of serving the API. Re-running it is safe (the
 * seed's rows carry fixed UUIDs and no-op on duplicate keys).
 */
import {
  DEFAULT_SEED_DIR,
  SEED_DIR_ENV,
  createSqlClient,
  resolveDataDirectory,
} from '../infrastructure/mysql/mysql-bootstrap';
import { applySeed } from '../infrastructure/mysql/seed';
import { describeError } from '../infrastructure/mysql/mysql-support';
import {
  describeMysqlTarget,
  mysqlSettingsFromEnv,
  storageModeFromEnv,
} from '../infrastructure/storage/storage-mode';

async function main(): Promise<void> {
  if (storageModeFromEnv() !== 'mysql') {
    throw new Error('WISH_STORAGE is not "mysql"; set WISH_STORAGE=mysql to seed the MySQL database');
  }

  const settings = mysqlSettingsFromEnv();
  const target = describeMysqlTarget(settings);
  const seedDir = resolveDataDirectory(process.env, SEED_DIR_ENV, DEFAULT_SEED_DIR);
  const client = createSqlClient(settings);

  try {
    await client.ping();
    const report = await applySeed(client, seedDir);
    console.log(
      JSON.stringify({ target, seedDir, ...report, demoPasswordHint: 'demo-pass-1234' }, null, 2),
    );
  } finally {
    await client.close();
  }
}

void main().catch((error: unknown) => {
  console.error(`wish seed failed: ${describeError(error)}`);
  process.exitCode = 1;
});
