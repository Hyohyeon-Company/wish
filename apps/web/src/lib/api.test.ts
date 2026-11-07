/**
 * Unit tests for the §2-0 error-body consumption in the api client.
 * The contract's error shape is `{ code, message, fields? }` with `fields`
 * on 400 only — these tests pin the client's reading of it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NETWORK_ERROR_MESSAGE, request, setUnauthorizedHandler } from './api';

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

afterEach(() => {
  setUnauthorizedHandler(null);
  vi.restoreAllMocks();
});

describe('request — success paths', () => {
  it('sends the bearer token when one is given', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('/api/auth/me');
      expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer tok-1');
      return jsonResponse(200, { member: { id: 'm1' } });
    });
    const { body } = await request<{ member: { id: string } }>('/api/auth/me', {
      token: 'tok-1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(body.member.id).toBe('m1');
  });

  it('returns undefined body for 204 and sends no Content-Type without a body', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).not.toHaveProperty('Content-Type');
      expect(init?.method).toBe('POST');
      return { status: 204, ok: true, text: async () => '' } as unknown as Response;
    });
    const { status, body } = await request('/api/auth/logout', {
      method: 'POST',
      token: 't',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(status).toBe(204);
    expect(body).toBeUndefined();
  });
});

describe('request — contract error bodies (§2-0)', () => {
  it('reads a 400 VALIDATION_FAILED body with its fields map', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(400, {
      code: 'VALIDATION_FAILED',
      message: '입력값을 확인해 주세요.',
      fields: { email: '올바른 이메일 주소를 입력해 주세요.' },
    }));
    const error = await request('/api/auth/signup', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(400);
    expect(apiError.code).toBe('VALIDATION_FAILED');
    expect(apiError.fields['email']).toBe('올바른 이메일 주소를 입력해 주세요.');
  });

  it('reads the generalized 401 login failure (AC5.2)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, {
      code: 'UNAUTHORIZED',
      message: '이메일 또는 비밀번호가 올바르지 않아요.',
    }));
    const apiError = await request('/api/auth/login', {
      unauthorized: 'error',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((e: unknown) => e) as ApiError;
    expect(apiError.status).toBe(401);
    expect(apiError.message).toBe('이메일 또는 비밀번호가 올바르지 않아요.');
  });

  it('maps a 409 EMAIL_TAKEN body without fields to empty fields (Frontend-owned mapping)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(409, {
      code: 'EMAIL_TAKEN',
      message: '이미 가입된 이메일이에요.',
    }));
    const apiError = await request('/api/auth/signup', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((e: unknown) => e) as ApiError;
    expect(apiError.status).toBe(409);
    expect(apiError.code).toBe('EMAIL_TAKEN');
    expect(apiError.fields).toEqual({});
  });

  it('sanitizes a non-contract error body', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, { stack: 'internal' }));
    const apiError = await request('/api/auth/login', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((e: unknown) => e) as ApiError;
    expect(apiError.code).toBe('INTERNAL');
    expect(apiError.message).toBe('서버에 문제가 발생했어요.');
    expect(JSON.stringify(apiError)).not.toContain('stack');
  });
});

describe('request — 401 session policy (401 미로그인 유도)', () => {
  it('invokes the handler under the default session policy', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    const fetchImpl = vi.fn(async () => jsonResponse(401, {
      code: 'UNAUTHORIZED',
      message: '로그인이 필요해요.',
    }));
    await expect(request('/api/me/products', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('does not invoke the handler when the caller opts out', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    const fetchImpl = vi.fn(async () => jsonResponse(401, {
      code: 'UNAUTHORIZED',
      message: '이메일 또는 비밀번호가 올바르지 않아요.',
    }));
    await expect(request('/api/auth/login', {
      unauthorized: 'error',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});

describe('request — network failure (§3)', () => {
  it('surfaces the network message and keeps the error non-HTTP', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const apiError = await request('/api/auth/login', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((e: unknown) => e) as ApiError;
    expect(apiError.network).toBe(true);
    expect(apiError.status).toBe(0);
    expect(apiError.message).toBe(NETWORK_ERROR_MESSAGE);
  });
});
