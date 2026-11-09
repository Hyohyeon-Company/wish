/**
 * search-v1 — the public search/category screen (journey A3/A4, card C4,
 * AC2.1~2.5). Visual source: design/t_8db2c17c/wish-search-v1.html, rendered
 * with design-system-v1 tokens only; the card grid, skeleton and tabbar are
 * the home feed's shared components (same §2-4 ProductCard projection).
 *
 * Recorded decisions (this card):
 * - The URL query string IS the filter state (q, category, status, min_price,
 *   max_price, region, sort): every control writes its change to /search?…
 *   with navigate(), and the page re-requests GET /api/products from the URL.
 *   Back/forward and a shared link therefore reproduce the exact filtered
 *   result, and the request always mirrors what the §2-3 query contract
 *   accepts — no client-side shadow state to drift from the URL.
 * - 검색어 매칭은 §2-3 계약 그대로: the server's case-insensitive literal
 *   partial title match (C3 기록, brief §6 "MySQL LIKE 수준으로 충분").
 *   Special characters are literal — the design's 검색 특수문자 RF4 concern
 *   is answered server-side (unit/e2e tests) and needs no client escaping.
 * - A3 (빈 검색어는 오류 아님): submitting an empty keyword on the search
 *   screen removes the q filter instead of erroring — the same no-error
 *   posture as the home entry, applied to the screen that owns the input.
 * - 필터 칩 (design §5 "가격∨·상태∨·지역∨", 활성 시 --brand 보더):
 *   상태 = 판매중만 토글(status=ACTIVE), 가격/지역 = token-styled popover
 *   with numeric/text inputs. The popover markup is the minimal form the
 *   static design leaves undefined; values map 1:1 onto §2-3 query params.
 * - 정렬 전환 (AC2.3): the single .sort control cycles
 *   최신순 → 가격 낮은순 → 가격 높은순 (the §2-0 enum order); each step
 *   re-requests with the new sort so the order change is server-observed.
 * - 결과 수 "N건" renders in every ready state, 0건 포함 (§3 search row).
 * - 빈 상태 (AC2.4): "검색 결과가 없어요." + 보조 안내 + 추천 검색어 칩 +
 *   목록 복귀. The design's 인기 검색어 칩 is rendered as static 추천 칩
 *   (수납장·선반·책상, the design's own sample terms): no popularity
 *   contract exists in v1, so fabricating a live ranking would be fake data
 *   — same posture as C3's 홈 인기 검색어 omission. A recommendation click
 *   starts a fresh search: it replaces q and clears the other filters.
 * - 오류 (§3 search row): toast + 재시도 re-requests with the filters
 *   preserved (the URL state is untouched by a failure).
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactElement, type ReactNode } from 'react';
import { ApiError, NETWORK_ERROR_MESSAGE, request } from '../lib/api';
import type { AuthState } from '../lib/auth';
import { navigate } from '../lib/router';
import { FeedSkeleton, FooterNav, ProductCardLink, type ListPage } from './home';
import { formatPrice } from '../lib/time';

interface CategoryView {
  readonly code: string;
  readonly name: string;
  readonly display_order: number;
}

/** The §2-0 sort enum, in cycle order. */
const SORT_CYCLE = ['latest', 'price_asc', 'price_desc'] as const;
type SortOption = (typeof SORT_CYCLE)[number];

const SORT_LABELS: Record<SortOption, string> = {
  latest: '최신순',
  price_asc: '가격 낮은순',
  price_desc: '가격 높은순',
};

/** Static 추천 검색어 (AC2.4) — the design's own sample terms, no ranking data. */
const RECOMMENDED_KEYWORDS = ['수납장', '선반', '책상'] as const;

/** The filter state as read from the /search URL (see header: URL = state). */
interface SearchState {
  readonly q: string | null;
  readonly category: string | null;
  readonly minPrice: string | null;
  readonly maxPrice: string | null;
  readonly status: string | null;
  readonly region: string | null;
  readonly sort: SortOption;
}

