/**
 * 찜 토글 (card C6, §2-4 찜 계약 · AC6.1~6.3).
 *
 * `useFavoriteToggle` owns the toggle state and the two §2-4 calls:
 * - POST /api/favorites {product_id} → 201 신규 / 200 이미 찜함(멱등) both
 *   mean "favorited"; the distinction is server-side bookkeeping, the UI
 *   observes the same filled heart for both;
 * - DELETE /api/favorites/{productId} → 204 (멱등).
 *
 * 401 is the 비로그인 boundary (AC6.3): the api client's default 'session'
 * policy clears the local session and routes to /login with a returnTo
 * reference to the current screen, so a guest's tap lands on the login
 * screen and comes back to the same detail after signing in (A7). The hook
 * therefore treats a 401 as "handled by the session policy" — no toast, the
 * navigation is the observable behavior.
 *
 * A network failure or 5xx during a toggle is reported through `onError`
 * (the §3 standard 오류 토스트 branch, owned by the screen that embeds the
 * control) and the heart keeps its previous state — an unobserved failure
 * must not fake a state change.
 */
import { useCallback, useState, type ReactElement } from 'react';
import { ApiError, request } from '../lib/api';
import { authStore } from '../lib/auth';

/** The design's 찜 heart (wish-detail-v1.html), outline → fill on toggle. */
export const HEART_PATH =
  'M12 21C7 16.5 3 13.2 3 9.3 3 6.4 5.2 4 8.1 4c1.6 0 3 .8 3.9 2 .9-1.2 2.3-2 3.9-2C18.8 4 21 6.4 21 9.3c0 3.9-4 7.2-9 11.7Z';

export interface FavoriteToggle {
  readonly favorited: boolean;
  readonly pending: boolean;
  /** Resolves to the new state, or null when the toggle did not land
   * (401 → the session policy is navigating; network/5xx → onError). */
  toggle: () => Promise<boolean | null>;
}

export function useFavoriteToggle(options: {
  productId: string;
  initiallyFavorited: boolean;
  onError?: (message: string) => void;
}): FavoriteToggle {
  const { productId, initiallyFavorited, onError } = options;
  const [favorited, setFavorited] = useState(initiallyFavorited);
  const [pending, setPending] = useState(false);

  const toggle = useCallback(async (): Promise<boolean | null> => {
    if (pending) return null; // double-tap guard: one request at a time (A9)
    setPending(true);
    try {
      if (favorited) {
        await request<void>(`/api/favorites/${encodeURIComponent(productId)}`, {
          method: 'DELETE',
          token: authStore.getToken(),
          // A stale session on a state-changing call IS a 비로그인 boundary:
          // the 'session' policy clears and redirects with returnTo.
          unauthorized: 'session',
        });
        setFavorited(false);
        return false;
      }
      await request<{ favorited: boolean }>('/api/favorites', {
        method: 'POST',
        body: { product_id: productId },
        token: authStore.getToken(),
        unauthorized: 'session',
      });
      setFavorited(true);
      return true;
    } catch (error) {
      // 401 was already handled by the session policy (로그인 유도 + 복귀).
      if (!(error instanceof ApiError && error.status === 401)) {
        onError?.(error instanceof ApiError ? error.message : '찜 처리에 실패했어요.');
      }
      return null;
    } finally {
      setPending(false);
    }
  }, [favorited, onError, pending, productId]);

  return { favorited, pending, toggle };
}

/**
 * Self-contained 찜 button for product cards (home · search · my): owns its
 * toggle state and reports the landed result through `onChanged` so the my
 * 찜 목록 can drop an unfavorited row (AC6.2's 목록 부재 관찰).
 */
export function FavoriteButton({
  productId,
  initiallyFavorited = false,
  onError,
  onChanged,
}: {
  productId: string;
  initiallyFavorited?: boolean;
  onError?: (message: string) => void;
  onChanged?: (favorited: boolean) => void;
}): ReactElement {
  const favorite = useFavoriteToggle({ productId, initiallyFavorited, onError });
  return (
    <FavoriteIcon
      favorited={favorite.favorited}
      pending={favorite.pending}
      onToggle={() => {
        void favorite.toggle().then((landed) => {
          if (landed !== null) onChanged?.(landed);
        });
      }}
    />
  );
}

/** The 찜 icon button itself (desktop cta-row, mobile m-cta, card overlay). */
export function FavoriteIcon({
  favorited,
  pending,
  onToggle,
  label = '찜하기',
}: {
  favorited: boolean;
  pending: boolean;
  onToggle: () => void;
  label?: string;
}): ReactElement {
  return (
    <button
      className={`btn btn-icon fav-btn${favorited ? ' on' : ''}`}
      type="button"
      aria-pressed={favorited}
      aria-label={label}
      disabled={pending}
      onClick={(event) => {
        // Inside a product card link: the toggle is not a navigation.
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d={HEART_PATH}
          fill={favorited ? 'var(--brand)' : 'none'}
          stroke="currentColor"
          strokeWidth="2"
        />
      </svg>
    </button>
  );
}
