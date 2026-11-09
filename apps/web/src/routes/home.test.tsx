/**
 * home-v1 screen behavior (card C3, AC1.1~1.4 · AC2.5 · §3 standard branches):
 * - the feed is public: a guest at / sees the feed, never a login redirect;
 * - cards render image-or-placeholder, price (천단위 콤마+원), title, meta
 *   (지역 · 상대시간) and the three status badges (AC1.1, AC1.4);
 * - loading shows the card skeleton first (AC2.5), data after (A2);
 * - 0 products → empty composer + 판매 CTA (AC1.2);
 * - network failure / 5xx → error toast + 재시도 that re-requests (§3);
 * - a card click navigates to /products/{id}; search/chips navigate to
 *   /search with their contract query; the empty keyword is a no-op (A3).
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../app';
import { authStore } from '../lib/auth';
import { setUnauthorizedHandler } from '../lib/api';

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const CATEGORIES = [
  { code: 'furniture', name: '가구/인테리어', display_order: 1 },
  { code: 'digital', name: '디지털', display_order: 2 },
];

/** created_at values observed through the fixed test clock of formatRelativeTime. */
function card(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'p-1',
    title: '아이패드 에어 5세대 64기가',
    price: 580000,
    region: '사당동',
    status: 'ACTIVE',
    created_at: new Date(Date.now() - 3 * 60 * 1000).toISOString(), // 3분 전
    thumbnail_url: 'http://localhost:3000/uploads/p-1.png',
    condition: 'like_new',
    ...overrides,
  };
}

function feedUrl(url: string): boolean {
  return url.startsWith('/api/products?');
}

beforeEach(async () => {
  authStore.resetForTests();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
  await authStore.boot();
});

afterEach(() => {
  setUnauthorizedHandler(null);
  vi.restoreAllMocks();
});

describe('home feed access (AC1.1)', () => {
  it('renders the public feed for a guest — no login redirect at /', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (feedUrl(url)) {
        return jsonResponse(200, { items: [card()], total: 1, page: 1, limit: 24 });
      }
      if (url.endsWith('/api/categories')) return jsonResponse(200, CATEGORIES);
      return jsonResponse(500, { code: 'INTERNAL', message: 'unexpected' });
    });
    vi.stubGlobal('fetch', fetchImpl);
    render(<App />);
    expect(await screen.findByText('오늘의 새로운 상품')).toBeTruthy();
    expect(await screen.findByText('아이패드 에어 5세대 64기가')).toBeTruthy();
    expect(window.location.pathname).toBe('/');
  });

  it('hides the header 로그인 button for an authenticated member', async () => {
    authStore.applySession({
      member: {
        id: 'm-1',
        email: 'seller@example.com',
        nickname: '판매자',
        region: '사당동',
        created_at: '2026-11-08T00:00:00.000Z',
      },
      token: 'tok-1',
    });
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (feedUrl(url)) return jsonResponse(200, { items: [], total: 0, page: 1, limit: 24 });
      if (url.endsWith('/api/categories')) return jsonResponse(200, CATEGORIES);
      return jsonResponse(500, { code: 'INTERNAL', message: 'unexpected' });
    });
    vi.stubGlobal('fetch', fetchImpl);
    render(<App />);
    await screen.findByText('오늘의 새로운 상품');
    expect(screen.queryByRole('button', { name: '로그인' })).toBeNull();
    expect(screen.getByRole('button', { name: '판매하기' })).toBeTruthy();
  });
});