function readSearchState(query: URLSearchParams): SearchState {
  const rawSort = query.get('sort');
  return {
    q: emptyToNull(query.get('q')?.trim() ?? null),
    category: emptyToNull(query.get('category')),
    minPrice: emptyToNull(query.get('min_price')),
    maxPrice: emptyToNull(query.get('max_price')),
    // Only the contract's ACTIVE toggle is reachable from this UI; anything
    // else falls back to no status filter rather than a request the server
    // must 400 (정상 UI 경로에서는 발생하지 않는 값만 서버가 거부, A4).
    status: query.get('status') === 'ACTIVE' ? 'ACTIVE' : null,
    region: emptyToNull(query.get('region')?.trim() ?? null),
    sort: SORT_CYCLE.includes(rawSort as SortOption) ? (rawSort as SortOption) : 'latest',
  };
}

function emptyToNull(value: string | null): string | null {
  return value !== null && value.length > 0 ? value : null;
}

/** The §2-3 GET query: only the active filters travel, always first page. */
function buildApiPath(state: SearchState): string {
  const params = new URLSearchParams();
  if (state.q !== null) params.set('q', state.q);
  if (state.category !== null) params.set('category', state.category);
  if (state.minPrice !== null) params.set('min_price', state.minPrice);
  if (state.maxPrice !== null) params.set('max_price', state.maxPrice);
  if (state.status !== null) params.set('status', state.status);
  if (state.region !== null) params.set('region', state.region);
  params.set('sort', state.sort);
  params.set('page', '1');
  params.set('limit', '24');
  return `/api/products?${params.toString()}`;
}

/** Writes filter changes back into the /search URL (see header: URL = state). */
function updateParams(changes: Record<string, string | null>): void {
  const next = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) next.delete(key);
    else next.set(key, value);
  }
  const queryString = next.toString();
  navigate(queryString.length > 0 ? `/search?${queryString}` : '/search');
}

const PRICE_PATTERN = /^\d*$/;

