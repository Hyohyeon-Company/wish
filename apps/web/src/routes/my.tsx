/**
 * my-v1 (최소) — the /my screen's 찜 section (journey A10, card C6, AC6.2),
 * with the session observation surface (AC5.1 logout) kept from the
 * placeholder landing. Card C8 completes my-v1 with the 내 등록 상품 section
 * and the status-change entries.
 *
 * Data binding is the §2-4 GET /api/favorites contract:
 * {items: [ProductCard 최신 찜순], total, page, limit}.
 *
 * Contract behavior (§3 my-v1 (찜) row):
 * - loading → skeleton first; no spinner.
 * - 0 favorites → empty-state composer "찜한 상품이 없어요" + 보조 안내 +
 *   둘러보기 CTA (the design's empty pattern, AC6.2의 빈 값 계열 토큰).
 * - network failure / 5xx → 오류 토스트 + 재시도 (§3 standard branch).
 * - 401 (만료 세션) → the session policy routes to the login screen with a
 *   returnTo back to /my (마이 is an authenticated destination, A10).
 * - 찜했던 상품이 삭제된 경우: the server's 사전 정리 (AC6.2) keeps it out
 *   of the list — the screen renders exactly what GET /api/favorites answers,
 *   no client-side filtering on top.
 * - unfavorite from the list: the heart toggle deletes the favorite and the
 *   list is re-requested, so the observed list stays the server's truth.
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { ApiError, NETWORK_ERROR_MESSAGE, request } from '../lib/api';
import { authStore, type MemberView } from '../lib/auth';
import { navigate } from '../lib/router';
import { formatPrice, formatRelativeTime } from '../lib/time';
import { ProductCardLink, STATUS_BADGES, type ListPage } from './home';
import { DeleteProductButton, StatusChangeActions } from './status-actions';

const FAVORITES_QUERY = '/api/favorites?page=1&limit=24';
const MY_PRODUCTS_QUERY = '/api/me/products?page=1&limit=24';

/** The §2-4 GET /api/me/products page envelope (ProductCard + status). */
type MyProductsPage = ListPage;

export function MyPage({ member }: { member: MemberView }): ReactElement {
  const [error, setError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [page, setPage] = useState<ListPage | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // 내 등록 상품 (C7, B9): its own load state so the 찜 section and the
  // 관리 section fail and retry independently.
  const [productsPhase, setProductsPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [products, setProducts] = useState<MyProductsPage | null>(null);
  const [productsError, setProductsError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setPhase('loading');
    setErrorMessage(null);
    try {
      const { body } = await request<ListPage>(FAVORITES_QUERY, {
        token: authStore.getToken(),
      });
      setPage(body);
      setPhase('ready');
    } catch (caught) {
      // A 401 here was already handled by the session policy: the session is
      // cleared and the login screen (returnTo=/my) is taking over.
      if (caught instanceof ApiError && caught.status === 401) return;
      setErrorMessage(
        caught instanceof ApiError ? caught.message : NETWORK_ERROR_MESSAGE,
      );
      setPhase('error');
    }
  }, []);

  const loadProducts = useCallback(async (): Promise<void> => {
    setProductsPhase('loading');
    setProductsError(null);
    try {
      const { body } = await request<MyProductsPage>(MY_PRODUCTS_QUERY, {
        token: authStore.getToken(),
      });
      // A bodyless success (204) must not crash the screen — render an
      // empty page; the §2-4 contract itself always carries the envelope.
      setProducts(
        body ?? { items: [], total: 0, page: 1, limit: 24 },
      );
      setProductsPhase('ready');
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) return;
      setProductsError(
        caught instanceof ApiError ? caught.message : NETWORK_ERROR_MESSAGE,
      );
      setProductsPhase('error');
    }
  }, []);

  useEffect(() => {
    void load();
    void loadProducts();
  }, [load, loadProducts]);

  async function handleLogout(): Promise<void> {
    setError(null);
    setLoggingOut(true);
    try {
      await authStore.logout();
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '서버에 문제가 발생했어요.');
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <main className="my">
      <section className="landing-sheet" aria-labelledby="landing-greeting">
        <p className="auth-wordmark">wish</p>
        <h1 className="landing-greeting" id="landing-greeting">
          {member.nickname}님, 환영해요
        </h1>
        <p className="landing-meta">{member.email} · {member.region}</p>
        {error !== null && (
          <p className="auth-form-error" role="alert">{error}</p>
        )}
        <button
          className="button-primary"
          type="button"
          disabled={loggingOut}
          onClick={() => { void handleLogout(); }}
        >
          {loggingOut ? '로그아웃 중…' : '로그아웃'}
        </button>
      </section>

      {/* 내 등록 상품 (C7, B9~B12): 상태 배지 + 상태 변경 입구 + 삭제 버튼.
          The rows are the §2-4 me/products page — the server's truth; a
          status change or deletion re-requests the list. */}
      <section className="my-products" aria-labelledby="my-products-title">
        <div className="sec-head">
          <h2 id="my-products-title">내 등록 상품</h2>
        </div>

        {productsPhase === 'loading' && <FavoritesSkeleton />}

        {productsPhase === 'ready' && products !== null && products.items.length === 0 && (
          <div className="empty">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <rect x="4" y="4" width="16" height="16" rx="3" />
              <path d="m4 15 4.5-4.5a1.5 1.5 0 0 1 2.1 0L16 16" />
              <circle cx="15" cy="9" r="1.4" />
            </svg>
            <p className="empty-title">등록한 상품이 없어요</p>
            <p className="empty-hint">첫 상품을 등록하면 이곳에서 관리할 수 있어요</p>
            <button className="button-primary empty-cta" type="button" onClick={() => navigate('/sell')}>
              판매하러 가기
            </button>
          </div>
        )}

        {productsPhase === 'ready' && products !== null && products.items.length > 0 && (
          <ul className="my-product-list" aria-label="내가 등록한 상품">
            {products.items.map((product) => (
              <MyProductRow
                key={product.id}
                product={product}
                onChanged={() => void loadProducts()}
                onDeleted={() => void loadProducts()}
                onError={setProductsError}
              />
            ))}
          </ul>
        )}

        {productsPhase === 'error' && productsError !== null && (
          <div className="toast" role="alert">
            <span>{productsError}</span>
            <button className="toast-retry" type="button" onClick={() => { void loadProducts(); }}>
              재시도
            </button>
          </div>
        )}
      </section>

      <section className="my-favs" aria-labelledby="my-favs-title">
        <div className="sec-head">
          <h2 id="my-favs-title">찜</h2>
        </div>

        {phase === 'loading' && <FavoritesSkeleton />}

        {phase === 'ready' && page !== null && page.items.length === 0 && <EmptyFavorites />}

        {phase === 'ready' && page !== null && page.items.length > 0 && (
          <div className="grid" aria-label="찜한 상품">
            {page.items.map((product) => (
              <ProductCardLink
                key={product.id}
                product={product}
                initiallyFavorited
                onFavoriteError={setErrorMessage}
                onFavoriteChanged={(favorited) => {
                  // 찜 해제 → the list is the server's truth: re-request it
                  // so the unfavorited row disappears (AC6.2 관찰).
                  if (!favorited) void load();
                }}
              />
            ))}
          </div>
        )}
      </section>

      {phase === 'error' && errorMessage !== null && (
        <div className="toast" role="alert">
          <span>{errorMessage}</span>
          <button className="toast-retry" type="button" onClick={() => { void load(); }}>
            재시도
          </button>
        </div>
      )}
    </main>
  );
}

