/**
 * In-memory ProductRepository adapter, same recorded posture as the member
 * slice: no MySQL binding exists yet for this project, so persistence is a
 * repository port with this adapter; the MySQL adapter replaces it without
 * touching the domain or use cases.
 */
import type { Product, ProductRepository } from '../domain/product';

export class InMemoryProductRepository implements ProductRepository {
  private readonly byId = new Map<string, Product>();

  async save(product: Product): Promise<void> {
    this.byId.set(product.id, product);
  }

  async findById(id: string): Promise<Product | null> {
    return this.byId.get(id) ?? null;
  }
}
