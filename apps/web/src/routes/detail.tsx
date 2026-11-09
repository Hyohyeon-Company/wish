/**
 * detail-v1 — the public product detail screen (journey A6, card C5,
 * AC3.1~3.3). Visual source: design/t_8db2c17c/wish-detail-v1.html, rendered
 * with design-system-v1 tokens only.
 *
 * Data binding is the §2-3 GET /api/products/{id} contract:
 * {product: {id, title, description, price, category_code, condition,
 * region, status, created_at, seller: {id, nickname, region},
 * images: [{url, sort_order}]}, favorited: bool | null}.
 *
 * Recorded intentional differences from the static design HTML (the same
 * posture as home-v1's sample-data omissions — fabricated UI is fake UI):
 * - 채팅하기 CTA (desktop .cta-row and mobile .m-cta) is NOT rendered —
 *   the v1 intentional difference, AC3.3 (§4a: 채팅은 v1 비노출).
 * - 가격 제안하기 and the 찜 토글 button are not rendered either: 가격 제안
 *   has no v1 contract, and the detail 찜 토글 is card C6's deliverable
 *   (AC3.3의 "찜은 표시된다"는 C6 관찰 대상 — favorited 데이터는 본 카드의
 *   API 계약에 이미 포함).
 * - 판매자 신뢰도/완료 거래/응답 통계, 조회·찜 counters, 브랜드/거래
 *   방식/신고 spec rows are the design mock's own sample data with no v1
 *   contract behind them — omitted.
 * - breadcrumbs: v1 categories are a single fixed level (§2-2); the design's
 *   two-level sample crumbs have no contract — omitted.
 * - 목록 복귀 target is the home feed (/): v1 records no origin-list
 *   contract (A6 enters from search OR home), and history.back() is empty
 *   on a direct/shared-link arrival.
 *
 * Contract behavior (§3 detail-v1 row):
 * - loading → skeleton (갤러리·텍스트) first; no spinner.
 * - 404 NOT_FOUND (존재하지 않음·삭제됨) → 404 화면: 만료 안내 + 목록 복귀
 *   (AC3.2). detail-v1 has no empty state — an empty detail IS the 404.
 * - network failure / 5xx → 오류 토스트 + 재시도 (§3 standard branch).
 * - public screen: a guest is NEVER login-redirected; the session token (if
 *   any) rides along so the server can personalize favorited — a stale
 *   token is observed as a guest by the server (OptionalCurrentMemberGuard).
 * - 상태 배지: 판매중/예약중/거래완료 vocabulary shared with the feed cards
 *   (design §5); AC7.3's seller-change reflection is C7's behavior.
 *
 * Card C6 adds the 찜 토글 (the design's 고정 CTA바, 관찰 §6): the desktop
 * .cta-row and the mobile fixed .m-cta both render the 찜 icon button —
 * 채팅하기 stays unrendered (AC3.3) and 가격 제안하기 has no v1 contract.
 * The toggle state comes from the §2-3 favorited field (null guest renders
 * the outline heart) and POST/DELETE /api/favorites flip it (AC6.1); a
 * guest's tap answers 401 and the session policy routes to the login screen
 * with a returnTo back to this detail (AC6.3, A7).
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { ApiError, NETWORK_ERROR_MESSAGE, request } from '../lib/api';
import { authStore } from '../lib/auth';
import { navigate } from '../lib/router';
import { formatPrice, formatRelativeTime } from '../lib/time';
import { STATUS_BADGES } from './home';
import { CONDITIONS } from './sell';
import { FavoriteIcon, useFavoriteToggle } from './favorite-button';

/** The §2-3 detail product shape (server-projected). */
export interface DetailProduct {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly price: number;
  readonly category_code: string;
  readonly condition: string;
  readonly region: string;
  readonly status: string;
  readonly created_at: string;
  readonly seller: { readonly id: string; readonly nickname: string; readonly region: string };
  readonly images: readonly { readonly url: string; readonly sort_order: number }[];
}

export interface DetailResponse {
  readonly product: DetailProduct;
  readonly favorited: boolean | null;
}

const CONDITION_LABELS = new Map(CONDITIONS.map((item) => [item.code, item.label]));

