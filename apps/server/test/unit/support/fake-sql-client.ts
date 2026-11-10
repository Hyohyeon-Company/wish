/**
 * Scripted in-memory `SqlClient` for adapter tests.
 *
 * It extends the real `SqlClient`, so the tests exercise the actual
 * transaction/AsyncLocalStorage wiring (which statement ran on which
 * connection, and whether the work committed or rolled back) without a MySQL
 * server. `scope` on every recorded statement answers the question the
 * deletion-transaction contract cares about: did the repository calls inside
 * `run()` join the transaction connection?
 */
import {
  SqlClient,
  type SqlExecutor,
  type SqlParameter,
} from '../../../src/infrastructure/mysql/sql-client';

export interface FakeResponse {
  readonly rows?: readonly unknown[];
  readonly affectedRows?: number;
  readonly error?: Error;
}

export interface RecordedStatement {
  readonly sql: string;
  readonly params: readonly SqlParameter[];
  readonly scope: 'pool' | 'transaction';
}

export type FakeHandler = (
  sql: string,
  params: readonly SqlParameter[],
) => FakeResponse | undefined;

export class FakeSqlClient extends SqlClient {
  readonly statements: RecordedStatement[] = [];
  /** `begin:<n>` / `commit:<n>` / `rollback:<n>` in occurrence order. */
  readonly lifecycle: string[] = [];
  pingError: Error | null = null;
  closed = false;
  private connectionCount = 0;

  constructor(private readonly handler: FakeHandler = () => undefined) {
    super();
  }

  async ping(): Promise<void> {
    if (this.pingError !== null) throw this.pingError;
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  statementsMatching(pattern: RegExp): RecordedStatement[] {
    return this.statements.filter((statement) => pattern.test(statement.sql));
  }

  lastStatement(pattern: RegExp): RecordedStatement {
    const matching = this.statementsMatching(pattern);
    if (matching.length === 0) {
      throw new Error(`no statement matched ${String(pattern)}; recorded: ${this.describe()}`);
    }
    return matching[matching.length - 1];
  }

  describe(): string {
    return this.statements.map((statement) => statement.sql.replace(/\s+/g, ' ').trim()).join(' | ');
  }

  respond(sql: string, params: readonly SqlParameter[]): FakeResponse {
    return this.handler(sql, params) ?? { rows: [], affectedRows: 0 };
  }

  record(statement: RecordedStatement): void {
    this.statements.push(statement);
  }

  protected poolExecutor(): SqlExecutor {
    return new FakeExecutor(this, 'pool');
  }

  protected async runTransaction<Result>(
    work: (transaction: SqlExecutor) => Promise<Result>,
  ): Promise<Result> {
    this.connectionCount += 1;
    const connection = this.connectionCount;
    this.lifecycle.push(`begin:${connection}`);
    try {
      const result = await work(new FakeExecutor(this, 'transaction'));
      this.lifecycle.push(`commit:${connection}`);
      return result;
    } catch (error) {
      this.lifecycle.push(`rollback:${connection}`);
      throw error;
    }
  }
}

class FakeExecutor implements SqlExecutor {
  constructor(
    private readonly client: FakeSqlClient,
    private readonly scope: 'pool' | 'transaction',
  ) {}

  async query<Row>(sql: string, params: readonly SqlParameter[] = []): Promise<Row[]> {
    return this.run(sql, params).rows as Row[];
  }

  async execute(sql: string, params: readonly SqlParameter[] = []): Promise<number> {
    const response = this.run(sql, params);
    return response.affectedRows ?? 0;
  }

  private run(
    sql: string,
    params: readonly SqlParameter[],
  ): { rows: readonly unknown[]; affectedRows?: number } {
    this.client.record({ sql, params, scope: this.scope });
    const response = this.client.respond(sql, params);
    if (response.error !== undefined) throw response.error;
    return { rows: response.rows ?? [], affectedRows: response.affectedRows };
  }
}
