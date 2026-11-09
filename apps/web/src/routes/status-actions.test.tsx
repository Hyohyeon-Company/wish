/**
 * C7 UI tests: the seller's 상태 변경 입구 on detail (B10, AC7.3) and the
 * 내 등록 상품 section on my (B9/B12) — the §6 전이표's buttons, the PATCH
 * flow updating from the server's answer, the terminal 거래완료 rendering
 * nothing, and the two-tap --danger delete sending DELETE and re-requesting
 * the server's truth.
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

const detailBody = (status: string): Record<string, unknown> => ({
  product: {
    id: 'p-1',
    title: '원목 의자',
    description: '테스트 상품입니다.',
    price: 45000,
    category_code: 'furniture',
    condition: 'like_new',
    region: '사당동',
    status,
    created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    seller: { id: 'm-1', nickname: '판매자', region: '사당동' },
    images: [{ url: 'http://localhost:3000/uploads/a.png', sort_order: 1 }],
  },
  favorited: false,
});

const myProduct = (status: string): Record<string, unknown> => ({
  id: 'p-1',
  title: '원목 의자',
  price: 45000,
  region: '사당동',
  status,
  created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  thumbnail_url: null,
  condition: 'like_new',
});

function emptyPage(): Record<string, unknown> {
  return { items: [], total: 0, page: 1, limit: 24 };
}

beforeEach(async () => {
  authStore.resetForTests();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
  await authStore.boot();
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
});

afterEach(() => {
  setUnauthorizedHandler(null);
  vi.restoreAllMocks();
});

describe('detail-v1 seller 상태 변경 (card C7, B10/AC7.3)', () => {
  it('offers exactly the §6 전이표 targets for the current status and PATCHes the tapped one', async () => {
    const user = userEvent.setup();
    let status = 'ACTIVE';
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/products/p-1') return jsonResponse(200, detailBody(status));
      if (url === '/api/products/p-1/status' && init?.method === 'PATCH') {
        status = (JSON.parse(String(init.body) as string) as { status: string }).status;
        return jsonResponse(200, { product: { ...(detailBody(status).product as Record<string, unknown>), status } });
      }
      return jsonResponse(500, { code: 'INTERNAL', message: 'unexpected' });
    });
    vi.stubGlobal('fetch', fetchImpl);
    window.history.replaceState(null, '', '/products/p-1');
    render(<App />);

    // 판매중 → 예약중 / 거래완료 only (the §6 row for ACTIVE).
    expect(await screen.findByText('예약중(으)로 변경')).toBeTruthy();
    expect(screen.getByText('거래완료(으)로 변경')).toBeTruthy();
    expect(screen.queryByText('판매중(으)로 변경')).toBeNull();

    await user.click(screen.getByText('예약중(으)로 변경'));
    await waitFor(() => {
      expect(fetchImpl.mock.calls.some((call) => String(call[0]) === '/api/products/p-1/status')).toBe(true);
    });
    // AC7.3: the badge re-renders from the server's answer immediately.
    expect(await screen.findByText('판매중(으)로 변경')).toBeTruthy();
    expect(screen.queryByText('예약중(으)로 변경')).toBeNull();
  });

  it('renders no 상태 변경 UI for the terminal 거래완료 (B11 되돌림 UI 없음)', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input) === '/api/products/p-1') return jsonResponse(200, detailBody('SOLD'));
      return jsonResponse(500, { code: 'INTERNAL', message: 'unexpected' });
    });
    vi.stubGlobal('fetch', fetchImpl);
    window.history.replaceState(null, '', '/products/p-1');
    render(<App />);
    expect(await screen.findByText('원목 의자')).toBeTruthy();
    expect(screen.queryByText(/변경$/)).toBeNull();
    expect(document.querySelector('.status-actions')).toBeNull();
  });

  it('a guest and a non-seller see no 상태 변경 UI (403은 정상 경로에 없음)', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input) === '/api/products/p-1') {
        // seller id differs from the session member id
        const body = detailBody('ACTIVE') as { product: { seller: { id: string } } };
        body.product.seller.id = 'someone-else';
        return jsonResponse(200, body);
      }
      return jsonResponse(500, { code: 'INTERNAL', message: 'unexpected' });
    });
    vi.stubGlobal('fetch', fetchImpl);
    window.history.replaceState(null, '', '/products/p-1');
    render(<App />);
    expect(await screen.findByText('원목 의자')).toBeTruthy();
    expect(document.querySelector('.status-actions')).toBeNull();
  });

  it('a 전이표 밖 refusal (stale screen) surfaces the server message as a toast', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/products/p-1') return jsonResponse(200, detailBody('ACTIVE'));
      if (url === '/api/products/p-1/status' && init?.method === 'PATCH') {
        return jsonResponse(400, { code: 'INVALID_TRANSITION', message: "'판매중'에서 '판매중'(으)로 상태를 변경할 수 없어요." });
      }
      return jsonResponse(500, { code: 'INTERNAL', message: 'unexpected' });
    });
    vi.stubGlobal('fetch', fetchImpl);
    window.history.replaceState(null, '', '/products/p-1');
    render(<App />);
    await user.click(await screen.findByText('예약중(으)로 변경'));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});

describe('my 내 등록 상품 섹션 (card C7, B9/B12)', () => {
  it('binds GET /api/me/products and renders the rows with 상태 배지 and actions', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === '/api/me/products?page=1&limit=24') {
        return jsonResponse(200, { items: [myProduct('ACTIVE')], total: 1, page: 1, limit: 24 });
      }
      if (url.startsWith('/api/favorites')) return jsonResponse(200, emptyPage());
      return jsonResponse(500, { code: 'INTERNAL', message: 'unexpected' });
    });
    vi.stubGlobal('fetch', fetchImpl);
    window.history.replaceState(null, '', '/my');
    render(<App />);

    expect(await screen.findByText('내 등록 상품')).toBeTruthy();
    expect(await screen.findByText('원목 의자')).toBeTruthy();
    expect(screen.getByText('예약중(으)로 변경')).toBeTruthy();
    expect(screen.getByText('삭제')).toBeTruthy();
  });

  it('0 등록 상품 shows the 등록한 상품이 없어요 composer with the 판매 CTA (B9)', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith('/api/me/products')) return jsonResponse(200, emptyPage());
      if (url.startsWith('/api/favorites')) return jsonResponse(200, emptyPage());
      return jsonResponse(500, { code: 'INTERNAL', message: 'unexpected' });
    });
    vi.stubGlobal('fetch', fetchImpl);
    window.history.replaceState(null, '', '/my');
    render(<App />);
    expect(await screen.findByText('등록한 상품이 없어요')).toBeTruthy();
    expect(screen.getByText('판매하러 가기')).toBeTruthy();
  });

  it('the delete button arms first, then DELETE 204 re-requests the server truth (B12)', async () => {
    const user = userEvent.setup();
    let deleted = false;
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.startsWith('/api/me/products')) {
        return jsonResponse(
          200,
          deleted ? emptyPage() : { items: [myProduct('ACTIVE')], total: 1, page: 1, limit: 24 },
        );
      }
      if (url.startsWith('/api/favorites')) return jsonResponse(200, emptyPage());
      if (url === '/api/products/p-1' && init?.method === 'DELETE') {
        deleted = true;
        return { status: 204, ok: true, text: async () => '' } as unknown as Response;
      }
      return jsonResponse(500, { code: 'INTERNAL', message: 'unexpected' });
    });
    vi.stubGlobal('fetch', fetchImpl);
    window.history.replaceState(null, '', '/my');
    render(<App />);

    const deleteButton = await screen.findByText('삭제');
    await user.click(deleteButton);
    // First tap arms only — no DELETE yet.
    expect(calls.some((call) => call.startsWith('DELETE'))).toBe(false);
    await user.click(screen.getByText('정말 삭제할까요?'));
    await waitFor(() => {
      expect(calls.some((call) => call === 'DELETE /api/products/p-1')).toBe(true);
    });
    // The list is the server's truth: re-requested, row gone.
    expect(await screen.findByText('등록한 상품이 없어요')).toBeTruthy();
  });
});
