/**
 * home-v1 — the public home feed (journey A1~A2, card C3).
 *
 * Visual source: design/t_8db2c17c/wish-home-v1.html, rendered with
 * design-system-v1 tokens only. Recorded intentional differences from the
 * static HTML (same posture as sell-v1's 거래 방식 omission):
 * - 인기 검색어 row and "전체 보기" link omitted: they render the design's
 *   own sample data ("디자인 예시 화면 · 샘플 데이터") and no popularity or
 *   search contract exists in v1 — fabricating them would be fake UI. The
 *   인기 검색어 칩 reappears where the contract does place it: the search
 *   empty state (AC2.4, card C4).
 * - category chips are the server's fixed five-category list (§2-2, the
 *   same source the sell form uses), not the design mock's 유아동/도서
 *   entries that no contract backs.
 * - 검색바 and category chips navigate to /search (§2-3 query destination,
 *   A3/A4). That screen's rendering is card C4; until then the route falls
 *   through to the placeholder landing — the URL is already the contract
 *   destination, same as sell → detail in C2.
 * - product cards link to /products/{id} (A6 destination); detail-v1 is
 *   card C5.
 *
 * Contract behavior (§3 상태 매트릭스, home-v1 row):
 * - loading → card skeleton (--surface-2, shimmer) first, data after (A2,
 *   AC2.5); no spinner is introduced.
 * - 0 products → empty-state composer "아직 상품이 없어요" + 판매 CTA
 *   (AC1.2); the CTA goes to /sell, whose guest redirect performs the
 *   로그인 유도 (AC4.1) on the way.
 * - network failure / 5xx → error toast + 재시도 re-requesting the list
 *   (§3 standard branch).
 * - status badges: 판매중 outline green / 예약중 amber fill / 거래완료
 *   grey fill with the dimmed card (AC1.4, design §5).
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { ApiError, NETWORK_ERROR_MESSAGE, request } from '../lib/api';
import type { AuthState } from '../lib/auth';
import { navigate } from '../lib/router';
import { formatPrice, formatRelativeTime } from '../lib/time';
import { FavoriteButton } from './favorite-button';

/** The §2-4 ProductCard shape (server-projected). Shared with search-v1 (C4). */
export interface ProductCard {
  readonly id: string;
  readonly title: string;
  readonly price: number;
  readonly region: string;
  readonly status: string;
  readonly created_at: string;
  readonly thumbnail_url: string | null;
  readonly condition: string;
}

interface CategoryView {
  readonly code: string;
  readonly name: string;
  readonly display_order: number;
}

