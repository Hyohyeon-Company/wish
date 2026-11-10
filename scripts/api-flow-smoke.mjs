#!/usr/bin/env node
/**
 * wish API business-flow smoke test.
 *
 * Dependency-free Node ESM (global fetch, AbortSignal.timeout): no package is
 * installed and nothing is imported from the workspace, so the script can run
 * on a bare Node 24 shell against a composed container or a local API.
 *
 * It executes the approved 12-step flow in order, asserts the status code and
 * the required fields of every step, stops at the first failed assertion and
 * exits 1. Regardless of the outcome it prints one JSON summary document on
 * stdout (per-step method, path, observed status, expectation and failure
 * reason). The bearer token is never printed or stored in the summary.
 *
 * Usage:
 *   node scripts/api-flow-smoke.mjs
 *   WISH_BASE_URL=http://127.0.0.1:4000 node scripts/api-flow-smoke.mjs
 *
 * Environment:
 *   WISH_BASE_URL            API origin (default http://127.0.0.1:3000)
 *   WISH_SMOKE_TIMEOUT_MS    per-request timeout in ms (default 10000)
 *
 * Exit codes: 0 = all 12 steps passed, 1 = a step failed or the API was
 * unreachable.
 *
 * Repeatability: every run registers exactly one new member whose email *and*
 * nickname carry a per-run suffix. The MySQL schema enforces both
 * `uq_members_email` and `uq_members_nickname`, so a fixed nickname would make
 * the second run against a persistent volume fail at step 2 with
 * 400 VALIDATION_FAILED(fields.nickname). The suffix is short enough to keep
 * the nickname inside the 20-character domain limit.
 */

const BASE_URL = (process.env.WISH_BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.WISH_SMOKE_TIMEOUT_MS ?? '10000', 10);
const STARTED_AT = new Date();

/**
 * Per-run identity seed: base36 timestamp (8 chars) + 4 random hex chars.
 * 12 characters keeps `스모크판매자-<seed>` at 19 characters, under the
 * 20-character nickname bound, while making two consecutive runs distinct.
 */
const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;
const RUN_EMAIL = `wish-smoke-${RUN_ID}@example.com`;
const RUN_NICKNAME = `스모크판매자-${RUN_ID}`;

const steps = [];
const state = {
  /** @type {string | null} */ token: null,
  /** @type {string | null} */ email: null,
  /** @type {string | null} */ productId: null,
};

class SmokeFailure extends Error {}

function assert(condition, message) {
  if (!condition) throw new SmokeFailure(message);
}

/**
 * One HTTP call with a hard timeout. Returns the status plus the parsed JSON
 * body when the response carried one (204 responses have no body).
 */
async function call(method, path, options = {}) {
  const headers = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.token) headers.authorization = `Bearer ${options.token}`;

  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // `fetch` hides the underlying error in `cause`; surface its code so the
    // runbook's "API unreachable" branch is diagnosable (for example
    // ECONNREFUSED, ENOTFOUND, UND_ERR_CONNECT_TIMEOUT).
    const cause = error?.cause?.code ?? error?.cause?.message;
    const message = error instanceof Error ? error.message : String(error);
    throw new SmokeFailure(
      `${method} ${path} 요청에 실패했습니다: ${cause ? `${message} (${cause})` : message}`,
    );
  }

  const text = await response.text();
  let body = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new SmokeFailure(`${method} ${path} 응답이 JSON이 아닙니다: ${text.slice(0, 200)}`);
    }
  }
  return { method, path, status: response.status, body };
}

function expectStatus(response, allowed) {
  const statuses = Array.isArray(allowed) ? allowed : [allowed];
  assert(
    statuses.includes(response.status),
    `${response.method} ${response.path} 상태코드가 ${statuses.join('/')}가 아니라 ${response.status}입니다`,
  );
}

function expectErrorCode(response, code) {
  assert(
    response.body !== null && response.body.code === code,
    `${response.method} ${response.path} 오류 코드가 ${code}가 아니라 ${JSON.stringify(response.body)}입니다`,
  );
}

/**
 * Runs one numbered step, records the observed calls and rethrows on failure so
 * the caller stops the flow immediately.
 */
async function step(number, name, run) {
  const record = { step: number, name, ok: false, calls: [], detail: undefined };
  const trace = (method, path, status, expected) => {
    record.calls.push({ method, path, status, expected });
  };
  try {
    const detail = await run(trace);
    record.ok = true;
    if (detail !== undefined) record.detail = detail;
    steps.push(record);
    console.log(`[${number}/12] OK   ${name}`);
    return detail;
  } catch (error) {
    record.error = error instanceof SmokeFailure ? error.message : String(error?.stack ?? error);
    steps.push(record);
    console.error(`[${number}/12] FAIL ${name}`);
    console.error(`       ${record.error}`);
    throw error;
  }
}

