/**
 * HTTP client for the §2-0/§2-1 API contract (user-flow-v1).
 *
 * Error responses are consumed in their contract shape
 * `{ code, message, fields? }` — `fields` appears on 400 only, so a 409
 * EMAIL_TAKEN body legitimately has no fields (C1 review observation: the
 * Frontend owns that mapping, not the server).
 *
 * 401 policy (the card's "401 미로그인 유도" requirement): a 401 from a
 * protected endpoint clears the local session and routes to the login screen
 * with a `returnTo` parameter so the member can come back (AC4.1). The login
 * submit itself opts out — there, 401 is the generalized wrong-credentials
 * form error (AC5.2), not a redirect trigger.
 */

export const NETWORK_ERROR_MESSAGE = '네트워크 연결을 확인해 주세요.';

export interface ErrorBody {
  readonly code: string;
  readonly message: string;
  readonly fields?: Readonly<Record<string, string>>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Field-level errors from a 400 body; empty for every other status. */
  readonly fields: Readonly<Record<string, string>>;
  /** True when the request never produced an HTTP response. */
  readonly network: boolean;

  constructor(status: number, code: string, message: string, options: {
    fields?: Readonly<Record<string, string>>;
    network?: boolean;
  } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = options.fields ?? {};
    this.network = options.network ?? false;
  }
}

/** Called when a protected endpoint answers 401 under the 'session' policy. */
export type UnauthorizedHandler = () => void;

let unauthorizedHandler: UnauthorizedHandler | null = null;

/** Composition root wires this to the auth store; tests inject their own. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

export interface RequestOptions {
  readonly method?: string;
  readonly body?: unknown;
  readonly token?: string | null;
  /**
   * 'session' (default): 401 clears the session and routes to login.
   * 'error': 401 is surfaced as a plain ApiError to the caller.
   */
  readonly unauthorized?: 'session' | 'error';
  readonly fetchImpl?: typeof fetch;
  readonly baseUrl?: string;
}

export interface ApiResponse<T> {
  readonly status: number;
  readonly body: T;
}

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(response.status, 'INTERNAL', '서버에 문제가 발생했어요.');
  }
}

function errorFrom(status: number, body: unknown): ApiError {
  if (
    body !== null && typeof body === 'object' &&
    typeof (body as ErrorBody).code === 'string' &&
    typeof (body as ErrorBody).message === 'string'
  ) {
    const parsed = body as ErrorBody;
    return new ApiError(status, parsed.code, parsed.message, {
      fields: status === 400 ? (parsed.fields ?? {}) : {},
    });
  }
  // A non-contract error body is still an HTTP failure; sanitize it.
  return new ApiError(status, 'INTERNAL', '서버에 문제가 발생했어요.');
}

export async function request<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<ApiResponse<T>> {
  const doFetch = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`;

  let response: Response;
  try {
    response = await doFetch(`${options.baseUrl ?? BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', NETWORK_ERROR_MESSAGE, { network: true });
  }

  const body = await parseBody(response);
  if (!response.ok) {
    const error = errorFrom(response.status, body);
    if (response.status === 401 && (options.unauthorized ?? 'session') === 'session') {
      if (unauthorizedHandler !== null) unauthorizedHandler();
    }
    throw error;
  }
  return { status: response.status, body: body as T };
}
