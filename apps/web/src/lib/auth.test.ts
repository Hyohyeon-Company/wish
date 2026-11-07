/**
 * Auth store tests: session establishment, persistence, boot revalidation,
 * logout behavior (including the "session already dead" 401 case) and the
 * 401 wiring that routes to the login screen with a returnTo reference.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setUnauthorizedHandler } from './api';
import { TOKEN_STORAGE_KEY, authStore, createAuthStore, wireUnauthorizedHandling, type AuthSessionResponse } from './auth';

const SESSION: AuthSessionResponse = {
  member: {
    id: 'm-1',
    email: 'seller@example.com',
    nickname: '판매자',
    region: '서울',
    created_at: '2026-11-08T00:00:00.000Z',
  },
  token: 'tok-abc-1',
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response;
}

beforeEach(() => {
  authStore.resetForTests();
  window.localStorage.clear();
});

afterEach(() => {
  setUnauthorizedHandler(null);
  vi.restoreAllMocks();
});

describe('session lifecycle', () => {
  it('applySession authenticates and persists the token', () => {
    authStore.applySession(SESSION);
    expect(authStore.getState().status).toBe('authenticated');
    expect(authStore.getState().member?.nickname).toBe('판매자');
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBe('tok-abc-1');
  });

  it('clearSession degrades to guest and removes the token', () => {
    authStore.applySession(SESSION);
    authStore.clearSession();
    expect(authStore.getState().status).toBe('guest');
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });

  it('notifies subscribers on every transition', () => {
    const listener = vi.fn();
    const unsubscribe = authStore.subscribe(listener);
    authStore.applySession(SESSION);
    authStore.clearSession();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    authStore.applySession(SESSION);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('boot revalidation (server is the authority)', () => {
  it('with no stored token: becomes guest without any request', async () => {
    const fetchImpl = vi.fn();
    const store = createAuthStore({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await store.boot();
    expect(store.getState().status).toBe('guest');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('with a live token: authenticates with the server member view', async () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'tok-live');
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer tok-live');
      return jsonResponse(200, { member: SESSION.member });
    });
    const store = createAuthStore({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await store.boot();
    expect(store.getState()).toEqual({ status: 'authenticated', member: SESSION.member });
  });

  it('with an expired token: degrades to guest, clears storage, triggers the login redirect', async () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'tok-expired');
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    const fetchImpl = vi.fn(async () => jsonResponse(401, {
      code: 'UNAUTHORIZED',
      message: '로그인이 필요해요.',
    }));
    const store = createAuthStore({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await store.boot();
    expect(store.getState().status).toBe('guest');
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});

describe('logout', () => {
  it('POSTs the bearer token, clears the session on 204', async () => {
    authStore.applySession(SESSION);
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer tok-abc-1');
      return { status: 204, ok: true, text: async () => '' } as unknown as Response;
    });
    await authStore.logout({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(authStore.getState().status).toBe('guest');
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });

  it('a 401 still clears the local session without throwing', async () => {
    authStore.applySession(SESSION);
    const fetchImpl = vi.fn(async () => jsonResponse(401, {
      code: 'UNAUTHORIZED',
      message: '로그인이 필요해요.',
    }));
    await authStore.logout({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(authStore.getState().status).toBe('guest');
  });

  it('a network failure keeps the session and surfaces the error', async () => {
    authStore.applySession(SESSION);
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(authStore.logout({ fetchImpl: fetchImpl as unknown as typeof fetch }))
      .rejects.toMatchObject({ network: true });
    expect(authStore.getState().status).toBe('authenticated');
  });
});

describe('wireUnauthorizedHandling', () => {
  it('clears the session and routes to /login with returnTo on a 401', async () => {
    wireUnauthorizedHandling();
    authStore.applySession(SESSION);
    window.history.replaceState(null, '', '/my');
    const fetchImpl = vi.fn(async () => jsonResponse(401, {
      code: 'UNAUTHORIZED',
      message: '로그인이 필요해요.',
    }));
    const store = createAuthStore({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await store.boot();
    // The api-level handler cleared the singleton's session and navigated.
    expect(authStore.getState().status).toBe('guest');
    expect(window.location.pathname).toBe('/login');
    expect(window.location.search).toBe('?returnTo=%2Fmy');
  });
});
