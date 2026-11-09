/**
 * login-v1 screen behavior: validation gating, the generalized 401 form
 * error (AC5.2), network failure text (§3), the disabled submitting state
 * and the returnTo navigation on success.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../app';
import { authStore } from '../lib/auth';
import { navigate } from '../lib/router';

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

beforeEach(async () => {
  authStore.resetForTests();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/login');
  // Mirror the app's init path: no persisted token → guest.
  await authStore.boot();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LoginPage', () => {
  it('renders the email and password fields and the submit button', () => {
    render(<App />);
    expect(screen.getByLabelText('이메일')).toBeTruthy();
    expect(screen.getByLabelText('비밀번호')).toBeTruthy();
    expect(screen.getByRole('button', { name: '로그인' })).toBeTruthy();
  });

  it('blocks submission on client validation errors without a request', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);
    render(<App />);
    await user.click(screen.getByRole('button', { name: '로그인' }));
    expect(screen.getByText('이메일을 입력해 주세요.')).toBeTruthy();
    expect(screen.getByText('비밀번호를 입력해 주세요.')).toBeTruthy();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('shows the generalized credentials error on 401 (AC5.2)', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn(async () => jsonResponse(401, {
      code: 'UNAUTHORIZED',
      message: '이메일 또는 비밀번호가 올바르지 않아요.',
    }));
    vi.stubGlobal('fetch', fetchImpl);
    render(<App />);
    await user.type(screen.getByLabelText('이메일'), 'seller@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: '로그인' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('이메일 또는 비밀번호가 올바르지 않아요.');
    });
    // The failed attempt did not authenticate anyone.
    expect(authStore.getState().status).toBe('guest');
  });

  it('posts the normalized payload and navigates to returnTo on success', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/login?returnTo=%2Fproducts%2F7');
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      // The returnTo destination is a detail URL; since C5 detail-v1 owns it,
      // so the post-login detail request must be served (here: the product
      // does not exist in this stub → the AC3.2 404 branch at the URL).
      if (url.startsWith('/api/products/')) {
        return jsonResponse(404, { code: 'NOT_FOUND', message: '상품을 찾을 수 없어요.' });
      }
      expect(url).toBe('/api/auth/login');
      expect(JSON.parse(String(init?.body))).toEqual({
        email: 'seller@example.com',
        password: 'Str0ng-Pass!',
      });
      return jsonResponse(200, {
        member: {
          id: 'm-1',
          email: 'seller@example.com',
          nickname: '판매자',
          region: '서울',
          created_at: '2026-11-08T00:00:00.000Z',
        },
        token: 'tok-1',
      });
    });
    vi.stubGlobal('fetch', fetchImpl);
    render(<App />);
    await user.type(screen.getByLabelText('이메일'), ' Seller@Example.com ');
    await user.type(screen.getByLabelText('비밀번호'), 'Str0ng-Pass!');
    await user.click(screen.getByRole('button', { name: '로그인' }));
    await waitFor(() => {
      // returnTo=/products/7 lands on the real detail-v1 screen since C5; the
      // stub's product does not exist, so the §3 404 branch (AC3.2) renders
      // at the contract destination — no feed round-trip anymore.
      expect(window.location.pathname).toBe('/products/7');
    });
    expect(await screen.findByText('상품을 찾을 수 없어요')).toBeTruthy();
    expect(authStore.getState().status).toBe('authenticated');
    expect(authStore.getState().member?.nickname).toBe('판매자');
  });

  it('shows the network message on a failed request (§3)', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchImpl);
    render(<App />);
    await user.type(screen.getByLabelText('이메일'), 'seller@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'Str0ng-Pass!');
    await user.click(screen.getByRole('button', { name: '로그인' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('네트워크 연결을 확인해 주세요.');
    });
  });

  it('disables the submit button while submitting (§3 처리중 상태)', async () => {
    const user = userEvent.setup();
    let resolveRequest: ((response: Response) => void) | undefined;
    const fetchImpl = vi.fn(async () => new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    }));
    vi.stubGlobal('fetch', fetchImpl);
    render(<App />);
    await user.type(screen.getByLabelText('이메일'), 'seller@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'Str0ng-Pass!');
    await user.click(screen.getByRole('button', { name: '로그인' }));
    // While the request is in flight the button is disabled at 40% opacity.
    await waitFor(() => {
      expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByRole('button').textContent).toBe('로그인 중…');
    });
    resolveRequest?.(jsonResponse(200, {
      member: {
        id: 'm-1',
        email: 'seller@example.com',
        nickname: '판매자',
        region: '서울',
        created_at: '2026-11-08T00:00:00.000Z',
      },
      token: 'tok-1',
    }));
    await waitFor(() => {
      expect(authStore.getState().status).toBe('authenticated');
    });
  });

  it('links to the signup screen keeping returnTo', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/login?returnTo=%2Fproducts%2F7');
    render(<App />);
    await user.click(screen.getByText('회원가입'));
    expect(window.location.pathname).toBe('/signup');
    expect(window.location.search).toBe('?returnTo=%2Fproducts%2F7');
  });
});

describe('placeholder landing route (C3 update)', () => {
  it('a guest at an unassigned path is routed to the login screen with a returnTo reference', async () => {
    // Since C3 the home feed at / is public (AC1.1); the placeholder landing
    // (logout observation surface until C8's my-v1) keeps the guest redirect
    // on the paths that are still placeholder-only, /my included.
    window.history.replaceState(null, '', '/my');
    render(<App />);
    await waitFor(() => {
      expect(window.location.pathname).toBe('/login');
      expect(window.location.search).toBe('?returnTo=%2Fmy');
      expect(screen.getByRole('button', { name: '로그인' })).toBeTruthy();
    });
  });

  it('an authenticated member sees the landing and can log out (AC5.1 loop)', async () => {
    const user = userEvent.setup();
    authStore.applySession({
      member: {
        id: 'm-1',
        email: 'seller@example.com',
        nickname: '판매자',
        region: '서울',
        created_at: '2026-11-08T00:00:00.000Z',
      },
      token: 'tok-1',
    });
    window.history.replaceState(null, '', '/my');
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith('/api/favorites')) {
        return jsonResponse(200, { items: [], total: 0, page: 1, limit: 24 });
      }
      return { status: 204, ok: true, text: async () => '' } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchImpl);
    render(<App />);
    expect(screen.getByText('판매자님, 환영해요')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '로그아웃' }));
    await waitFor(() => {
      expect(window.location.pathname).toBe('/login');
    });
    expect(authStore.getState().status).toBe('guest');
    // The logout endpoint was really called with the bearer token.
    const logoutCallIndex = fetchImpl.mock.calls.findIndex(
      (call) => String(call[0]) === '/api/auth/logout',
    );
    expect(logoutCallIndex).toBeGreaterThanOrEqual(0);
    const [input, init] = fetchImpl.mock.calls[logoutCallIndex] as unknown as [string, RequestInit];
    expect(input).toBe('/api/auth/logout');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok-1');
  });

  it('a failed logout keeps the session and reports the error', async () => {
    const user = userEvent.setup();
    authStore.applySession({
      member: {
        id: 'm-1',
        email: 'seller@example.com',
        nickname: '판매자',
        region: '서울',
        created_at: '2026-11-08T00:00:00.000Z',
      },
      token: 'tok-1',
    });
    window.history.replaceState(null, '', '/my');
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      // The 찜 list loads fine; only the logout call fails — the §3 error is
      // about the logout, not the list.
      if (String(input).startsWith('/api/favorites')) {
        return jsonResponse(200, { items: [], total: 0, page: 1, limit: 24 });
      }
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchImpl);
    render(<App />);
    await screen.findByText('찜한 상품이 없어요');
    await user.click(screen.getByRole('button', { name: '로그아웃' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('네트워크 연결을 확인해 주세요.');
    });
    expect(authStore.getState().status).toBe('authenticated');
  });
});

describe('navigation helpers used by the screens', () => {
  it('navigate pushes history entries the router observes', () => {
    navigate('/login?returnTo=%2Fproducts%2F7');
    expect(window.location.pathname).toBe('/login');
    expect(window.location.search).toBe('?returnTo=%2Fproducts%2F7');
  });
});
