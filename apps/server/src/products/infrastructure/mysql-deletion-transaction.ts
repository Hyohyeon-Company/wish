/**
 * MySQL adapter of the product deletion's transaction boundary (AC6.2).
 *
 * The in-memory adapter runs the deletion's two writes sequentially because a
 * single process cannot do better; here the boundary becomes a real MySQL
 * transaction. `SqlClient.transaction` binds one connection to the current
 * async context, so the product `trySave` and the favorite cleanup invoked
 * inside `run` execute on that connection and commit — or roll back — together.
 */
import type { ProductDeletionTransaction } from '../application/product-use-cases';
import type { SqlClient } from '../../infrastructure/mysql/sql-client';

export class MysqlDeletionTransaction implements ProductDeletionTransaction {
  constructor(private readonly client: SqlClient) {}

  async run(work: () => Promise<void>): Promise<void> {
    await this.client.transaction(async () => {
      await work();
    });
  }
}
