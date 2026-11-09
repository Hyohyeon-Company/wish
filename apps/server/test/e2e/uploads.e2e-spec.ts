/**
 * API-level e2e of the upload boundary (§2-2) over real HTTP with supertest:
 * the oversize image must end in the contract's 400 VALIDATION_FAILED with
 * `fields.image` — regardless of which layer (multer's byte ceiling or the
 * use case's re-check) catches it first — plus the guard and happy path.
 */
import 'reflect-metadata';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { MAX_UPLOAD_BYTES } from '../../src/products/application/product-use-cases';

/** Minimal valid 1×1 PNG (67 bytes): the happy-path format probe accepts it. */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('POST /api/uploads (§2-2)', () => {
  let app: INestApplication;
  let server: Server;
  let bearer: string;

  beforeAll(async () => {
    process.env.AUTH_TOKEN_TTL_SECONDS = '3600';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Server;

    const email = `uploader-${randomUUID()}@example.com`;
    const signup = await request(server)
      .post('/api/auth/signup')
      .send({ email, password: 'Str0ng-Pass!', nickname: '업로더', region: '서울' })
      .expect(201);
    bearer = signup.body.token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers an unauthenticated upload with 401 UNAUTHORIZED', async () => {
    const response = await request(server)
      .post('/api/uploads')
      .attach('image', TINY_PNG, 'tiny.png')
      .expect(401);
    expect(response.body.code).toBe('UNAUTHORIZED');
  });

  it('translates an oversize image into the contract 400 with fields.image', async () => {
    const oversize = Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0x61);
    const response = await request(server)
      .post('/api/uploads')
      .set('Authorization', `Bearer ${bearer}`)
      .attach('image', oversize, 'big.png')
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
    expect(response.body.fields).toEqual({
      image: '이미지 용량이 너무 커요. 10MB 이하로 올려주세요.',
    });
  });

  it('stores a valid small image and returns the §2-2 view shape', async () => {
    const response = await request(server)
      .post('/api/uploads')
      .set('Authorization', `Bearer ${bearer}`)
      .attach('image', TINY_PNG, 'tiny.png')
      .expect(201);
    expect(Object.keys(response.body)).toEqual(['url', 'width', 'height', 'size']);
    expect(response.body.url).toMatch(/^\/uploads\//);
    expect(response.body.width).toBe(1);
    expect(response.body.height).toBe(1);
    expect(response.body.size).toBe(TINY_PNG.length);
  });
});