/** The §2-0 page envelope. Shared with search-v1 (C4). */
export interface ListPage {
  readonly items: readonly ProductCard[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}

/** The feed requests exactly the A1 contract query: first page, 24, latest. */
const FEED_QUERY = '/api/products?page=1&limit=24&sort=latest';

/** The §2-0 status enum ↔ badge vocabulary (design §5, AC1.4). */
export const STATUS_BADGES: Record<string, { readonly label: string; readonly className: string }> = {
  ACTIVE: { label: '판매중', className: 'badge-sale' },
  RESERVED: { label: '예약중', className: 'badge-reserved' },
  SOLD: { label: '거래완료', className: 'badge-done' },
};

export function HomePage({ auth }: { auth: AuthState }): ReactElement {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [page, setPage] = useState<ListPage | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [favoriteError, setFavoriteError] = useState<string | null>(null);
  const [categories, setCategories] = useState<readonly CategoryView[]>([]);

  const load = useCallback(async (): Promise<void> => {
    setPhase('loading');
    setErrorMessage(null);
    try {
      const { body } = await request<ListPage>(FEED_QUERY);
      setPage(body);
      setPhase('ready');
    } catch (error) {
      setErrorMessage(
        error instanceof ApiError ? error.message : NETWORK_ERROR_MESSAGE,
      );
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Category chips are a secondary entry (A4); their failure must not take
  // the feed down, so a failed load simply leaves 전체 alone on the rail.
  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const { body } = await request<readonly CategoryView[]>('/api/categories');
        if (!cancelled) setCategories(body);
      } catch {
        // silent: the chips are an entry aid, not feed state (§3 home row).
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
    // A3: an empty keyword is a no-op, not an error — the home list stays.
    if (keyword.length === 0) return;
    navigate(`/search?q=${encodeURIComponent(keyword)}`);
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
            <input type="search" name="q" placeholder="검색어를 입력하세요" aria-label="상품 검색" />
          </form>
          <div className="hd-act">
            {auth.status !== 'authenticated' && (
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => navigate('/login?returnTo=%2F')}
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

      <main className="wrap home">
        <nav aria-label="카테고리">
          <div className="cats">
            <a
              className="chip"
              href="/search"
              aria-current="true"
              onClick={(event) => {
                event.preventDefault();
                navigate('/search');
              }}
            >
              전체
            </a>
            {categories.map((category) => (
              <a
                className="chip"
                key={category.code}
                href={`/search?category=${encodeURIComponent(category.code)}`}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(`/search?category=${encodeURIComponent(category.code)}`);
                }}
              >
                {category.name}
              </a>
            ))}
          </div>
        </nav>

        <section aria-labelledby="feed-title">
          <div className="sec-head">
            <h2 id="feed-title">오늘의 새로운 상품</h2>
          </div>

          {phase === 'loading' && <FeedSkeleton />}

          {phase === 'ready' && page !== null && page.items.length === 0 && <EmptyFeed />}

          {phase === 'ready' && page !== null && page.items.length > 0 && (
            <div className="grid">
              {page.items.map((product) => (
                <ProductCardLink
                  key={product.id}
                  product={product}
                  onFavoriteError={setFavoriteError}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      {phase === 'error' && errorMessage !== null && (
        <div className="toast" role="alert">
          <span>{errorMessage}</span>
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

      <FooterNav />
    </>
  );
}

/** Renders one §2-4 product card. Shared with search-v1 (C4) and my-v1 (C6). */
export function ProductCardLink({
  product,
  initiallyFavorited = false,
  onFavoriteError,
  onFavoriteChanged,
}: {
  product: ProductCard;
  /** my-v1's 찜 목록 renders rows that are favorited by definition. */
  initiallyFavorited?: boolean;
  onFavoriteError?: (message: string) => void;
  onFavoriteChanged?: (favorited: boolean) => void;
}): ReactElement {
  const badge = STATUS_BADGES[product.status] ?? null;
  return (
    <a
      className={`card${product.status === 'SOLD' ? ' done' : ''}`}
      href={`/products/${product.id}`}
      onClick={(event) => {
        event.preventDefault();
        navigate(`/products/${product.id}`);
      }}
    >
      <div className="thumb">
        {product.thumbnail_url !== null ? (
          <img className="thumb-img" src={product.thumbnail_url} alt="" loading="lazy" />
        ) : (
          <div
            className="thumb-placeholder"
            role="img"
            aria-label={`상품 이미지: ${product.title}`}
          >
            <span className="thumb-i">이미지</span>
          </div>
        )}
        {badge !== null && <span className={`badge ${badge.className}`}>{badge.label}</span>}
        {/* 카드 찜 아이콘 (card C6 최소 렌더, v1 토큰): the toggle lives on
            the card; tapping it does not navigate (AC6.1의 카드 확장). */}
        <span className="card-fav">
          <FavoriteButton
            productId={product.id}
            initiallyFavorited={initiallyFavorited}
            onError={onFavoriteError}
            onChanged={onFavoriteChanged}
          />
        </span>
      </div>
      <div className="card-body">
        <div className="price">{formatPrice(product.price)}원</div>
        <div className="title">{product.title}</div>
        <div className="meta">
          {product.region} · {formatRelativeTime(product.created_at)}
        </div>
      </div>
    </a>
  );
}

/** AC2.5: card-skeleton placeholders while the feed loads (no spinner). */
export function FeedSkeleton(): ReactElement {
  return (
    <div className="grid" aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => (
        <div className="card card-skeleton" key={index}>
          <div className="thumb skeleton-block" />
          <div className="card-body">
            <div className="skeleton-block skeleton-price" />
            <div className="skeleton-block skeleton-title" />
            <div className="skeleton-block skeleton-meta" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** AC1.2: the empty-state composer + 판매 유도 CTA. */
export function EmptyFeed(): ReactElement {
  return (
    <div className="empty">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="3" />
        <path d="m4 15 4.5-4.5a1.5 1.5 0 0 1 2.1 0L16 16" />
        <circle cx="15" cy="9" r="1.4" />
      </svg>
      <p className="empty-title">아직 상품이 없어요</p>
      <p className="empty-hint">첫 상품을 등록하면 이곳에 표시돼요</p>
      <button className="button-primary empty-cta" type="button" onClick={() => navigate('/sell')}>
        판매하러 가기
      </button>
    </div>
  );
}

/**
 * The 모바일 하단 탭바 (design §5, brief §7): 홈·검색·판매·마이 4탭 — the
 * 채팅 tab is intentionally not rendered (v1 비노출, §4a/§7). 마이 routes to
 * the placeholder landing until card C8 replaces it. `active` marks the
 * current tab (search-v1 passes '/search'); 홈 remains the default.
 */
export function FooterNav({ active = '/' }: { active?: string }): ReactElement {
  const current = (tab: string): 'true' | undefined =>
    tab === active ? 'true' : undefined;
  return (
    <nav className="tabbar" aria-label="주요 메뉴">
      <a
        href="/"
        aria-current={current('/')}
        onClick={(event) => {
          event.preventDefault();
          navigate('/');
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></svg>
        홈
      </a>
      <a
        href="/search"
        aria-current={current('/search')}
        onClick={(event) => {
          event.preventDefault();
          navigate('/search');
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        검색
      </a>
      <a className="tab-sell" href="/sell" aria-current={current('/sell')} onClick={(event) => { event.preventDefault(); navigate('/sell'); }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        판매
      </a>
      <a href="/my" aria-current={current('/my')} onClick={(event) => { event.preventDefault(); navigate('/my'); }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 5-5 8-5s6.5 1 8 5" /></svg>
        마이
      </a>
    </nav>
  );
}
