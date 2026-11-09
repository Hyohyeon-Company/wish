/**
 * search-v1 screen behavior (card C4, AC2.1~2.5 · §3 search row):
 * - the screen is public: a guest at /search sees results, never a login
 *   redirect (§3 search row);
 * - the URL query IS the filter state: q/category/status/min_price/max_price/
 *   region/sort each map 1:1 onto the §2-3 GET request (AC2.1/2.2);
 * - the sort control cycles 최신순 → 가격 낮은순 → 가격 높은순 and the
 *   rendered order follows the server's response (AC2.3);
 * - 결과 수 "N건" shows in every ready state, 0건 포함 (§3);
 * - 0건 → empty composer + 추천 검색어 칩 + 목록 복귀 (AC2.4);
 * - loading → skeleton first (AC2.5); failure → toast + 재시도 with the
 *   filters preserved (§3 search row);
 * - submitting an empty keyword removes the q filter, no error (A3).
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

function card(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'p-1',
    title: '원목 책장 6단',
    price: 85000,
    region: '사당동',
    status: 'ACTIVE',
    created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    thumbnail_url: null,
    condition: 'like_new',
    ...overrides,
  };
}

/** Extracts the query of a /api/products?… call, null for other endpoints. */
function productQuery(url: string | URL | Request): URLSearchParams | null {
  const text = String(url);
  if (!text.startsWith('/api/products?')) return null;
  return new URLSearchParams(text.slice('/api/products?'.length));
}

const FETCHED: string[] = [];

/** Installs a fetch mock driven by a per-request callback. */
function stubFetch(handler: (query: URLSearchParams | null, url: string) => Response | Promise<Response>): void {
  FETCHED.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      FETCHED.push(url);
      const query = productQuery(url);
      if (url === '/api/categories') return jsonResponse(200, CATEGORIES);
      return handler(query, url);
    }),
  );
}

/** Most recent /api/products request — category loads and retries excluded. */
function lastProductUrl(): string {
  const url = [...FETCHED].reverse().find((candidate) => candidate.startsWith('/api/products?'));
  if (url === undefined) throw new Error('no product request was made');
  return url;
}

