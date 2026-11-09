/**
 * detail-v1 screen behavior (card C5, AC3.1~3.3 · §3 detail row):
 * - the screen is public: a guest at /products/{id} sees the detail, never a
 *   login redirect (§3 detail row);
 * - the §2-3 detail contract binds the screen: gallery images in sort_order
 *   order with dot switching, 가격 24px/700, 제목, 설명, 정보 테이블
 *   (상품상태·거래지역·등록), 판매자 닉네임·활동지역, 상태 배지 (AC3.1);
 * - 404 NOT_FOUND → 404 화면: 만료 안내 + 목록 복귀 (AC3.2);
 * - loading → skeleton first; failure → toast + 재시도 (§3 standard branch);
 * - "채팅하기" is NOT rendered anywhere (AC3.3, v1 의도적 차이) — the 찜
 *   토글 likewise stays off until card C6 owns it;
 * - a logged-in session rides along as the Authorization header so the
 *   server can personalize favorited (C6's data source).
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
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

function detailBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    product: {
      id: 'p-1',
      title: '원목 식탁 4인용, 상태 좋아요 (이사 파손)',
      description: '이사 가면서 판매합니다.\n표면 스크래치 거의 없어요.',
      price: 120000,
      category_code: 'furniture',
      condition: 'like_new',
      region: '사당동',
      status: 'ACTIVE',
      created_at: new Date(Date.now() - 22 * 60 * 1000).toISOString(),
      seller: { id: 'm-1', nickname: '샘플판매자', region: '사당동' },
      images: [
        { url: 'http://localhost:3000/uploads/table-1.png', sort_order: 1 },
        { url: 'http://localhost:3000/uploads/table-2.png', sort_order: 2 },
      ],
      ...overrides,
    },
    favorited: null,
  };
}

const CALLS: Array<{ url: string; headers: Record<string, string> }> = [];

function stubFetch(handler: (url: string) => Response | Promise<Response>): void {
  CALLS.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: { headers?: Record<string, string> }) => {
      const url = String(input);
      CALLS.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      return handler(url);
    }),
  );
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

describe('detail binding (AC3.1)', () => {
  it('renders a guest detail without a login redirect — gallery, price, title, description, seller, badges', async () => {
    window.history.replaceState(null, '', '/products/p-1');
    stubFetch((url) => {
      expect(url).toBe('/api/products/p-1');
      return jsonResponse(200, detailBody());
    });
    render(<App />);

    expect(await screen.findByRole('heading', { name: '원목 식탁 4인용, 상태 좋아요 (이사 파손)' })).toBeTruthy();
    expect(screen.getByText('120,000원')).toBeTruthy();
    const desc = document.querySelector('.d-desc');
    expect(desc?.textContent).toContain('이사 가면서 판매합니다.');
    expect(desc?.textContent).toContain('표면 스크래치 거의 없어요.');
    expect(screen.getByText('샘플판매자')).toBeTruthy();
    expect(screen.getByText('활동지역 사당동')).toBeTruthy();
    expect(screen.getAllByText('판매중')).toHaveLength(2);
    expect(screen.getByText('상품상태: 거의 새 것')).toBeTruthy();
    // 정보 테이블 rows (AC3.1: 컨디션·지역·등록시간)
    const spec = document.querySelector('.d-spec table');
    expect(spec?.textContent).toContain('상품상태');
    expect(spec?.textContent).toContain('거래지역');
    expect(spec?.textContent).toContain('사당동');
    expect(spec?.textContent).toContain('등록');
    // gallery: first image by sort_order + one dot per image
    const image = document.querySelector('.gal-img') as HTMLImageElement | null;
    expect(image?.getAttribute('src')).toBe('http://localhost:3000/uploads/table-1.png');
    expect(document.querySelectorAll('.dot')).toHaveLength(2);
    expect(window.location.pathname).toBe('/products/p-1');
  });

  it('price renders at the design 24px/700 token spec (가격 24px/700)', async () => {
    window.history.replaceState(null, '', '/products/p-1');
    stubFetch(() => jsonResponse(200, detailBody()));
    render(<App />);
    await screen.findByText('120,000원');
    // jsdom computes no stylesheet styles, so the 24px/700 spec is asserted
    // at its source: the .d-price rule must use the §3 가격 token
    // (--fs-price = 24px) with weight 700 — not a hardcoded px value.
    // (vitest runs with cwd=apps/web.)
    const baseCss = readFileSync('src/styles/base.css', 'utf8');
    const priceRule = /\.d-price \{[^}]*\}/.exec(baseCss)?.[0] ?? '';
    expect(priceRule).toContain('font-size: var(--fs-price)');
    expect(priceRule).toContain('font-weight: 700');
    const tokens = readFileSync('src/styles/tokens.css', 'utf8');
    expect(tokens).toMatch(/--fs-price:\s*24px/);
  });

  it('switches the main image through the gallery dots (도트 전환)', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/products/p-1');
    stubFetch(() => jsonResponse(200, detailBody()));
    render(<App />);
    await screen.findByRole('heading', { name: '원목 식탁 4인용, 상태 좋아요 (이사 파손)' });

    await user.click(screen.getByRole('button', { name: '2번 이미지' }));
    const image = document.querySelector('.gal-img') as HTMLImageElement | null;
    expect(image?.getAttribute('src')).toBe('http://localhost:3000/uploads/table-2.png');
    expect(document.querySelector('.dot[aria-current="true"]')?.getAttribute('aria-label')).toBe(
      '2번 이미지',
    );
  });

  it('sends the session token so favorited can be personalized (C6 데이터 소스)', async () => {
    authStore.applySession({
      member: {
        id: 'm-9',
        email: 'viewer@example.com',
        nickname: '구경꾼',
        region: '논현동',
        created_at: '2026-11-01T00:00:00.000Z',
      },
      token: 'token-abc',
    });
    window.history.replaceState(null, '', '/products/p-1');
    stubFetch(() => jsonResponse(200, detailBody()));
    render(<App />);
    await screen.findByRole('heading', { name: '원목 식탁 4인용, 상태 좋아요 (이사 파손)' });
    const detailCall = CALLS.find((call) => call.url === '/api/products/p-1');
    expect(detailCall?.headers['Authorization']).toBe('Bearer token-abc');
  });
});

describe('채팅하기 비노출 (AC3.3)', () => {
  it('renders no 채팅하기 CTA anywhere on the screen', async () => {
    window.history.replaceState(null, '', '/products/p-1');
    stubFetch(() => jsonResponse(200, detailBody()));
    render(<App />);
    await screen.findByRole('heading', { name: '원목 식탁 4인용, 상태 좋아요 (이사 파손)' });
    expect(screen.queryByText('채팅하기')).toBeNull();
    // The 찜 토글 is card C6's deliverable — not rendered in C5 either.
    expect(screen.queryByLabelText('찜하기')).toBeNull();
  });
});

describe('404 / loading / error branches (§3 detail row)', () => {
  it('shows the 만료 안내 404 screen for a deleted/unknown product and returns to the list (AC3.2)', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/products/gone');
    stubFetch(() => jsonResponse(404, { code: 'NOT_FOUND', message: '상품을 찾을 수 없어요.' }));
    render(<App />);

    expect(await screen.findByText('상품을 찾을 수 없어요')).toBeTruthy();
    expect(screen.getByText('삭제되었거나 만료된 상품이에요')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '목록으로 돌아가기' }));
    await waitFor(() => expect(window.location.pathname).toBe('/'));
  });

  it('shows the skeleton first, data after (AC2.5 posture)', async () => {
    window.history.replaceState(null, '', '/products/p-1');
    stubFetch(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => resolve(jsonResponse(200, detailBody())), 30);
        }),
    );
    render(<App />);
    expect(document.querySelector('.d-skeleton')).toBeTruthy();
    expect(document.querySelector('.d-skel-gal')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: '원목 식탁 4인용, 상태 좋아요 (이사 파손)' })).toBeTruthy();
    expect(document.querySelector('.d-skeleton')).toBeNull();
  });

  it('network failure → toast + 재시도 re-requests the detail', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/products/p-1');
    let attempts = 0;
    stubFetch(() => {
      attempts += 1;
      if (attempts === 1) throw new TypeError('offline');
      return jsonResponse(200, detailBody());
    });
    render(<App />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('네트워크 연결을 확인해 주세요.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '재시도' }));
    expect(await screen.findByRole('heading', { name: '원목 식탁 4인용, 상태 좋아요 (이사 파손)' })).toBeTruthy();
    expect(attempts).toBe(2);
  });

  it('a 5xx answers the toast too (not the 404 screen)', async () => {
    window.history.replaceState(null, '', '/products/p-1');
    stubFetch(() => jsonResponse(500, { code: 'INTERNAL', message: '서버에 문제가 발생했어요.' }));
    render(<App />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('상품을 찾을 수 없어요')).toBeNull();
  });
});
