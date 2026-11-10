import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { initializeMysqlStorage } from './infrastructure/mysql/mysql-bootstrap';
import { describeError } from './infrastructure/mysql/mysql-support';

/**
 * Startup order matters for the storage option: migrations run BEFORE the
 * router starts serving, so the first request never hits a missing table.
 * `initializeMysqlStorage` is a no-op in the default `memory` mode.
 */
async function bootstrap(): Promise<void> {
  const storage = await initializeMysqlStorage();
  if (storage !== null) {
    const applied = storage.applied.length === 0 ? 'none' : storage.applied.join(', ');
    console.log(`wish storage: mysql ${storage.target} (migrations applied: ${applied})`);
  }

  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port);
  console.log(`wish API listening on port ${port}`);
}

void bootstrap().catch((error: unknown) => {
  // Fail closed with a single readable line: no silent fallback, no half-up API.
  console.error(`wish API failed to start: ${describeError(error)}`);
  process.exitCode = 1;
});

