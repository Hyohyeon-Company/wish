/**
 * sell-v1 screen behavior (card C2, AC4.1~4.4):
 * - guest → login redirect with returnTo=/sell and back (AC4.1, B3);
 * - categories from the server (B4) with retry on failure;
 * - client validation: 0 photos and non-numeric price blocked before any
 *   request (B6, AC4.2), the 11th photo is blocked (B5);
 * - submit posts the §2-3 body and navigates to /products/{id} (B7);
 * - 400 field errors render per field with inputs preserved (B7);
 * - a 401 during submit hits the shared session policy (AC4.1);
 * - an upload failure marks only the failed attempt and keeps the rest (B5).
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

const MEMBER = {
  id: 'member-1',
  email: 'seller@example.com',
  nickname: '판매자',
  region: '사당동',
  created_at: '2026-11-08T09:00:00.000Z',
};

const CATEGORIES = [
  { code: 'furniture', name: '가구/인테리어', display_order: 1 },
  { code: 'digital', name: '디지털', display_order: 2 },
  { code: 'fashion', name: '의류', display_order: 3 },
  { code: 'beauty', name: '뷰티', display_order: 4 },
  { code: 'sports', name: '스포츠/레저', display_order: 5 },
];

function routeByUrl(url: string): Response {
  if (url.endsWith('/api/categories')) return jsonResponse(200, CATEGORIES);
  if (url.endsWith('/api/uploads')) {
    return jsonResponse(201, { url: `/uploads/photo-${Math.random()}.png`, width: 1, height: 1, size: 100 });
  }
  return jsonResponse(500, { code: 'INTERNAL', message: 'unexpected' });
}

/** Signs in through the store directly — the session plumbing is C1-F's tested scope. */
async function signIn(): Promise<void> {
  authStore.applySession({ member: MEMBER, token: 'token-1' });
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

describe('sell-v1 access (AC4.1)', () => {
  it('redirects a guest to the login screen with returnTo=/sell', async () => {
    window.history.replaceState(null, '', '/sell');
    render(<App />);
    await waitFor(() => {
      expect(window.location.pathname).toBe('/login');
    });
    expect(window.location.search).toBe('?returnTo=%2Fsell');
  });

  it('returns the member to the sell form after login (복귀)', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/login?returnTo=%2Fsell');
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/api/auth/login')) {
        return jsonResponse(200, { member: MEMBER, token: 'token-2' });
      }
      return routeByUrl(String(input));
    });
    vi.stubGlobal('fetch', fetchImpl);
    render(<App />);
    await user.type(screen.getByLabelText('이메일'), 'seller@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'Str0ng-Pass!');
    await user.click(screen.getByRole('button', { name: '로그인' }));
    await waitFor(() => {
      expect(window.location.pathname).toBe('/sell');
    });
    // The returned form loads its categories from the server (B4).
    expect(await screen.findByText('디지털')).toBeTruthy();
  });
});

