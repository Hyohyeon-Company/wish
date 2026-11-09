/**
 * Category of the wish catalog (brief §6 Category): a fixed flat list — no
 * hierarchy in v1. The set and order are extracted from the approved sell-v1
 * screen's chips (가구/인테리어 · 디지털 · 의류 · 뷰티 · 스포츠/레저), per
 * user-flow §2-5-4 ("Backend가 화면 HTML에서 추출해 기록").
 *
 * Recorded decision: `code` is a stable ASCII slug owned by the backend (URL
 * and persistence safe), while `name` is the exact Korean chip label from the
 * screen. `GET /api/categories` (§2-2) serves name+display_order so the sell
 * screen and later filter chips render the same fixed list.
 */

export interface Category {
  readonly code: string;
  readonly name: string;
  readonly displayOrder: number;
}

export const CATEGORIES: readonly Category[] = [
  { code: 'furniture', name: '가구/인테리어', displayOrder: 1 },
  { code: 'digital', name: '디지털', displayOrder: 2 },
  { code: 'fashion', name: '의류', displayOrder: 3 },
  { code: 'beauty', name: '뷰티', displayOrder: 4 },
  { code: 'sports', name: '스포츠/레저', displayOrder: 5 },
];

/** Categories in display order — the shape of the §2-2 GET response. */
export function listCategories(): Category[] {
  return [...CATEGORIES].sort((a, b) => a.displayOrder - b.displayOrder);
}

/** null for an unknown code — the caller turns that into a field failure. */
export function findCategory(code: unknown): Category | null {
  if (typeof code !== 'string') return null;
  return CATEGORIES.find((category) => category.code === code) ?? null;
}
