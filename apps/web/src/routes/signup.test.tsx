/**
 * signup-v1 screen behavior: field validation, the 400 fields mapping,
 * the 409-without-fields email mapping (C1 review observation), input
 * preservation and the auto-session navigation on 201.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../app';
import { authStore } from '../lib/auth';

const MEMBER = {
  id: 'm-1',
  email: 'seller@example.com',
  nickname: '판매자',
  region: '서울',
  created_at: '2026-11-08T00:00:00.000Z',
};

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
  window.history.replaceState(null, '', '/signup');
  // Mirror the app's init path: no persisted token → guest.
  await authStore.boot();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function fillForm(user: ReturnType<typeof userEvent.setup>, overrides: Partial<Record<'email' | 'password' | 'nickname' | 'region', string>> = {}): Promise<void> {
  const values = {
    email: 'seller@example.com',
    password: 'Str0ng-Pass!',
    nickname: '판매자',
    region: '사당동',
    ...overrides,
  };
  return (async () => {
    await user.type(screen.getByLabelText('이메일'), values.email);
    await user.type(screen.getByLabelText('비밀번호'), values.password);
    await user.type(screen.getByLabelText('닉네임'), values.nickname);
    await user.type(screen.getByLabelText('활동지역'), values.region);
  })();
}

describe('SignupPage', () => {
  it('renders the four contract fields', () => {
    render(<App />);
    expect(screen.getByLabelText('이메일')).toBeTruthy();
    expect(screen.getByLabelText('비밀번호')).toBeTruthy();
    expect(screen.getByLabelText('닉네임')).toBeTruthy();
    expect(screen.getByLabelText('활동지역')).toBeTruthy();
    expect(screen.getByRole('button', { name: '가입하기' })).toBeTruthy();
  });

  it('shows client field errors and sends nothing when invalid', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);
    render(<App />);
    await fillForm(user, { email: 'nope', password: 'short' });
    await user.click(screen.getByRole('button', { name: '가입하기' }));
    expect(screen.getByText('올바른 이메일 주소를 입력해 주세요.')).toBeTruthy();
    expect(screen.getByText('비밀번호는 8자 이상 72바이트 이하로 입력해 주세요.')).toBeTruthy();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps a 400 VALIDATION_FAILED body onto the fields, preserving input', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('/api/auth/signup');
      expect(JSON.parse(String(init?.body))).toEqual({
        email: 'seller@example.com',
        password: 'Str0ng-Pass!',
        nickname: '판매자',
        region: '사당동',
      });
      return jsonResponse(400, {
        code: 'VALIDATION_FAILED',
        message: '입력값을 확인해 주세요.',
        fields: { nickname: '닉네임은 1자 이상 20자 이하로 입력해 주세요.' },
      });
    });
    vi.stubGlobal('fetch', fetchImpl);
    render(<App />);
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: '가입하기' }));
    await waitFor(() => {
      expect(screen.getByText('닉네임은 1자 이상 20자 이하로 입력해 주세요.')).toBeTruthy();
    });
    // Input values are preserved after the failed submit.
    expect((screen.getByLabelText('닉네임') as HTMLInputElement).value).toBe('판매자');
    expect(authStore.getState().status).toBe('guest');
  });

  it('maps a 409 EMAIL_TAKEN body (no fields key) to the email field error', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn(async () => jsonResponse(409, {
      code: 'EMAIL_TAKEN',
      message: '이미 가입된 이메일이에요.',
    }));
    vi.stubGlobal('fetch', fetchImpl);
    render(<App />);
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: '가입하기' }));
    await waitFor(() => {
      expect(screen.getByText('이미 가입된 이메일이에요.')).toBeTruthy();
    });
    // It is a field error on email, not a form-level alert.
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByLabelText('이메일') as HTMLInputElement).getAttribute('aria-invalid')).toBe('true');
  });

  it('starts the session on 201 and navigates to returnTo (auto session, B1)', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/signup?returnTo=%2Fsell');
    const fetchImpl = vi.fn(async () => jsonResponse(201, { member: MEMBER, token: 'tok-1' }));
    vi.stubGlobal('fetch', fetchImpl);
    render(<App />);
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: '가입하기' }));
    await waitFor(() => {
      expect(window.location.pathname).toBe('/sell');
    });
    expect(authStore.getState().status).toBe('authenticated');
    expect(window.localStorage.getItem('wish.auth.token')).toBe('tok-1');
    // The landing greets the freshly signed-up member.
    expect(screen.getByText('판매자님, 환영해요')).toBeTruthy();
  });

  it('shows the server message as a form error for other failures', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn(async () => jsonResponse(500, {
      code: 'INTERNAL',
      message: '서버에 문제가 발생했어요.',
    }));
    vi.stubGlobal('fetch', fetchImpl);
    render(<App />);
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: '가입하기' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('서버에 문제가 발생했어요.');
    });
  });

  it('links back to the login screen keeping returnTo', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/signup?returnTo=%2Fsell');
    render(<App />);
    await user.click(screen.getByText('로그인'));
    expect(window.location.pathname).toBe('/login');
    expect(window.location.search).toBe('?returnTo=%2Fsell');
  });
});