/**
 * One 내 등록 상품 row (C7, B10/B12): the §2-4 ProductCard fields as a link
 * to the detail, its 상태 배지, the seller's 상태 변경 입구 and the
 * --danger 삭제 버튼. The row is NOT nested inside an <a> (buttons inside a
 * link are invalid HTML); the link and the actions are siblings.
 */
function MyProductRow({
  product,
  onChanged,
  onDeleted,
  onError,
}: {
  product: MyProductsPage['items'][number];
  onChanged: () => void;
  onDeleted: () => void;
  onError: (message: string) => void;
}): ReactElement {
  const [status, setStatus] = useState(product.status);
  const badge = STATUS_BADGES[status] ?? null;
  return (
    <li className="my-row">
      <a
        className={`my-row-link${status === 'SOLD' ? ' done' : ''}`}
        href={`/products/${product.id}`}
        onClick={(event) => {
          event.preventDefault();
          navigate(`/products/${product.id}`);
        }}
      >
        <div className="thumb my-row-thumb">
          {product.thumbnail_url !== null ? (
            <img className="thumb-img" src={product.thumbnail_url} alt="" loading="lazy" />
          ) : (
            <div className="thumb-placeholder" role="img" aria-label={`상품 이미지: ${product.title}`}>
              <span className="thumb-i">이미지</span>
            </div>
          )}
        </div>
        <div className="my-row-body">
          <div className="title">{product.title}</div>
          <div className="price">{formatPrice(product.price)}원</div>
          <div className="meta">
            {badge !== null && <span className={`badge ${badge.className}`}>{badge.label}</span>}
            {' '}
            {formatRelativeTime(product.created_at)}
          </div>
        </div>
      </a>
      <div className="my-row-actions">
        <StatusChangeActions
          productId={product.id}
          status={status}
          onChanged={(next) => {
            setStatus(next);
            onChanged();
          }}
          onError={onError}
        />
        <DeleteProductButton productId={product.id} onDeleted={onDeleted} onError={onError} />
      </div>
    </li>
  );
}

/** AC6.2의 빈 상태: "찜한 상품이 없어요" 계열 (design empty composer). */
export function EmptyFavorites(): ReactElement {
  return (
    <div className="empty">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path d="M12 21C7 16.5 3 13.2 3 9.3 3 6.4 5.2 4 8.1 4c1.6 0 3 .8 3.9 2 .9-1.2 2.3-2 3.9-2C18.8 4 21 6.4 21 9.3c0 3.9-4 7.2-9 11.7Z" />
      </svg>
      <p className="empty-title">찜한 상품이 없어요</p>
      <p className="empty-hint">마음에 드는 상품을 찜해 보세요</p>
      <button className="button-primary empty-cta" type="button" onClick={() => navigate('/')}>
        둘러보러 가기
      </button>
    </div>
  );
}

/** §3 my-v1 (찜) row: skeleton while the list loads. */
export function FavoritesSkeleton(): ReactElement {
  return (
    <div className="grid" aria-hidden="true">
      {Array.from({ length: 4 }, (_, index) => (
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