/** First /api/products request — the one fired by the initial render. */
function firstProductUrl(): string {
  const url = FETCHED.find((candidate) => candidate.startsWith('/api/products?'));
  if (url === undefined) throw new Error('no product request was made');
  return url;
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

function countText(): string {
  return document.querySelector('.count')?.textContent ?? '';
}

describe('public access + keyword binding (AC2.1, §3 search row)', () => {
  it('renders results for a guest at /search?q=… — no login redirect', async () => {
    window.history.replaceState(null, '', `/search?q=${encodeURIComponent('책장')}`);
    stubFetch((query) => {
      expect(query).not.toBeNull();
      return jsonResponse(200, {
        items: [card(), card({ id: 'p-2', title: '조립식 책장 4단', price: 30000 })],
        total: 2,
        page: 1,
        limit: 24,
      });
    });
    render(<App />);
    expect(await screen.findByText('원목 책장 6단')).toBeTruthy();
    expect(await screen.findByText('조립식 책장 4단')).toBeTruthy();
    expect(countText()).toBe('상품 2건');
    expect(window.location.pathname).toBe('/search');
  });

  it('sends the keyword as q and mirrors the URL state in the input', async () => {
    window.history.replaceState(null, '', `/search?q=${encodeURIComponent('책장')}`);
    stubFetch(() => jsonResponse(200, { items: [], total: 0, page: 1, limit: 24 }));
    render(<App />);
    await screen.findByText('검색 결과가 없어요.');
    const request = new URL(firstProductUrl(), window.location.origin);
    expect(request.searchParams.get('q')).toBe('책장');
    expect(request.searchParams.get('sort')).toBe('latest');
    expect(request.searchParams.get('page')).toBe('1');
    expect(request.searchParams.get('limit')).toBe('24');
    const input = screen.getByLabelText('상품 검색') as HTMLInputElement;
    expect(input.value).toBe('책장');
  });

  it('matches q case-insensitively end to end (AC2.1: 대소문자 무시)', async () => {
    window.history.replaceState(null, '', `/search?q=${encodeURIComponent('LEGO')}`);
    stubFetch((query) => {
      expect(query?.get('q')).toBe('LEGO');
      return jsonResponse(200, { items: [card({ title: 'LEGO 클래식 박스' })], total: 1, page: 1, limit: 24 });
    });
    render(<App />);
    expect(await screen.findByText('LEGO 클래식 박스')).toBeTruthy();
  });
});

describe('category chips (AC2.2, A4)', () => {
  it('marks the active chip, requests the category filter, and 전체 clears it', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/search?category=digital');
    stubFetch(() => jsonResponse(200, { items: [], total: 0, page: 1, limit: 24 }));
    render(<App />);
    await screen.findByText('검색 결과가 없어요.');
    expect(new URL(lastProductUrl(), window.location.origin).searchParams.get('category')).toBe('digital');
    expect(screen.getByRole('link', { name: '디지털' }).getAttribute('aria-current')).toBe('true');
    expect(screen.getByRole('link', { name: '전체' }).getAttribute('aria-current')).toBeNull();

    await user.click(screen.getByRole('link', { name: '전체' }));
    await waitFor(() => {
      expect(window.location.search).toBe('');
    });
    const last = new URL(lastProductUrl(), window.location.origin);
    expect(last.searchParams.get('category')).toBeNull();
  });

  it('combines q and category in one request (A3+A4)', async () => {
    window.history.replaceState(
      null,
      '',
      `/search?q=${encodeURIComponent('책장')}&category=furniture`,
    );
    stubFetch((query) => {
      expect(query?.get('q')).toBe('책장');
      expect(query?.get('category')).toBe('furniture');
      return jsonResponse(200, { items: [card()], total: 1, page: 1, limit: 24 });
    });
    render(<App />);
    expect(await screen.findByText('원목 책장 6단')).toBeTruthy();
    expect(countText()).toBe('상품 1건');
  });
});

describe('sort switch (AC2.3)', () => {
  const SORTED: Record<string, string[]> = {
    latest: ['책장 C', '책장 B', '책장 A'],
    price_asc: ['책장 B', '책장 C', '책장 A'],
    price_desc: ['책장 A', '책장 C', '책장 B'],
  };

  function renderSortedSearch(): void {
    stubFetch((query) => {
      const sort = query?.get('sort') ?? 'latest';
      const titles = SORTED[sort] ?? SORTED.latest ?? [];
      return jsonResponse(200, {
        items: titles.map((title, index) => card({ id: `p-${index}`, title })),
        total: 3,
        page: 1,
        limit: 24,
      });
    });
    window.history.replaceState(null, '', `/search?q=${encodeURIComponent('책장')}`);
    render(<App />);
  }

  it('cycles 최신순 → 가격 낮은순 → 가격 높은순 and the rendered order follows', async () => {
    const user = userEvent.setup();
    renderSortedSearch();
    expect(await screen.findByText('책장 C')).toBeTruthy();
    expect([...document.querySelectorAll('.grid .title')].map((el) => el.textContent)).toEqual(
      SORTED.latest,
    );

    await user.click(screen.getByRole('button', { name: /최신순/ }));
    expect(await screen.findByText('가격 낮은순')).toBeTruthy();
    expect([...document.querySelectorAll('.grid .title')].map((el) => el.textContent)).toEqual(
      SORTED.price_asc,
    );
    expect(new URL(lastProductUrl(), window.location.origin).searchParams.get('sort')).toBe('price_asc');

    await user.click(screen.getByRole('button', { name: /가격 낮은순/ }));
    expect(await screen.findByText('가격 높은순')).toBeTruthy();
    expect([...document.querySelectorAll('.grid .title')].map((el) => el.textContent)).toEqual(
      SORTED.price_desc,
    );
    // The keyword filter survives the sort switch (AC2.3 조합).
    expect(new URL(lastProductUrl(), window.location.origin).searchParams.get('q')).toBe('책장');
  });
});

