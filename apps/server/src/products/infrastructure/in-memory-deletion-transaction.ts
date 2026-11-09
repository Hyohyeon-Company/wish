/**
 * In-memory adapter of the product deletion's transaction boundary
 * (products/application port). There is no MySQL binding yet, so the
 * boundary is an explicit port with this adapter: it runs the deletion's
 * two writes — the soft-deleted product save and the AC6.2 favorite
 * cleanup — as one sequential unit. The eventual SQL adapter replaces it
 * with BEGIN/COMMIT around the same work without touching the use case.
 */
import type { ProductDeletionTransaction } from '../application/product-use-cases';

export class InMemoryDeletionTransaction implements ProductDeletionTransaction {
  async run(work: () => Promise<void>): Promise<void> {
    await work();
  }
}