export function DetailPage({ productId }: { productId: string }): ReactElement {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'notfound' | 'error'>('loading');
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [favoriteError, setFavoriteError] = useState<string | null>(null);
  const [imageIndex, setImageIndex] = useState(0);

  const load = useCallback(async (): Promise<void> => {
    setPhase('loading');
    setErrorMessage(null);
    setImageIndex(0);
    try {
      const { body } = await request<DetailResponse>(
        `/api/products/${encodeURIComponent(productId)}`,
        {
          // favorited 개인화: 로그인 세션이 있으면 토큰을 함께 보낸다 (C6 토글의
          // 데이터 소스). 공개 화면이므로 401 분기는 여기 없다 — 만료 토큰은
          // 서버가 비로그인으로 관찰한다 (OptionalCurrentMemberGuard).
          token: authStore.getToken(),
          unauthorized: 'error',
        },
      );
      setDetail(body);
      setPhase('ready');
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setPhase('notfound');
        return;
      }
      setErrorMessage(
        error instanceof ApiError ? error.message : NETWORK_ERROR_MESSAGE,
      );
      setPhase('error');
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

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
          <a
            className="hd-back"
            href="/"
            onClick={(event) => {
              event.preventDefault();
              navigate('/');
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
            목록
          </a>
        </div>
      </header>

      {phase === 'loading' && <DetailSkeleton />}
      {phase === 'notfound' && <DetailNotFound />}
      {phase === 'ready' && detail !== null && (
        <DetailBody
          detail={detail}
          imageIndex={imageIndex}
          onSelectImage={setImageIndex}
          onFavoriteError={setFavoriteError}
        />
      )}

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
    </>
  );
}

function DetailBody({
  detail,
  imageIndex,
  onSelectImage,
  onFavoriteError,
}: {
  detail: DetailResponse;
  imageIndex: number;
  onSelectImage: (index: number) => void;
  onFavoriteError: (message: string) => void;
}): ReactElement {
  const { product } = detail;
  const badge = STATUS_BADGES[product.status] ?? null;
  const conditionLabel = CONDITION_LABELS.get(product.condition) ?? product.condition;
  const images = [...product.images].sort((a, b) => a.sort_order - b.sort_order);
  const current = images[imageIndex] ?? null;
  const favorite = useFavoriteToggle({
    productId: product.id,
    // favorited 반영 (AC6.1): the server's answer is the initial state —
    // a guest's null renders the outline heart.
    initiallyFavorited: detail.favorited === true,
    onError: onFavoriteError,
  });
  const favoriteIcon = (label: string): ReactElement => (
    <FavoriteIcon
      favorited={favorite.favorited}
      pending={favorite.pending}
      onToggle={() => { void favorite.toggle(); }}
      label={label}
    />
  );

  return (
    <>
      <main className="wrap detail">
      <section className="gal" aria-label="상품 이미지">
        <div
          className="gal-main"
          role="img"
          aria-label={`상품 이미지: ${product.title}`}
        >
          {current !== null ? (
            <img className="gal-img" src={current.url} alt="" />
          ) : (
            <span className="gal-i">이미지</span>
          )}
          {badge !== null && <span className={`badge ${badge.className} gal-badge`}>{badge.label}</span>}
        </div>
        {images.length > 1 && (
          <div className="gal-dots" aria-label="이미지 선택">
            {images.map((image, index) => (
              <button
                className="dot"
                key={image.sort_order}
                type="button"
                aria-current={index === imageIndex ? 'true' : undefined}
                aria-label={`${index + 1}번 이미지`}
                onClick={() => onSelectImage(index)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="info">
        <div className="d-badges">
          {badge !== null && <span className={`badge ${badge.className}`}>{badge.label}</span>}
          <span className="badge badge-cond">상품상태: {conditionLabel}</span>
        </div>
        <h1 className="d-title">{product.title}</h1>
        <p className="d-meta">
          {product.region} · {formatRelativeTime(product.created_at)}
        </p>

        <div className="d-price-row">
          <span className="d-price">{formatPrice(product.price)}원</span>
        </div>

        <p className="d-desc">{product.description}</p>

        <div className="d-seller">
          <div className="d-avatar" aria-hidden="true">
            {product.seller.nickname.charAt(0)}
          </div>
          <div>
            <div className="d-seller-name">{product.seller.nickname}</div>
            <div className="d-seller-loc">활동지역 {product.seller.region}</div>
          </div>
        </div>

        <div className="d-spec">
          <h2>상품 정보</h2>
          <table>
            <tbody>
              <tr>
                <td>상품상태</td>
                <td>{conditionLabel}</td>
              </tr>
              <tr>
                <td>거래지역</td>
                <td>{product.region}</td>
              </tr>
              <tr>
                <td>등록</td>
                <td>{formatRelativeTime(product.created_at)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="cta-row" role="group" aria-label="상품 액션">
          {favoriteIcon('찜하기')}
        </div>
      </section>
      </main>

      {/* 모바일 고정 CTA바 (design §6): the 찜 icon only — 채팅하기 is the
          AC3.3 intentional difference, 가격 제안 has no v1 contract. */}
      <div className="m-cta" role="group" aria-label="상품 액션">
        {favoriteIcon('찜하기')}
      </div>
    </>
  );
}

/** AC3.2: 존재하지 않음·삭제됨 — 만료 안내 + 목록 복귀 (§3 detail row). */
export function DetailNotFound(): ReactElement {
  return (
    <main className="wrap">
      <div className="empty">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="m9 15 6-6M9 9l6 6" />
        </svg>
        <p className="empty-title">상품을 찾을 수 없어요</p>
        <p className="empty-hint">삭제되었거나 만료된 상품이에요</p>
        <button className="button-primary empty-cta" type="button" onClick={() => navigate('/')}>
          목록으로 돌아가기
        </button>
      </div>
    </main>
  );
}

/** §3 detail row: skeleton (갤러리·텍스트) while the detail loads. */
export function DetailSkeleton(): ReactElement {
  return (
    <main className="wrap d-skeleton" aria-busy="true">
      <div className="skeleton-block d-skel-gal" />
      <div className="info" aria-hidden="true">
        <div className="skeleton-block d-skel-badge" />
        <div className="skeleton-block d-skel-title" />
        <div className="skeleton-block d-skel-price" />
        <div className="skeleton-block d-skel-line" />
        <div className="skeleton-block d-skel-line short" />
        <div className="skeleton-block d-skel-seller" />
      </div>
    </main>
  );
}