describe('filter chips: 상태·가격·지역 (AC2.2)', () => {
  it('toggles the 판매중만 status filter on and off', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/search');
    stubFetch(() => jsonResponse(200, { items: [], total: 0, page: 1, limit: 24 }));
    render(<App />);
    await screen.findByText('검색 결과가 없어요.');

    await user.click(screen.getByRole('button', { name: /^상태$/ }));
    await waitFor(() => {
      expect(new URL(lastProductUrl(), window.location.origin).searchParams.get('status')).toBe('ACTIVE');
    });
    expect(screen.getByRole('button', { name: '상태: 판매중만' }).className).toContain('active');

    await user.click(screen.getByRole('button', { name: '상태: 판매중만' }));
    await waitFor(() => {
      expect(new URL(lastProductUrl(), window.location.origin).searchParams.get('status')).toBeNull();
    });
  });

  it('applies a price range from the 가격 popover and refuses a reversed range', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/search');
    stubFetch(() => jsonResponse(200, { items: [], total: 0, page: 1, limit: 24 }));
    render(<App />);
    await screen.findByText('검색 결과가 없어요.');

    await user.click(screen.getByRole('button', { name: '가격' }));
    await user.type(screen.getByLabelText('최소 금액'), '10000');
    await user.type(screen.getByLabelText('최대 금액'), '50000');
    await user.click(screen.getByRole('button', { name: '적용' }));

    const applied = new URL(lastProductUrl(), window.location.origin);
    expect(applied.searchParams.get('min_price')).toBe('10000');
    expect(applied.searchParams.get('max_price')).toBe('50000');
    expect(screen.getByRole('button', { name: /가격: 10,000원 ~ 50,000원/ }).className).toContain(
      'active',
    );

    // Reversed range: the client refuses with the contract message, no request.
    const callsBefore = FETCHED.length;
    await user.click(screen.getByRole('button', { name: /가격: 10,000원 ~ 50,000원/ }));
    await user.type(screen.getByLabelText('최소 금액'), '90000');
    await user.click(screen.getByRole('button', { name: '적용' }));
    expect(screen.getByRole('alert').textContent).toBe('최소 가격이 최대 가격보다 클 수 없어요.');
    expect(FETCHED.length).toBe(callsBefore);
  });

  it('resets the price filter with 초기화', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/search?min_price=10000&max_price=50000');
    stubFetch(() => jsonResponse(200, { items: [], total: 0, page: 1, limit: 24 }));
    render(<App />);
    await screen.findByText('검색 결과가 없어요.');

    await user.click(screen.getByRole('button', { name: /가격: 10,000원 ~ 50,000원/ }));
    await user.click(screen.getByRole('button', { name: '초기화' }));
    await waitFor(() => {
      expect(window.location.search).toBe('');
    });
  });

  it('applies a region filter from the 지역 popover', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/search');
    stubFetch(() => jsonResponse(200, { items: [], total: 0, page: 1, limit: 24 }));
    render(<App />);
    await screen.findByText('검색 결과가 없어요.');

    await user.click(screen.getByRole('button', { name: '지역' }));
    await user.type(screen.getByLabelText('지역', { selector: 'input' }), '사당동');
    await user.click(screen.getByRole('button', { name: '적용' }));

    const applied = new URL(lastProductUrl(), window.location.origin);
    expect(applied.searchParams.get('region')).toBe('사당동');
    expect(screen.getByRole('button', { name: '지역: 사당동' }).className).toContain('active');
  });
});