export function SearchPage({ query, auth }: { query: URLSearchParams; auth: AuthState }): ReactElement {
  const state = useMemo(() => readSearchState(query), [query]);
  const apiPath = useMemo(() => buildApiPath(state), [state]);

  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [page, setPage] = useState<ListPage | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [favoriteError, setFavoriteError] = useState<string | null>(null);
  const [categories, setCategories] = useState<readonly CategoryView[]>([]);
  const [openPopover, setOpenPopover] = useState<'price' | 'region' | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setPhase('loading');
    setErrorMessage(null);
    try {
      const { body } = await request<ListPage>(apiPath);
      setPage(body);
      setPhase('ready');
    } catch (error) {
      setErrorMessage(
        error instanceof ApiError ? error.message : NETWORK_ERROR_MESSAGE,
      );
      setPhase('error');
    }
  }, [apiPath]);

  useEffect(() => {
    void load();
  }, [load]);

  // Category chips are an entry aid exactly as on home: a failed load leaves
  // 전체 alone on the rail instead of taking the screen down (§3).
  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const { body } = await request<readonly CategoryView[]>('/api/categories');
        if (!cancelled) setCategories(body);
      } catch {
        // silent: the chips are an entry aid, not screen state (§3).
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const keyword = String(data.get('q') ?? '').trim();
    // A3: 빈 검색어는 오류 아님 — clearing the input removes the q filter.
    updateParams({ q: keyword.length === 0 ? null : keyword });
  }

  function handleSortSwitch(): void {
    const index = SORT_CYCLE.indexOf(state.sort);
    const next = SORT_CYCLE[(index + 1) % SORT_CYCLE.length] as SortOption;
    updateParams({ sort: next });
  }

  const activeCategory = state.category;
  const priceActive = state.minPrice !== null || state.maxPrice !== null;

  function priceLabel(): string {
    const min = state.minPrice !== null ? `${formatPrice(Number(state.minPrice))}원` : null;
    const max = state.maxPrice !== null ? `${formatPrice(Number(state.maxPrice))}원` : null;
    if (min !== null && max !== null) return `가격: ${min} ~ ${max}`;
    if (min !== null) return `가격: ${min} 이상`;
    if (max !== null) return `가격: ${max} 이하`;
    return '가격';
  }

  return (
    <>
      <header className="hd">
        <div className="wrap hd-in">
          <a
            className="logo"
            href="/"
            aria-label="wish 홈"
            onClick={(event) => {
              event.preventDefault();
              navigate('/');
            }}
          >
            w<em>ish</em>
          </a>
          <form className="search" role="search" onSubmit={handleSearch}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            {/* Remounts on q change so an external navigation (추천 칩) is shown. */}
            <input
              key={state.q ?? ''}
              type="search"
              name="q"
              defaultValue={state.q ?? ''}
              placeholder="검색어를 입력하세요"
              aria-label="상품 검색"
            />
          </form>
          <div className="hd-act">
            {auth.status !== 'authenticated' && (
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => navigate('/login?returnTo=%2Fsearch')}
              >
                로그인
              </button>
            )}
            <button className="btn btn-primary" type="button" onClick={() => navigate('/sell')}>
              판매하기
            </button>
          </div>
        </div>
      </header>

      <main className="wrap search-main">
        <nav aria-label="카테고리">
          <div className="cats">
            <a
              className="chip"
              href="/search"
              aria-current={activeCategory === null ? 'true' : undefined}
              onClick={(event) => {
                event.preventDefault();
                updateParams({ category: null });
              }}
            >
              전체
            </a>
            {categories.map((category) => (
              <a
                className="chip"
                key={category.code}
                href={`/search?category=${encodeURIComponent(category.code)}`}
                aria-current={activeCategory === category.code ? 'true' : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  updateParams({ category: category.code });
                }}
              >
                {category.name}
              </a>
            ))}
          </div>
        </nav>

        <div className="filters" aria-label="필터">
          <PriceFilterChip
            active={priceActive}
            label={priceLabel()}
            open={openPopover === 'price'}
            initialMin={state.minPrice}
            initialMax={state.maxPrice}
            onToggle={() =>
              setOpenPopover((current) => (current === 'price' ? null : 'price'))
            }
            onApply={(min, max) => {
              setOpenPopover(null);
              updateParams({ min_price: min, max_price: max });
            }}
          />
          <button
            className={`f-chip${state.status !== null ? ' active' : ''}`}
            type="button"
            aria-pressed={state.status !== null}
            onClick={() => updateParams({ status: state.status === null ? 'ACTIVE' : null })}
          >
            {state.status === null ? '상태' : '상태: 판매중만'}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
          </button>
          <RegionFilterChip
            active={state.region !== null}
            label={state.region === null ? '지역' : `지역: ${state.region}`}
            open={openPopover === 'region'}
            initialRegion={state.region}
            onToggle={() =>
              setOpenPopover((current) => (current === 'region' ? null : 'region'))
            }
            onApply={(region) => {
              setOpenPopover(null);
              updateParams({ region });
            }}
          />
        </div>

        <div className="result-bar">
          <span className="count">
            상품 <strong>{page?.total ?? 0}</strong>건
          </span>
          <button className="sort" type="button" onClick={handleSortSwitch}>
            {SORT_LABELS[state.sort]}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M7 4v14M7 4 4 7m3-3 3 3M17 20V6m0 14 3-3m-3 3-3-3" /></svg>
          </button>
        </div>

        {phase === 'loading' && <FeedSkeleton />}

        {phase === 'ready' && page !== null && page.items.length === 0 && (
          <EmptyResults />
        )}

        {phase === 'ready' && page !== null && page.items.length > 0 && (
          <div className="grid" aria-label="검색 결과">
            {page.items.map((product) => (
              <ProductCardLink
                key={product.id}
                product={product}
                onFavoriteError={setFavoriteError}
              />
            ))}
          </div>
        )}
      </main>

      {phase === 'error' && errorMessage !== null && (
        <div className="toast" role="alert">
          <span>{errorMessage}</span>
          {/* §3 search row: 재시도 keeps the filters — the URL state is intact. */}
          <button className="toast-retry" type="button" onClick={() => { void load(); }}>
            재시도
          </button>
        </div>
      )}

      {favoriteError !== null && (
        <div className="toast" role="alert">
          <span>{favoriteError}</span>
          <button className="toast-retry" type="button" onClick={() => setFavoriteError(null)}>
            확인
          </button>
        </div>
      )}

      <FooterNav active="/search" />
    </>
  );
}