describe('product card rendering (AC1.1, AC1.4)', () => {
  const CARDS = [
    card({ id: 'p-active', title: '아이패드 에어 5세대 64기가', price: 580000, region: '사당동', status: 'ACTIVE' }),
    card({ id: 'p-reserved', title: '원목 식탁 4인용', price: 120000, region: '상도동', status: 'RESERVED' }),
    card({ id: 'p-sold', title: '닌텐도 스위치 라이트', price: 185000, region: '신대방동', status: 'SOLD' }),
    card({ id: 'p-noimg', title: '플레이스홀더 상품', price: 45000, region: '대방동', thumbnail_url: null }),
  ];

  function renderFeed(): void {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (feedUrl(url)) {
        return jsonResponse(200, { items: CARDS, total: 4, page: 1, limit: 24 });
      }
      if (url === '/api/products/p-active') {
        return jsonResponse(200, {
          product: {
            id: 'p-active',
            title: '아이패드 에어 5세대 64기가',
            description: '설명',
            price: 580000,
            category_code: 'digital',
            condition: 'like_new',
            region: '사당동',
            status: 'ACTIVE',
            created_at: new Date().toISOString(),
            seller: { id: 'm-1', nickname: '판매자', region: '사당동' },
            images: [{ url: 'http://localhost:3000/uploads/a.png', sort_order: 1 }],
          },
          favorited: null,
        });
      }
      if (url.endsWith('/api/categories')) return jsonResponse(200, CATEGORIES);
      return jsonResponse(500, { code: 'INTERNAL', message: 'unexpected' });
    });
    vi.stubGlobal('fetch', fetchImpl);
    render(<App />);
  }

  it('renders price with the thousand-grouped 원 notation (AC1.1)', async () => {
    renderFeed();
    expect(await screen.findByText('580,000원')).toBeTruthy();
    expect(screen.getByText('120,000원')).toBeTruthy();
  });

  it('renders region · relative-time meta (AC1.1)', async () => {
    renderFeed();
    const meta = await screen.findByText(/^사당동 · /);
    expect(meta.textContent).toMatch(/^사당동 · (방금 전|\d+분 전)$/);
    expect(screen.getByText(/^상도동 · /)).toBeTruthy();
  });

  it('renders all three status badges with their design classes (AC1.4)', async () => {
    renderFeed();
    await screen.findByText('580,000원');
    expect(screen.getAllByText('판매중')[0]?.className).toBe('badge badge-sale');
    expect(screen.getByText('예약중').className).toBe('badge badge-reserved');
    expect(screen.getByText('거래완료').className).toBe('badge badge-done');
    // 거래완료 dims its card (design .card.done).
    const soldCard = screen.getByText('닌텐도 스위치 라이트').closest('a');
    expect(soldCard?.className).toContain('done');
  });

  it('shows the image thumbnail when present and the aria-labelled placeholder when not', async () => {
    renderFeed();
    await screen.findByText('580,000원');
    const img = document.querySelector('img.thumb-img');
    expect(img?.getAttribute('src')).toBe('http://localhost:3000/uploads/p-1.png');
    const placeholder = screen.getByRole('img', { name: '상품 이미지: 플레이스홀더 상품' });
    expect(placeholder.className).toBe('thumb-placeholder');
  });

  it('navigates on card click to the real detail screen (A6, C5)', async () => {
    const user = userEvent.setup();
    renderFeed();
    const cardLink = await screen.findByRole('link', { name: /아이패드 에어 5세대 64기가/ });
    await user.click(cardLink);
    // Since C5 the §3-공개 destination renders detail-v1 at /products/{id};
    // the stub serves its body so the bound screen is observed, not a
    // redirect. (The pre-C5 placeholder posture returned to the feed.)
    await waitFor(() => {
      expect(window.location.pathname).toBe('/products/p-active');
    });
  });
});

describe('loading skeleton (AC2.5)', () => {
  it('shows skeleton placeholders while the request is in flight, then data', async () => {
    const pending: { resolve: ((response: Response) => void) | null } = { resolve: null };
    const fetchImpl = vi.fn(
      (input: string | URL | Request) =>
        new Promise<Response>((resolve) => {
          if (feedUrl(String(input))) {
            pending.resolve = resolve; // hold the FEED response until the test releases it
          } else {
            resolve(jsonResponse(200, []));
          }
        }),
    );
    vi.stubGlobal('fetch', fetchImpl);
    render(<App />);
    await waitFor(() => {
      expect(document.querySelectorAll('.card-skeleton').length).toBeGreaterThan(0);
    });
    pending.resolve?.(
      jsonResponse(200, { items: [card()], total: 1, page: 1, limit: 24 }),
    );
    expect(await screen.findByText('아이패드 에어 5세대 64기가')).toBeTruthy();
    expect(document.querySelectorAll('.card-skeleton')).toHaveLength(0);
  });
});

