/**
 * API-level e2e of the auth slice: the §2-1 contract exercised over real
 * HTTP with supertest — signup → logout → re-login (AC5.1), generalized
 * login failure (AC5.2), hash-only responses, guard denials.
 */
import 'reflect-metadata';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

const SIGNUP = {
  email: 'seller@example.com',
  password: 'Str0ng-Pass!',
  nickname: '판매자',
  region: '서울',
};

describe('POST /api/auth/signup', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    process.env.AUTH_TOKEN_TTL_SECONDS = '3600';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  function signup(body: unknown) {
    return request(server).post('/api/auth/signup').send(body as Record<string, unknown>);
  }

  it('creates a member and returns member + token per the §2-1 contract', async () => {
    const response = await signup(SIGNUP).expect(201);
    expect(Object.keys(response.body)).toEqual(['member', 'token']);
    expect(Object.keys(response.body.member)).toEqual([
      'id',
      'email',
      'nickname',
      'region',
      'created_at',
    ]);
    expect(response.body.member.email).toBe(SIGNUP.email);
    expect(typeof response.body.token).toBe('string');
    expect(response.body.token.length).toBeGreaterThan(20);
    // No credential material in the response, ever (AC5.3).
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain(SIGNUP.password);
    expect(serialized.toLowerCase()).not.toContain('password_hash');
  });

  it('refuses a duplicate email with 409 EMAIL_TAKEN (AC5.1)', async () => {
    const response = await signup({ ...SIGNUP, nickname: '다른사람' }).expect(409);
    expect(response.body).toEqual({
      code: 'EMAIL_TAKEN',
      message: '이미 가입된 이메일이에요.',
    });
  });

  it('reports field-level 400 validation errors', async () => {
    const response = await signup({ email: 'nope', password: 'short' }).expect(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
    expect(Object.keys(response.body.fields).sort()).toEqual([
      'email',
      'nickname',
      'password',
      'region',
    ]);
  });

  it('rejects non-object bodies with the contract 400 shape', async () => {
    const response = await signup('not-an-object').expect(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
  });
});

describe('auth session lifecycle (signup → logout → re-login, AC5.1)', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    process.env.AUTH_TOKEN_TTL_SECONDS = '3600';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('walks the full lifecycle with correct status codes', async () => {
    const agent = request(server);

    // 1. signup → 201 with token (auto session after signup, B1).
    const signupResponse = await agent
      .post('/api/auth/signup')
      .send({ ...SIGNUP, email: 'lifecycle@example.com' })
      .expect(201);
    const signupToken = signupResponse.body.token as string;
    const memberId = signupResponse.body.member.id as string;

    // 2. me with the signup token → 200, same member.
    const meResponse = await agent
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${signupToken}`)
      .expect(200);
    expect(meResponse.body).toEqual({ member: signupResponse.body.member });
    expect(meResponse.body.member.id).toBe(memberId);

    // 3. logout → 204, and the session is really gone afterwards.
    await agent.post('/api/auth/logout').set('Authorization', `Bearer ${signupToken}`).expect(204);
    await agent
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${signupToken}`)
      .expect(401);

    // 4. re-login → 200 with a working token.
    const loginResponse = await agent
      .post('/api/auth/login')
      .send({ email: 'Lifecycle@Example.com', password: SIGNUP.password })
      .expect(200);
    expect(loginResponse.body.member.id).toBe(memberId);
    expect(loginResponse.body.token).not.toBe(signupToken);
    await agent
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${loginResponse.body.token}`)
      .expect(200)
      .expect((res) => expect(res.body.member.email).toBe('lifecycle@example.com'));
  });
});

describe('POST /api/auth/login — generalized failure (AC5.2)', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    process.env.AUTH_TOKEN_TTL_SECONDS = '3600';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Server;
    await request(server).post('/api/auth/signup').send(SIGNUP).expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  const expectGeneralized401 = async (body: Record<string, unknown>) => {
    const response = await request(server).post('/api/auth/login').send(body).expect(401);
    expect(response.body).toEqual({
      code: 'UNAUTHORIZED',
      message: '이메일 또는 비밀번호가 올바르지 않아요.',
    });
    return response.body;
  };

  it('answers unknown email and wrong password with the identical body', async () => {
    const unknownEmail = await expectGeneralized401({
      email: 'nobody@example.com',
      password: SIGNUP.password,
    });
    const wrongPassword = await expectGeneralized401({
      email: SIGNUP.email,
      password: 'Definitely-Wrong-9',
    });
    expect(unknownEmail).toEqual(wrongPassword);
  });

  it('logs in with correct credentials and a case-insensitive email', async () => {
    const response = await request(server)
      .post('/api/auth/login')
      .send({ email: '  SELLER@example.com ', password: SIGNUP.password })
      .expect(200);
    expect(response.body.member.email).toBe(SIGNUP.email);
    expect(typeof response.body.token).toBe('string');
  });
});

describe('protected endpoints without/with broken credentials', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    process.env.AUTH_TOKEN_TTL_SECONDS = '3600';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('denies GET /api/auth/me without a token with 401 UNAUTHORIZED', async () => {
    const response = await request(server).get('/api/auth/me').expect(401);
    expect(response.body).toEqual({ code: 'UNAUTHORIZED', message: '로그인이 필요해요.' });
  });

  it('denies GET /api/auth/me with a garbage bearer token', async () => {
    const response = await request(server)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer garbage-token')
      .expect(401);
    expect(response.body).toEqual({ code: 'UNAUTHORIZED', message: '로그인이 필요해요.' });
  });

  it('denies GET /api/auth/me with a malformed authorization header', async () => {
    const response = await request(server)
      .get('/api/auth/me')
      .set('Authorization', 'Token abc')
      .expect(401);
    expect(response.body).toEqual({ code: 'UNAUTHORIZED', message: '로그인이 필요해요.' });
  });

  it('denies POST /api/auth/logout without a token', async () => {
    const response = await request(server).post('/api/auth/logout').expect(401);
    expect(response.body).toEqual({ code: 'UNAUTHORIZED', message: '로그인이 필요해요.' });
  });
});