function finish(ok) {
  const summary = {
    script: 'scripts/api-flow-smoke.mjs',
    base_url: BASE_URL,
    ok,
    started_at: STARTED_AT.toISOString(),
    finished_at: new Date().toISOString(),
    duration_ms: Date.now() - STARTED_AT.getTime(),
    steps_total: 12,
    steps_run: steps.length,
    steps_passed: steps.filter((entry) => entry.ok).length,
    steps,
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = ok ? 0 : 1;
}

async function runFlow() {
  await step(1, 'GET /api/categories → 200, 카테고리 코드 확보', async (trace) => {
    const response = await call('GET', '/api/categories');
    trace('GET', '/api/categories', response.status, 200);
    expectStatus(response, 200);
    assert(Array.isArray(response.body), '카테고리 응답이 배열이 아닙니다');
    assert(response.body.length >= 1, '카테고리가 1개 이상이어야 합니다');
    const first = response.body[0];
    assert(
      typeof first.code === 'string' && first.code.length > 0,
      '카테고리 code 값이 비어 있습니다',
    );
    assert(typeof first.display_order === 'number', '카테고리 display_order가 숫자가 아닙니다');
    return { category_code: first.code, category_count: response.body.length };
  });

  const categoryCode = steps[0].detail.category_code;

  await step(2, 'POST /api/auth/signup → 201, token 존재', async (trace) => {
    state.email = RUN_EMAIL;
    const response = await call('POST', '/api/auth/signup', {
      body: {
        email: state.email,
        password: 'Sm0ke-Passw0rd!',
        nickname: RUN_NICKNAME,
        region: '사당동',
      },
    });
    trace('POST', '/api/auth/signup', response.status, 201);
    expectStatus(response, 201);
    assert(
      response.body !== null && typeof response.body.token === 'string' && response.body.token.length > 0,
      '가입 응답에 token이 없습니다',
    );
    assert(
      response.body.member !== undefined && response.body.member.email === state.email,
      '가입 응답의 member.email이 요청한 이메일과 다릅니다',
    );
    state.token = response.body.token;
    return { email: state.email, nickname: RUN_NICKNAME, member_id: response.body.member.id };
  });

  await step(3, 'GET /api/auth/me (Bearer) → 200, 가입 이메일 일치', async (trace) => {
    const response = await call('GET', '/api/auth/me', { token: state.token });
    trace('GET', '/api/auth/me', response.status, 200);
    expectStatus(response, 200);
    assert(
      response.body !== null && response.body.member.email === state.email,
      'me 응답의 email이 가입 이메일과 다릅니다',
    );
    return { email: response.body.member.email };
  });

  await step(4, 'POST /api/products (Bearer) → 201, product.id 확보', async (trace) => {
    const response = await call('POST', '/api/products', {
      token: state.token,
      body: {
        title: '스모크 테스트 자전거',
        price: 42000,
        category_code: categoryCode,
        condition: 'used',
        description: '컨테이너 API 흐름 스모크에서 생성한 상품입니다.',
        region: '사당동',
        image_urls: ['http://localhost:3000/uploads/smoke-fixture.png'],
      },
    });
    trace('POST', '/api/products', response.status, 201);
    expectStatus(response, 201);
    assert(
      response.body !== null &&
        response.body.product !== undefined &&
        typeof response.body.product.id === 'string' &&
        response.body.product.id.length > 0,
      '상품 생성 응답에 product.id가 없습니다',
    );
    assert(
      response.body.product.status === 'ACTIVE',
      `신규 상품 상태가 ACTIVE가 아니라 ${response.body.product.status}입니다`,
    );
    state.productId = response.body.product.id;
    return { product_id: state.productId, status: response.body.product.status };
  });

  await step(5, 'GET /api/products → 200, 방금 상품 포함', async (trace) => {
    const response = await call('GET', '/api/products?limit=50');
    trace('GET', '/api/products?limit=50', response.status, 200);
    expectStatus(response, 200);
    assert(Array.isArray(response.body?.items), '상품 목록 응답에 items 배열이 없습니다');
    assert(
      response.body.items.some((item) => item.id === state.productId),
      '방금 생성한 상품이 목록에 없습니다',
    );
    return { total: response.body.total };
  });

  await step(6, 'GET /api/products/:id → 200, 단건 상세 일치', async (trace) => {
    const path = `/api/products/${state.productId}`;
    const response = await call('GET', path);
    trace('GET', path, response.status, 200);
    expectStatus(response, 200);
    assert(
      response.body?.product?.id === state.productId,
      '상세 응답의 product.id가 생성한 상품과 다릅니다',
    );
    assert(
      response.body.product.title === '스모크 테스트 자전거',
      '상세 응답의 title이 생성 요청과 다릅니다',
    );
    assert(
      response.body.favorited === null,
      `비로그인 상세의 favorited는 null이어야 하는데 ${JSON.stringify(response.body.favorited)}입니다`,
    );
    return { product_id: response.body.product.id };
  });

  await step(7, 'POST /api/favorites (Bearer) → 200/201, 찜 목록 포함', async (trace) => {
    const create = await call('POST', '/api/favorites', {
      token: state.token,
      body: { product_id: state.productId },
    });
    trace('POST', '/api/favorites', create.status, '200/201');
    expectStatus(create, [200, 201]);
    assert(create.body?.favorited === true, '찜 응답의 favorited가 true가 아닙니다');

    const list = await call('GET', '/api/favorites', { token: state.token });
    trace('GET', '/api/favorites', list.status, 200);
    expectStatus(list, 200);
    assert(Array.isArray(list.body?.items), '찜 목록 응답에 items 배열이 없습니다');
    assert(
      list.body.items.some((item) => item.id === state.productId),
      '찜한 상품이 찜 목록에 없습니다',
    );
    return { favorite_status: create.status, favorites_total: list.body.total };
  });

  await step(8, 'DELETE /api/favorites/:productId → 204, 목록에서 제거', async (trace) => {
    const path = `/api/favorites/${state.productId}`;
    const removed = await call('DELETE', path, { token: state.token });
    trace('DELETE', path, removed.status, 204);
    expectStatus(removed, 204);

    const list = await call('GET', '/api/favorites', { token: state.token });
    trace('GET', '/api/favorites', list.status, 200);
    expectStatus(list, 200);
    assert(
      !list.body.items.some((item) => item.id === state.productId),
      '찜 해제 후에도 찜 목록에 상품이 남아 있습니다',
    );
    return { favorites_total: list.body.total };
  });

  await step(9, 'GET /api/me/products → 200, 판매자 상품 포함', async (trace) => {
    const response = await call('GET', '/api/me/products', { token: state.token });
    trace('GET', '/api/me/products', response.status, 200);
    expectStatus(response, 200);
    assert(Array.isArray(response.body?.items), '내 상품 응답에 items 배열이 없습니다');
    assert(
      response.body.items.some((item) => item.id === state.productId),
      '판매자 상품 목록에 생성한 상품이 없습니다',
    );
    return { total: response.body.total };
  });

  await step(10, 'PATCH /api/products/:id/status → 200, 상태 변경 반영', async (trace) => {
    const path = `/api/products/${state.productId}/status`;
    const response = await call('PATCH', path, { token: state.token, body: { status: 'RESERVED' } });
    trace('PATCH', path, response.status, 200);
    expectStatus(response, 200);
    assert(
      response.body?.product?.status === 'RESERVED',
      `상태 변경 응답이 RESERVED가 아니라 ${JSON.stringify(response.body?.product?.status)}입니다`,
    );
    return { status: response.body.product.status };
  });

  await step(11, 'DELETE /api/products/:id → 204, 이후 상세 404', async (trace) => {
    const path = `/api/products/${state.productId}`;
    const removed = await call('DELETE', path, { token: state.token });
    trace('DELETE', path, removed.status, 204);
    expectStatus(removed, 204);

    const detail = await call('GET', path);
    trace('GET', path, detail.status, 404);
    expectStatus(detail, 404);
    expectErrorCode(detail, 'NOT_FOUND');
    return { deleted_product_id: state.productId };
  });

  await step(12, 'POST /api/auth/logout → 204, 같은 토큰 me 401', async (trace) => {
    const logout = await call('POST', '/api/auth/logout', { token: state.token });
    trace('POST', '/api/auth/logout', logout.status, 204);
    expectStatus(logout, 204);

    const me = await call('GET', '/api/auth/me', { token: state.token });
    trace('GET', '/api/auth/me', me.status, 401);
    expectStatus(me, 401);
    expectErrorCode(me, 'UNAUTHORIZED');
    return { token_revoked: true };
  });
}

let failure = null;
try {
  await runFlow();
} catch (error) {
  failure = error;
}
finish(failure === null);