describe('empty feed (AC1.2)', () => {
  it('shows the empty composer with the 판매 CTA, which routes to /sell', async () => {
    const user = userEvent.setup();
    authStore.applySession({
      member: {
        id: 'm-1',
        email: 'seller@example.com',
        nickname: '판매자',
        region: '사당동',
        created_at: '2026-11-08T00:00:00.000Z',
      },
      token: 'tok-1',
    });
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (feedUrl(url)) return jsonResponse(200, { items: [], total: 0, page: 1, limit: 24 });
      if (url.endsWith('/api/categories')) return jsonResponse(200, CATEGORIES);
      return jsonResponse(500, { code: 'INTERNAL', message: 'unexpected' });
    });
    vi.stubGlobal('fetch', fetchImpl);
    render(<App />);
    expect(await screen.findByText('아직 상품이 없어요')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '판매하러 가기' }));
    await waitFor(() => {
      expect(window.location.pathname).toBe('/sell');
    });
    expect(screen.getByText('판매 등록')).toBeTruthy();
  });
});

describe('error toast + retry (§3 home row)', () => {
  it('shows the network-failure toast with a retry button after a failed request', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchImpl);
    render(<App />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('네트워크 연결을 확인해 주세요.');
    expect(screen.getByRole('button', { name: '재시도' })).toBeTruthy();
  });

  it('shows the server contract message on a 5xx and recovers on retry', async () => {
    const user = userEvent.setup();
    let failing = true;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (feedUrl(url)) {
        if (failing) {
          return jsonResponse(500, { code: 'INTERNAL', message: '서버에 문제가 발생했어요.' });
        }
        return jsonResponse(200, { items: [card()], total: 1, page: 1, limit: 24 });
      }
      if (url.endsWith('/api/categories')) return jsonResponse(200, CATEGORIES);
      return jsonResponse(500, { code: 'INTERNAL', message: 'unexpected' });
    });
    vi.stubGlobal('fetch', fetchImpl);
    render(<App />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('서버에 문제가 발생했어요.');

    failing = false;
    await user.click(screen.getByRole('button', { name: '재시도' }));
    expect(await screen.findByText('아이패드 에어 5세대 64기가')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('entries to /search (A3/A4 destinations)', () => {
  function renderFeedWithSpy(): ReturnType<typeof vi.fn> {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (feedUrl(url)) return jsonResponse(200, { items: [], total: 0, page: 1, limit: 24 });
      if (url.endsWith('/api/categories')) return jsonResponse(200, CATEGORIES);
      return jsonResponse(500, { code: 'INTERNAL', message: 'unexpected' });
    });
    vi.stubGlobal('fetch', fetchImpl);
    render(<App />);
    return fetchImpl;
  }

  it('submits a keyword to /search?q=… and search-v1 renders there (C4)', async () => {
    const user = userEvent.setup();
    renderFeedWithSpy();
    await screen.findByText('아직 상품이 없어요');
    await user.type(screen.getByLabelText('상품 검색'), '아이패드');
    await user.keyboard('{Enter}');
    // The §2-3 query destination is /search (A3); search-v1 renders there
    // since C4. The mock's empty result shows the AC2.4 empty composer.
    await waitFor(() => {
      expect(window.location.pathname).toBe('/search');
      expect(window.location.search).toBe(`?q=${encodeURIComponent('아이패드')}`);
    });
    expect(await screen.findByText('검색 결과가 없어요.')).toBeTruthy();
  });

  it('treats an empty keyword as a no-op, not an error (A3)', async () => {
    const user = userEvent.setup();
    renderFeedWithSpy();
    await screen.findByText('아직 상품이 없어요');
    const input = screen.getByLabelText('상품 검색');
    await user.click(input);
    await user.keyboard('{Enter}');
    expect(window.location.pathname).toBe('/');
  });

  it('navigates a category chip to /search?category=… (A4 destination)', async () => {
    const user = userEvent.setup();
    renderFeedWithSpy();
    await screen.findByText('아직 상품이 없어요');
    await user.click(screen.getByRole('link', { name: '디지털' }));
    await waitFor(() => {
      expect(window.location.pathname).toBe('/search');
      expect(window.location.search).toBe('?category=digital');
    });
    // C4 renders search-v1: the chip is marked selected there.
    expect(
      await screen.findByRole('link', { name: '디지털' }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: '디지털' }).getAttribute('aria-current')).toBe('true');
  });
});