describe('empty result (AC2.4)', () => {
  it('shows the empty composer with 추천 칩 and 목록 복귀', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', `/search?q=${encodeURIComponent('없는것')}`);
    stubFetch((query) => {
      const keyword = query?.get('q');
      if (keyword === '수납장') {
        return jsonResponse(200, { items: [card({ title: '수납장 3단' })], total: 1, page: 1, limit: 24 });
      }
      return jsonResponse(200, { items: [], total: 0, page: 1, limit: 24 });
    });
    render(<App />);
    expect(await screen.findByText('검색 결과가 없어요.')).toBeTruthy();
    expect(screen.getByText('다른 검색어로 찾아보거나, 필터를 바꿔 보세요.')).toBeTruthy();
    expect(countText()).toBe('상품 0건');
    // The three 추천 칩 from the design's empty state are present.
    for (const keyword of ['수납장', '선반', '책상']) {
      expect(screen.getByRole('button', { name: keyword })).toBeTruthy();
    }

    await user.click(screen.getByRole('button', { name: '목록으로 돌아가기' }));
    await waitFor(() => {
      expect(window.location.pathname).toBe('/');
    });
  });

  it('a 추천 칩 starts a fresh search: q replaced, other filters cleared', async () => {
    const user = userEvent.setup();
    window.history.replaceState(
      null,
      '',
      `/search?q=${encodeURIComponent('없는것')}&category=digital&status=ACTIVE`,
    );
    stubFetch((query) => {
      const keyword = query?.get('q');
      if (keyword === '수납장') {
        return jsonResponse(200, { items: [card({ title: '수납장 3단' })], total: 1, page: 1, limit: 24 });
      }
      return jsonResponse(200, { items: [], total: 0, page: 1, limit: 24 });
    });
    render(<App />);
    await screen.findByText('검색 결과가 없어요.');

    await user.click(screen.getByRole('button', { name: '수납장' }));
    expect(await screen.findByText('수납장 3단')).toBeTruthy();
    const request = new URL(lastProductUrl(), window.location.origin);
    expect(request.searchParams.get('q')).toBe('수납장');
    expect(request.searchParams.get('category')).toBeNull();
    expect(request.searchParams.get('status')).toBeNull();
  });
});

describe('loading skeleton (AC2.5)', () => {
  it('shows skeleton placeholders while the search request is in flight', async () => {
    window.history.replaceState(null, '', `/search?q=${encodeURIComponent('책장')}`);
    const pending: { resolve: ((response: Response) => void) | null } = { resolve: null };
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (input: string | URL | Request) =>
          new Promise<Response>((resolve) => {
            if (String(input).startsWith('/api/products?')) {
              pending.resolve = resolve;
            } else {
              resolve(jsonResponse(200, CATEGORIES));
            }
          }),
      ),
    );
    render(<App />);
    await waitFor(() => {
      expect(document.querySelectorAll('.card-skeleton').length).toBeGreaterThan(0);
    });
    pending.resolve?.(
      jsonResponse(200, { items: [card()], total: 1, page: 1, limit: 24 }),
    );
    expect(await screen.findByText('원목 책장 6단')).toBeTruthy();
    expect(document.querySelectorAll('.card-skeleton')).toHaveLength(0);
  });
});

describe('error toast + retry (§3 search row)', () => {
  it('retries with the filters preserved after a network failure', async () => {
    const user = userEvent.setup();
    window.history.replaceState(
      null,
      '',
      `/search?q=${encodeURIComponent('책장')}&category=furniture`,
    );
    let failing = true;
    stubFetch((query) => {
      if (failing) return jsonResponse(500, { code: 'INTERNAL', message: '서버에 문제가 발생했어요.' });
      expect(query?.get('q')).toBe('책장');
      expect(query?.get('category')).toBe('furniture');
      return jsonResponse(200, { items: [card()], total: 1, page: 1, limit: 24 });
    });
    render(<App />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('서버에 문제가 발생했어요.');

    failing = false;
    await user.click(screen.getByRole('button', { name: '재시도' }));
    expect(await screen.findByText('원목 책장 6단')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    // 필터 유지: the URL the retry re-requests from is untouched.
    expect(window.location.search).toContain('q=');
    expect(window.location.search).toContain('category=furniture');
  });
});

describe('empty keyword submission (A3)', () => {
  it('removes the q filter instead of erroring when the input is cleared', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', `/search?q=${encodeURIComponent('책장')}`);
    stubFetch(() => jsonResponse(200, { items: [], total: 0, page: 1, limit: 24 }));
    render(<App />);
    await screen.findByText('검색 결과가 없어요.');

    const input = screen.getByLabelText('상품 검색');
    await user.clear(input);
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(window.location.search).toBe('');
    });
    expect(window.location.pathname).toBe('/search');
  });
});
