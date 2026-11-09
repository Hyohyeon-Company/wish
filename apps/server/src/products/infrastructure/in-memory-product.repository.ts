/**
 * In-memory ProductRepository adapter, same recorded posture as the member
 * slice: no MySQL binding exists yet for this project, so persistence is a
 * repository port with this adapter; the MySQL adapter replaces it without
 * touching the domain or use cases.
 *
 * `list` executes the §2-3 GET listing here: deleted products are excluded
 * (§6 deleted_at → 목록 제외), the filters combine, and the ordering is
 * deterministic — `latest` is created_at DESC with the adapter's insertion
 * sequence as the tie-break so two listings created in the same millisecond
 * keep a stable, newest-first order (a SQL adapter would use its own stable
 * secondary key, e.g. an auto-increment id; the choice belongs to the
 * adapter, the legality of values belongs to the query value object).
 */
import type {
  Product,
  ProductPage,
  ProductRepository,
  ProductSnapshot,
} from '../domain/product';
import type { ProductListingQuery } from '../domain/product-listing';

export class InMemoryProductRepository implements ProductRepository {
  private readonly byId = new Map<string, Product>();
  /** Insertion sequence per id — the adapter's stable ordering tie-break. */
  private readonly insertionOrder = new Map<string, number>();
  private sequence = 0;

  async save(product: Product): Promise<void> {
    if (!this.insertionOrder.has(product.id)) {
      this.insertionOrder.set(product.id, this.sequence++);
    }
    this.byId.set(product.id, product);
  }

  async findById(id: string): Promise<Product | null> {
    return this.byId.get(id) ?? null;
  }

  async list(query: ProductListingQuery): Promise<ProductPage> {
    const matching: Array<{ product: Product; snapshot: ProductSnapshot; order: number }> = [];
    for (const product of this.byId.values()) {
      if (product.isDeleted()) continue;
      const snapshot = product.toSnapshot();
      if (!matches(snapshot, query)) continue;
      matching.push({
        product,
        snapshot,
        order: this.insertionOrder.get(product.id) ?? -1,
      });
    }

    sort(matching, query.sort);
    const items = matching
      .slice(query.offset, query.offset + query.limit)
      .map((entry) => entry.product);
    return { items, total: matching.length };
  }
}

function matches(snapshot: ProductSnapshot, query: ProductListingQuery): boolean {
  if (
    query.keyword !== null &&
    !snapshot.title.toLowerCase().includes(query.keyword.toLowerCase())
  ) {
    return false;
  }
  if (query.categoryCode !== null && snapshot.categoryCode !== query.categoryCode) {
    return false;
  }
  if (query.minPrice !== null && snapshot.price < query.minPrice) return false;
  if (query.maxPrice !== null && snapshot.price > query.maxPrice) return false;
  if (query.status !== null && snapshot.status !== query.status) return false;
  if (query.region !== null && snapshot.region !== query.region) return false;
  return true;
}

/** Secondary key for every ordering: newest creation first, then newest insert. */
function newestFirst(
  a: { snapshot: ProductSnapshot; order: number },
  b: { snapshot: ProductSnapshot; order: number },
): number {
  return (
    b.snapshot.createdAt.getTime() - a.snapshot.createdAt.getTime() ||
    b.order - a.order
  );
}

function sort(
  entries: Array<{ snapshot: ProductSnapshot; order: number }>,
  sort: ProductListingQuery['sort'],
): void {
  if (sort === 'latest') {
    entries.sort((a, b) => newestFirst(a, b));
    return;
  }
  const byPrice =
    sort === 'price_asc'
      ? (a: { snapshot: ProductSnapshot }, b: { snapshot: ProductSnapshot }) =>
          a.snapshot.price - b.snapshot.price
      : (a: { snapshot: ProductSnapshot }, b: { snapshot: ProductSnapshot }) =>
          b.snapshot.price - a.snapshot.price;
  entries.sort((a, b) => byPrice(a, b) || newestFirst(a, b));
}
