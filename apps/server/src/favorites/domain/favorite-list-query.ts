/**
 * Value object of the §2-4 GET /api/favorites query: `page` (1 시작) and
 * `limit` (기본 24, 최대 50) with the same contract semantics as the product
 * listing's page/limit (§2-0 페이징) — out-of-range or non-numeric values are
 * a 400 field error, not a silent clamp, and an empty value (`?page=`) is
 * treated as absent so a stale link never errors. Parsing lives in the
 * favorites context (not the controller) so the 400-with-fields body is
 * produced by the domain, mirroring ProductListingQuery.
 */
import { fieldFailure } from '../../products/domain/product-field-validation';
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from '../../products/domain/product-listing';

export class FavoriteListQuery {
  private constructor(readonly page: number, readonly limit: number) {}

  static parse(raw: Record<string, unknown>): FavoriteListQuery {
    const page = parsePage(raw.page);
    const limit = parseLimit(raw.limit);
    return new FavoriteListQuery(page, limit);
  }

  /** First row of the page (0-based), derived from the parsed page/limit. */
  get offset(): number {
    return (this.page - 1) * this.limit;
  }
}

export function favoriteProductField(raw: unknown): string {
  if (typeof raw !== 'string') {
    fieldFailure('product_id', 'product_id를 확인해 주세요.');
  }
  const value = (raw as string).trim();
  if (value.length === 0) {
    fieldFailure('product_id', 'product_id를 확인해 주세요.');
  }
  return value;
}

function parsePage(raw: unknown): number {
  if (raw === undefined || raw === '') return 1;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw) || Number(raw) < 1) {
    fieldFailure('page', '페이지 값을 확인해 주세요.');
  }
  return Number(raw);
}

function parseLimit(raw: unknown): number {
  if (raw === undefined || raw === '') return DEFAULT_LIST_LIMIT;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    fieldFailure('limit', 'limit 값을 확인해 주세요.');
  }
  const value = Number(raw);
  if (value < 1 || value > MAX_LIST_LIMIT) {
    fieldFailure('limit', `limit는 1~${MAX_LIST_LIMIT} 사이로 요청해 주세요.`);
  }
  return value;
}
