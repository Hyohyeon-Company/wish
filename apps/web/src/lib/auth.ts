/**
 * Auth session state (인증 상태 관리).
 *
 * A small observable store holding the bearer token and the member view.
 * The token is persisted in localStorage so a revisit keeps the session
 * (journey A10); on boot the token is revalidated against GET /api/auth/me,
 * and an expired/revoked token degrades to guest with the login redirect —
 * the server is the authority, never the persisted blob.
 *
 * Recorded decision: opaque bearer token in localStorage (not a cookie — the
 * API is token-based per §2-0 and v1 has no CSRF surface to defend with a
 * cookie); XSS hardening is a later security slice's concern.
 */
import { request, setUnauthorizedHandler, type ApiError } from './api';
import { navigate } from './router';

export interface MemberView {
  readonly id: string;
  readonly email: string;
  readonly nickname: string;
  readonly region: string;
  readonly created_at: string;
}

export type AuthStatus = 'unknown' | 'authenticated' | 'guest';

export interface AuthState {
  readonly status: AuthStatus;
  readonly member: MemberView | null;
}

export const TOKEN_STORAGE_KEY = 'wish.auth.token';

export interface AuthSessionResponse {
  readonly member: MemberView;
  readonly token: string;
}

export interface AuthStore {
  /** Snapshots never leak the token — only the session actions use it. */
  getState(): AuthState;
  getToken(): string | null;
  subscribe(listener: () => void): () => void;
  /** Establishes the session from a signup/login success body. */
  applySession(session: AuthSessionResponse): void;
  /** Ends the local session immediately (after logout or a 401). */
  clearSession(): void;
  /** Revalidates a persisted token via /api/auth/me before first use. */
  boot(): Promise<void>;
  /**
   * POST /api/auth/logout. A 401 means the session was already dead — the
   * local session is still cleared. A network failure keeps the session and
   * surfaces the error: silently dropping a live session would be wrong.
   */
  logout(options?: { fetchImpl?: typeof fetch; baseUrl?: string }): Promise<void>;
  /** Test seam: full state reset (listeners and storage included). */
  resetForTests(): void;
}

interface AuthStoreOptions {
  readonly storage?: Storage;
  readonly fetchImpl?: typeof fetch;
  readonly baseUrl?: string;
}                                              

export function createAuthStore(options: AuthStoreOptions = {}): AuthStore {
  const storage = options.storage ?? window.localStorage;
  // Resolved at call time (not capture time) so a stubbed global fetch —
  // as in tests — is picked up; options.fetchImpl still wins when given.
  const resolveFetch = (): typeof fetch => options.fetchImpl ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? '';

  let state: AuthState = { status: 'unknown', member: null };
  let token: string | null = null;
  const listeners = new Set<() => void>();

  function publish(): void {
    state = { ...state };
    for (const listener of listeners) listener();
  }

  function readStoredToken(): string | null {
    try {
      const value = storage.getItem(TOKEN_STORAGE_KEY);
      return typeof value === 'string' && value.length > 0 ? value : null;
    } catch {
      return null;
    }
  }

  function persistToken(value: string | null): void {
    try {
      if (value === null) storage.removeItem(TOKEN_STORAGE_KEY);
      else storage.setItem(TOKEN_STORAGE_KEY, value);
    } catch {
      // Storage unavailable (private mode etc.): the session stays in memory.
    }
  }

  const store: AuthStore = {
    getState: () => state,
    getToken: () => token,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    applySession(session: AuthSessionResponse): void {
      token = session.token;
      state = { status: 'authenticated', member: session.member };
      persistToken(token);
      publish();
    },

    clearSession(): void {
      token = null;
      state = { status: 'guest', member: null };
      persistToken(null);
      publish();
    },

    async boot(): Promise<void> {
      const stored = readStoredToken();
      if (stored === null) {
        state = { status: 'guest', member: null };
        publish();
        return;
      }
      token = stored;
      try {
        const { body } = await request<{ member: MemberView }>('/api/auth/me', {
          token,
          fetchImpl: resolveFetch(),
          baseUrl,
        });
        state = { status: 'authenticated', member: body.member };
      } catch (error) {
        // Expired/revoked token or unreachable server both degrade to guest;
        // the 'session' 401 policy already cleared storage via the handler.
        token = null;
        state = { status: 'guest', member: null };
        persistToken(null);
        void error;
      }
      publish();
    },

    async logout(requestOptions?: { fetchImpl?: typeof fetch; baseUrl?: string }): Promise<void> {
      if (token === null) {
        store.clearSession();
        return;
      }
      const usedToken = token;
      try {
        await request<void>('/api/auth/logout', {
          method: 'POST',
          token: usedToken,
          fetchImpl: requestOptions?.fetchImpl ?? resolveFetch(),
          baseUrl: requestOptions?.baseUrl ?? baseUrl,
          // 401 here must not trigger the global login redirect: the local
          // session is simply already invalid.
          unauthorized: 'error',
        });
      } catch (error) {
        const apiError = error as ApiError;
        if (apiError?.network === true) {
          throw error; // keep the session; the UI reports the failure
        }
        // Any HTTP refusal (401 included) ends the local session.
      }
      store.clearSession();
    },

    resetForTests(): void {
      state = { status: 'unknown', member: null };
      token = null;
      listeners.clear();
      persistToken(null);
    },
  };

  return store;
}

/** Application singleton. */
export const authStore = createAuthStore();

/**
 * Wires the api client's 401 policy to the store: a protected endpoint that
 * answers 401 clears the session and routes to the login screen with a
 * `returnTo` back-reference (401 미로그인 유도 + 로그인 후 복귀, AC4.1).
 * Called from the composition root (main.tsx), not on import.
 */
export function wireUnauthorizedHandling(): void {
  setUnauthorizedHandler(() => {
    authStore.clearSession();
    const here = `${window.location.pathname}${window.location.search}`;
    navigate(`/login?returnTo=${encodeURIComponent(here)}`);
  });
}