/** AC2.4: the empty-result composer — 문구 + 보조 안내 + 추천 칩 + 목록 복귀. */
function EmptyResults(): ReactElement {
  return (
    <div className="empty">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
        <path d="M8.5 11h5" />
      </svg>
      <p className="empty-title">검색 결과가 없어요.</p>
      <p className="empty-hint">다른 검색어로 찾아보거나, 필터를 바꿔 보세요.</p>
      <div className="empty-chips">
        {RECOMMENDED_KEYWORDS.map((keyword) => (
          <button
            className="chip"
            key={keyword}
            type="button"
            onClick={() =>
              updateParams({
                q: keyword,
                category: null,
                min_price: null,
                max_price: null,
                status: null,
                region: null,
              })
            }
          >
            {keyword}
          </button>
        ))}
      </div>
      <button className="empty-back" type="button" onClick={() => navigate('/')}>
        목록으로 돌아가기
      </button>
    </div>
  );
}

/** Shared shell of the 가격/지역 popovers (design §5 필터 칩 dropdown posture). */
function FilterPopover({
  chipLabel,
  chipActive,
  open,
  onToggle,
  children,
}: {
  chipLabel: string;
  chipActive: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="f-chip-wrap">
      <button
        className={`f-chip${chipActive ? ' active' : ''}`}
        type="button"
        aria-expanded={open}
        onClick={onToggle}
      >
        {chipLabel}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && <div className="f-pop">{children}</div>}
    </div>
  );
}

function PriceFilterChip({
  active,
  label,
  open,
  initialMin,
  initialMax,
  onToggle,
  onApply,
}: {
  active: boolean;
  label: string;
  open: boolean;
  initialMin: string | null;
  initialMax: string | null;
  onToggle: () => void;
  onApply: (min: string | null, max: string | null) => void;
}): ReactElement {
  const [min, setMin] = useState(initialMin ?? '');
  const [max, setMax] = useState(initialMax ?? '');
  const [error, setError] = useState<string | null>(null);

  function apply(): void {
    const nextMin = min.trim();
    const nextMax = max.trim();
    if (!PRICE_PATTERN.test(nextMin) || !PRICE_PATTERN.test(nextMax)) {
      setError('가격을 숫자로 입력해 주세요.');
      return;
    }
    if (
      nextMin.length > 0 &&
      nextMax.length > 0 &&
      Number(nextMin) > Number(nextMax)
    ) {
      setError('최소 가격이 최대 가격보다 클 수 없어요.');
      return;
    }
    setError(null);
    onApply(nextMin.length === 0 ? null : nextMin, nextMax.length === 0 ? null : nextMax);
  }

  return (
    <FilterPopover chipLabel={label} chipActive={active} open={open} onToggle={onToggle}>
      <label className="f-label" htmlFor="price-min">최소 금액</label>
      <input
        id="price-min"
        className="f-input"
        inputMode="numeric"
        value={min}
        onChange={(event) => {
          setMin(event.target.value);
          setError(null);
        }}
      />
      <label className="f-label" htmlFor="price-max">최대 금액</label>
      <input
        id="price-max"
        className="f-input"
        inputMode="numeric"
        value={max}
        onChange={(event) => {
          setMax(event.target.value);
          setError(null);
        }}
      />
      {error !== null && <p className="f-error" role="alert">{error}</p>}
      <div className="f-actions">
        <button
          className="f-reset"
          type="button"
          onClick={() => {
            setMin('');
            setMax('');
            setError(null);
            onApply(null, null);
          }}
        >
          초기화
        </button>
        <button className="button-primary f-apply" type="button" onClick={apply}>
          적용
        </button>
      </div>
    </FilterPopover>
  );
}

function RegionFilterChip({
  active,
  label,
  open,
  initialRegion,
  onToggle,
  onApply,
}: {
  active: boolean;
  label: string;
  open: boolean;
  initialRegion: string | null;
  onToggle: () => void;
  onApply: (region: string | null) => void;
}): ReactElement {
  const [region, setRegion] = useState(initialRegion ?? '');

  function apply(): void {
    const next = region.trim();
    onApply(next.length === 0 ? null : next);
  }

  return (
    <FilterPopover chipLabel={label} chipActive={active} open={open} onToggle={onToggle}>
      <label className="f-label" htmlFor="region-input">지역</label>
      <input
        id="region-input"
        className="f-input"
        value={region}
        onChange={(event) => setRegion(event.target.value)}
      />
      <div className="f-actions">
        <button
          className="f-reset"
          type="button"
          onClick={() => {
            setRegion('');
            onApply(null);
          }}
        >
          초기화
        </button>
        <button className="button-primary f-apply" type="button" onClick={apply}>
          적용
        </button>
      </div>
    </FilterPopover>
  );
}
