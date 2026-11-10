/**
 * Provides the shared MySQL client when `WISH_STORAGE=mysql`.
 *
 * Both feature modules import this module, and Nest instantiates a module once
 * per class, so the repositories and the deletion transaction receive the SAME
 * `SqlClient`. That identity is what makes `transaction(...)` cover both
 * writes: the AsyncLocalStorage-bound connection is shared, not per-repository.
 *
 * In `memory` mode the module provides nothing — the in-memory adapters stay
 * the default and no MySQL connection is ever attempted.
 */
import { Module } from '@nestjs/common';
import { storageModeFromEnv } from '../storage/storage-mode';
import { createSqlClient } from './mysql-bootstrap';
import { SqlClient } from './sql-client';

const STORAGE_MODE = storageModeFromEnv();

@Module({
  providers:
    STORAGE_MODE === 'mysql'
      ? [{ provide: SqlClient, useFactory: () => createSqlClient() }]
      : [],
  exports: STORAGE_MODE === 'mysql' ? [SqlClient] : [],
})
export class MysqlModule {}