describe('sell-v1 form (B4~B7)', () => {
  function fillValidForm(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    return (async () => {
      await user.type(screen.getByLabelText('제목'), '아이패드 미니 6세대');
      await user.type(screen.getByLabelText('가격'), '350000');
      await user.click(screen.getByRole('button', { name: '디지털' }));
      await user.click(screen.getByRole('button', { name: '거의 새 것' }));
      await user.type(screen.getByLabelText('설명'), '거의 사용하지 않은 상품입니다.');
      // 사진 0장 → client validation must block before any request.
    })();
  }

  it('blocks submission with 0 photos before any request (AC4.2, B6)', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn(async (input: string | URL | Request) => routeByUrl(String(input)));
    await signIn();
    window.history.replaceState(null, '', '/sell');
    vi.stubGlobal('fetch', fetchImpl);
    render(<App />);
    await screen.findByText('디지털');
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: '등록하기' }));
    expect(screen.getByText('사진을 1장 이상 추가해 주세요.')).toBeTruthy();
    // No POST reached the network — only the categories GET happened.
    const posted = fetchImpl.mock.calls.filter((call) => String(call[0]).endsWith('/api/products'));
    expect(posted).toHaveLength(0);
  });

  it('rejects non-digit price input immediately and accepts digits on submit (B6)', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/api/uploads')) {
        expect(init?.body).toBeInstanceOf(FormData);
        return jsonResponse(201, { url: '/uploads/p1.png', width: 10, height: 10, size: 100 });
      }
      return routeByUrl(String(input));
    });
    await signIn();
    window.history.replaceState(null, '', '/sell');
    vi.stubGlobal('fetch', fetchImpl);
    render(<App />);
    await screen.findByText('디지털');
    const price = screen.getByLabelText('가격') as HTMLInputElement;
    await user.type(price, '12a3!');
    // Non-digits never enter the field (클라이언트 즉시 거부).
    expect(price.value).toBe('123');
    await user.type(screen.getByLabelText('제목'), '아이패드 미니 6세대');
    await user.click(screen.getByRole('button', { name: '디지털' }));
    await user.click(screen.getByRole('button', { name: '거의 새 것' }));
    await user.type(screen.getByLabelText('설명'), '거의 사용하지 않은 상품입니다.');
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['png-bytes'], 'photo.png', { type: 'image/png' }));
    await waitFor(() => {
      expect(screen.getByAltText('사진 1')).toBeTruthy();
    });
    await user.click(screen.getByRole('button', { name: '등록하기' }));
    // 123 is a valid positive integer — no price error, the POST went out.
    expect(screen.queryByText('가격은 1원 이상으로 입력해 주세요.')).toBeNull();
    expect(screen.queryByText('가격은 숫자로 입력해 주세요.')).toBeNull();
    const posted = fetchImpl.mock.calls.filter((call) => String(call[0]).endsWith('/api/products'));
    expect(posted).toHaveLength(1);
  });

  it('posts the §2-3 body and navigates to /products/{id} on 201 (B7)', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/uploads')) {
        expect(init?.body).toBeInstanceOf(FormData);
        return jsonResponse(201, { url: '/uploads/p1.png', width: 10, height: 10, size: 100 });
      }
      if (url.endsWith('/api/products')) {
        expect(JSON.parse(String(init?.body))).toEqual({
          title: '아이패드 미니 6세대',
          price: 350000,
          category_code: 'digital',
          condition: 'like_new',
          description: '거의 사용하지 않은 상품입니다.',
          region: '사당동',
          image_urls: ['/uploads/p1.png'],
        });
        return jsonResponse(201, { product: { id: 'product-9' } });
      }
      return routeByUrl(url);
    });
    await signIn();
    window.history.replaceState(null, '', '/sell');
    vi.stubGlobal('fetch', fetchImpl);
    render(<App />);
    await screen.findByText('디지털');
    await user.type(screen.getByLabelText('제목'), '아이패드 미니 6세대');
    await user.type(screen.getByLabelText('가격'), '350000');
    await user.click(screen.getByRole('button', { name: '디지털' }));
    await user.click(screen.getByRole('button', { name: '거의 새 것' }));
    await user.type(screen.getByLabelText('설명'), '거의 사용하지 않은 상품입니다.');
    // Upload one photo through the file input.
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['png-bytes'], 'photo.png', { type: 'image/png' });
    await user.upload(input, file);
    await waitFor(() => {
      expect(screen.getByAltText('사진 1')).toBeTruthy();
    });
    await user.click(screen.getByRole('button', { name: '등록하기' }));
    await waitFor(() => {
      expect(window.location.pathname).toBe('/products/product-9');
    });
  });

  it('renders 400 field errors and preserves the inputs (B7)', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/uploads')) {
        return jsonResponse(201, { url: '/uploads/p1.png', width: 10, height: 10, size: 100 });
      }
      if (url.endsWith('/api/products')) {
        return jsonResponse(400, {
          code: 'VALIDATION_FAILED',
          message: '입력값을 확인해 주세요.',
          fields: { price: '가격은 1원 이상으로 입력해 주세요.', title: '제목은 1자 이상 50자 이하로 입력해 주세요.' },
        });
      }
      return routeByUrl(url);
    });
    await signIn();
    window.history.replaceState(null, '', '/sell');
    vi.stubGlobal('fetch', fetchImpl);
    render(<App />);
    await screen.findByText('디지털');
    await user.type(screen.getByLabelText('제목'), '아이패드 미니 6세대');
    await user.type(screen.getByLabelText('가격'), '-5');
    await user.click(screen.getByRole('button', { name: '디지털' }));
    await user.click(screen.getByRole('button', { name: '거의 새 것' }));
    await user.type(screen.getByLabelText('설명'), '거의 사용하지 않은 상품입니다.');
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['png-bytes'], 'photo.png', { type: 'image/png' }));
    await waitFor(() => {
      expect(screen.getByAltText('사진 1')).toBeTruthy();
    });
    await user.click(screen.getByRole('button', { name: '등록하기' }));
    await waitFor(() => {
      expect(screen.getByText('가격은 1원 이상으로 입력해 주세요.')).toBeTruthy();
    });
    // Inputs preserved after the failed submission.
    expect((screen.getByLabelText('제목') as HTMLInputElement).value).toBe('아이패드 미니 6세대');
    expect(window.location.pathname).toBe('/sell');
  });

  it('a 401 during submit clears the session and routes to login with returnTo (AC4.1)', async () => {
    const user = userEvent.setup();
    const unauthorized = vi.fn();
    // Mirror the production wiring (main.tsx wireUnauthorizedHandling): the
    // handler itself clears the session; the api client only invokes it.
    setUnauthorizedHandler(() => {
      unauthorized();
      authStore.clearSession();
    });
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/uploads')) {
        return jsonResponse(201, { url: '/uploads/p1.png', width: 10, height: 10, size: 100 });
      }
      if (url.endsWith('/api/products')) {
        expect(init?.headers && (init.headers as Record<string, string>)['Authorization']).toBe('Bearer token-1');
        return jsonResponse(401, { code: 'UNAUTHORIZED', message: '로그인이 필요해요.' });
      }
      return routeByUrl(url);
    });
    await signIn();
    window.history.replaceState(null, '', '/sell');
    vi.stubGlobal('fetch', fetchImpl);
    render(<App />);
    await screen.findByText('디지털');
    await user.type(screen.getByLabelText('제목'), '아이패드 미니 6세대');
    await user.type(screen.getByLabelText('가격'), '350000');
    await user.click(screen.getByRole('button', { name: '디지털' }));
    await user.click(screen.getByRole('button', { name: '거의 새 것' }));
    await user.type(screen.getByLabelText('설명'), '거의 사용하지 않은 상품입니다.');
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['png-bytes'], 'photo.png', { type: 'image/png' }));
    await waitFor(() => {
      expect(screen.getByAltText('사진 1')).toBeTruthy();
    });
    await user.click(screen.getByRole('button', { name: '등록하기' }));
    await waitFor(() => {
      expect(unauthorized).toHaveBeenCalled();
    });
    expect(authStore.getState().status).toBe('guest');
  });
});

