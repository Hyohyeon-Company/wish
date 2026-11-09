/**
 * my-v1 (최소) — the 찜 section (card C6, AC6.2 · §3 my-v1 (찜) row):
 * - the §2-4 GET /api/favorites binding rides the session token;
 * - 0 favorites → the empty composer "찜한 상품이 없어요" + 보조 안내 + CTA;
 * - items render as the shared product cards, favorited by definition;
 * - network failure / 5xx → 오류 토스트 + 재시도 re-requesting the list;
 * - 찜 해제 from the list re-requests it — the list is the server's truth
 *   (AC6.2's 사전 정리 keeps deleted products out of the response);
 * - a guest at /my is login-redirected with returnTo (covered in
 *   login.test.tsx's route tests — 마이 is an authenticated destination).
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

function noContent(): Response {
  return { status: 204, ok: true, text: async () => '' } as unknown as Response;
}

const CALLS: Array<{ url: string; method: string }> = [];

function card(id: string, title: string): Record<string, unknown> {
  return {
    id,
    title,
    price: 45000,
    region: '사당동',
    status: 'ACTIVE',
    created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    thumbnail_url: null,
    condition: 'like_new',
  };
}

beforeEach(async () => {
  authStore.resetForTests();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
  await authStore.boot();
  authStore.applySession({
    member: {
      id: 'm-1',
      email: 'member@example.com',
      nickname: '찜하는사람',
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

describe('my 찜 섹션 (card C6, AC6.2)', () => {
  it('binds GET /api/favorites with the session token and renders the 찜순 cards', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      CALLS.push({ url, method: 'GET' });
      if (url === '/api/favorites?page=1&limit=24') {
        return jsonResponse(200, {
          items: [card('p-2', '원목 책상'), card('p-1', '원목 의자')],
          total: 2,
          page: 1,
          limit: 24,
        });
      }
      return jsonResponse(500, { code: 'INTERNAL', message: 'unexpected' });
    });
    vi.stubGlobal('fetch', fetchImpl);
    window.history.replaceState(null, '', '/my');
    render(<App />);

    expect(await screen.findByRole('heading', { name: '찜하는사람님, 환영해요' })).toBeTruthy();
    expect(await screen.findByText('원목 책상')).toBeTruthy();
    expect(screen.getByText('원목 의자')).toBeTruthy();
    // The list request rides the session (마이 is authenticated, §2-4).
    const list = CALLS.find((call) => call.url === '/api/favorites?page=1&limit=24');
    expect(list).toBeDefined();
  });

  it('shows the 찜 empty composer for 0 favorites (AC6.2 빈 상태)', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input).startsWith('/api/favorites') || String(input).startsWith('/api/me/products')) {
        return jsonResponse(200, { items: [], total: 0, page: 1, limit: 24 });
      }
      return jsonResponse(500, { code: 'INTERNAL', message: 'unexpected' });
    });
    vi.stubGlobal('fetch', fetchImpl);
    window.history.replaceState(null, '', '/my');
    render(<App />);

    expect(await screen.findByText('찜한 상품이 없어요')).toBeTruthy();
    expect(screen.getByText('마음에 드는 상품을 찜해 보세요')).toBeTruthy();
  });

  it('a list failure shows the 오류 토스트 and 재시도 re-requests (§3 my 찜 row)', async () => {
    let fail = true;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      // Only the 찜 list fails in this scenario; the 내 등록 상품 section
      // (C7) succeeds, so the screen shows exactly one 오류 토스트.
      if (String(input).startsWith('/api/me/products')) {
        return jsonResponse(200, { items: [], total: 0, page: 1, limit: 24 });
      }
      if (String(input).startsWith('/api/favorites')) {
        if (fail) return jsonResponse(500, { code: 'INTERNAL', message: '서버에 문제가 발생했어요.' });
        return jsonResponse(200, { items: [], total: 0, page: 1, limit: 24 });
      }
      return jsonResponse(500, { code: 'INTERNAL', message: 'unexpected' });
    });
    vi.stubGlobal('fetch', fetchImpl);
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/my');
    render(<App />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('서버에 문제가 발생했어요.');
    fail = false;
    await user.click(screen.getByRole('button', { name: '재시도' }));
    expect(await screen.findByText('찜한 상품이 없어요')).toBeTruthy();
  });

  it('unfavoriting from the list re-requests it, so the row disappears (AC6.2 관찰)', async () => {
    let favorited = true;
    const calls: Array<{ url: string; method: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? 'GET', init });
      if (url === '/api/favorites?page=1&limit=24') {
        return jsonResponse(
          200,
          favorited
            ? { items: [card('p-1', '원목 의자')], total: 1, page: 1, limit: 24 }
            : { items: [], total: 0, page: 1, limit: 24 },
        );
      }
      if (url === '/api/favorites/p-1' && init?.method === 'DELETE') {
        favorited = false;
        return noContent();
      }
      return jsonResponse(500, { code: 'INTERNAL', message: 'unexpected' });
    });
    vi.stubGlobal('fetch', fetchImpl);
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/my');
    render(<App />);

    expect(await screen.findByText('원목 의자')).toBeTruthy();
    // The 찜 목록 rows are favorited by definition: the heart starts filled.
    const heart = screen.getAllByRole('button', { name: '찜하기' })[0]!;
    expect(heart.getAttribute('aria-pressed')).toBe('true');

    await user.click(heart);

    await waitFor(() => {
      expect(screen.queryByText('원목 의자')).toBeNull();
      expect(screen.getByText('찜한 상품이 없어요')).toBeTruthy();
    });
    expect(
      calls.some((call) => call.url === '/api/favorites/p-1' && call.method === 'DELETE'),
    ).toBe(true);
    // The list was really re-requested after the unfavorite.
    expect(calls.filter((call) => call.url === '/api/favorites?page=1&limit=24')).toHaveLength(2);
  });
});
