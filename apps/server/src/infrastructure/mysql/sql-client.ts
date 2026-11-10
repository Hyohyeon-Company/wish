/**
 * SQL execution boundary of the MySQL adapters.
 *
 * Two concerns live here:
 *
 * 1. `SqlExecutor` — the smallest surface a repository needs (a parameterised
 *    read and a parameterised write). The pool and one transaction connection
 *    both implement it, so the same repository code runs either way.
 * 2. `SqlClient` — the application-wide handle. `query`/`execute` resolve the
 *    executor from the current async context, so repository calls made inside
 *    `transaction(...)` automatically join that transaction. That keeps the
 *    existing repository ports unchanged: the deletion use case still calls
 *    `products.trySave` + `favorites.removeAllForProduct` inside
 *    `ProductDeletionTransaction.run`, and this adapter turns those two calls
 *    into one atomic MySQL transaction.
 *
 * Nested `transaction(...)` calls join the outer transaction instead of
 * opening a second connection (MySQL has no nested transactions here), which
 * is what a use case that saves several aggregates expects.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createPool, type Pool } from 'mysql2/promise';
import type { MysqlSettings } from '../storage/storage-mode';

/** Values the adapters bind into SQL parameters. */
export type SqlParameter = string | number | boolean | Date | null;

/** Parameterised SQL surface shared by the pool and a transaction connection. */
export interface SqlExecutor {
  query<Row>(sql: string, params?: readonly SqlParameter[]): Promise<Row[]>;
  /** Runs a write and answers `affectedRows`. */
  execute(sql: string, params?: readonly SqlParameter[]): Promise<number>;
}

export abstract class SqlClient {
  /** Transaction connection bound to the current async call tree, if any. */
  private readonly transactionScope = new AsyncLocalStorage<SqlExecutor>();

  async query<Row>(sql: string, params: readonly SqlParameter[] = []): Promise<Row[]> {
    return this.activeExecutor().query<Row>(sql, params);
  }

  async execute(sql: string, params: readonly SqlParameter[] = []): Promise<number> {
    return this.activeExecutor().execute(sql, params);
  }

  /**
   * Runs `work` inside BEGIN/COMMIT, rolling back when it throws. A call made
   * while another transaction is already open on this async context joins it.
   */
  async transaction<Result>(work: () => Promise<Result>): Promise<Result> {
    if (this.transactionScope.getStore() !== undefined) return work();
    return this.runTransaction((connection) =>
      this.transactionScope.run(connection, work),
    );
  }

  /** Fails when the database cannot be reached; used by the startup check. */
  abstract ping(): Promise<void>;

  abstract close(): Promise<void>;

  /** Executor used outside a transaction. */
  protected abstract poolExecutor(): SqlExecutor;

  /** Opens one connection, wraps `work` in BEGIN/COMMIT and releases it. */
  protected abstract runTransaction<Result>(
    work: (transaction: SqlExecutor) => Promise<Result>,
  ): Promise<Result>;

  private activeExecutor(): SqlExecutor {
    return this.transactionScope.getStore() ?? this.poolExecutor();
  }
}

/**
 * mysql2-backed client. `timezone: 'Z'` makes DATETIME(3) columns round-trip
 * as the same UTC instant the application wrote; `utf8mb4` keeps Korean text
 * and emoji intact.
 */
export class Mysql2SqlClient extends SqlClient {
  private constructor(private readonly pool: Pool) {
    super();
  }

  static fromSettings(settings: MysqlSettings): Mysql2SqlClient {
    const pool = createPool({
      host: settings.host,
      port: settings.port,
      user: settings.user,
      password: settings.password,
      database: settings.database,
      connectionLimit: settings.connectionLimit,
      timezone: 'Z',
      charset: 'utf8mb4',
      waitForConnections: true,
      enableKeepAlive: true,
    });
    return new Mysql2SqlClient(pool);
  }

  async ping(): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.ping();
    } finally {
      connection.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  protected poolExecutor(): SqlExecutor {
    return new PoolExecutor(this.pool);
  }

  protected async runTransaction<Result>(
    work: (transaction: SqlExecutor) => Promise<Result>,
  ): Promise<Result> {
    const connection = await this.pool.getConnection();
    const transaction = new ConnectionExecutor(connection);
    try {
      await connection.beginTransaction();
      const result = await work(transaction);
      await connection.commit();
      return result;
    } catch (error) {
      // A rollback failure must not hide the original cause; the connection is
      // released either way and MySQL rolls back on disconnect.
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }
}

/** mysql2 returns a result-header union for writes; only affectedRows matters. */
function affectedRowsOf(result: unknown): number {
  if (typeof result === 'object' && result !== null && 'affectedRows' in result) {
    const value = (result as { affectedRows?: unknown }).affectedRows;
    if (typeof value === 'number') return value;
  }
  throw new Error('mysql: the statement did not return an affected-row count');
}

class PoolExecutor implements SqlExecutor {
  constructor(private readonly pool: Pool) {}

  async query<Row>(sql: string, params: readonly SqlParameter[] = []): Promise<Row[]> {
    const [rows] = await this.pool.query(sql, [...params]);
    return rows as unknown as Row[];
  }

  async execute(sql: string, params: readonly SqlParameter[] = []): Promise<number> {
    const [result] = await this.pool.execute(sql, [...params]);
    return affectedRowsOf(result);
  }
}

class ConnectionExecutor implements SqlExecutor {
  constructor(private readonly connection: Awaited<ReturnType<Pool['getConnection']>>) {}

  async query<Row>(sql: string, params: readonly SqlParameter[] = []): Promise<Row[]> {
    const [rows] = await this.connection.query(sql, [...params]);
    return rows as unknown as Row[];
  }

  async execute(sql: string, params: readonly SqlParameter[] = []): Promise<number> {
    const [result] = await this.connection.execute(sql, [...params]);
    return affectedRowsOf(result);
  }
}