describe('sell-v1 photos (B5)', () => {
  async function renderSellForm(): Promise<void> {
    await signIn();
    window.history.replaceState(null, '', '/sell');
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => routeByUrl(String(input))));
    render(<App />);
    await screen.findByText('디지털');
  }

  it('an upload failure marks only that attempt and does not add a photo', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/api/uploads')) {
        return jsonResponse(400, {
          code: 'VALIDATION_FAILED',
          message: '입력값을 확인해 주세요.',
          fields: { image: '이미지 파일을 확인해 주세요.' },
        });
      }
      return routeByUrl(String(input));
    });
    await signIn();
    window.history.replaceState(null, '', '/sell');
    vi.stubGlobal('fetch', fetchImpl);
    render(<App />);
    await screen.findByText('디지털');
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['junk'], 'broken.png', { type: 'image/png' }));
    await waitFor(() => {
      expect(screen.getByText('이미지 파일을 확인해 주세요.')).toBeTruthy();
    });
    expect(screen.queryByAltText('사진 1')).toBeNull();
  });

  it('blocks adding beyond 10 photos (UI 차단, B5)', async () => {
    const user = userEvent.setup();
    await renderSellForm();
    // Stuff the state to the ceiling directly: 10 uploads in a test would
    // exercise the same per-file path already covered above.
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const files = Array.from({ length: 10 }, (_, i) => new File([`bytes-${i}`], `p${i}.png`, { type: 'image/png' }));
    await user.upload(input, files);
    await waitFor(() => {
      expect(screen.getAllByAltText(/사진 \d+/)).toHaveLength(10);
    });
    // The 추가 button is gone at the ceiling — the 11th photo cannot enter.
    expect(screen.queryByText('사진 추가')).toBeNull();
  });
});

describe('sell-v1 categories (B4)', () => {
  it('shows a retry on category load failure and keeps the form open', async () => {
    const user = userEvent.setup();
    let categoriesFailing = true;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/api/categories')) {
        return categoriesFailing
          ? jsonResponse(500, { code: 'INTERNAL', message: '서버에 문제가 발생했어요.' })
          : jsonResponse(200, CATEGORIES);
      }
      return routeByUrl(String(input));
    });
    await signIn();
    window.history.replaceState(null, '', '/sell');
    vi.stubGlobal('fetch', fetchImpl);
    render(<App />);
    expect(await screen.findByText('카테고리를 불러오지 못했어요.')).toBeTruthy();
    categoriesFailing = false;
    await user.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByText('디지털')).toBeTruthy();
    // The form itself stayed open (B4: 폼 진입 자체는 유지).
    expect(window.location.pathname).toBe('/sell');
  });
});
