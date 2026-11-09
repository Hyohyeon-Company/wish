/**
 * API-level e2e of the §2-3 GET /api/products/{id} detail over real HTTP
 * with supertest (card C5): the public access boundary (no login), the
 * favorited contract — 로그인 bool / 비로그인 null — the stale-token-as-guest
 * observation, and the 404 NOT_FOUND for an unknown id. The soft-deleted
 * 404 is covered at unit level (product-detail.spec.ts): DELETE
 * /api/products/{id} itself is card C7's endpoint, so no API path can
 * produce a deleted product yet.
 */
import 'reflect-metadata';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

describe('GET /api/products/{id} (§2-3)', () => {
  let app: INestApplication;
  let server: Server;
  let sellerBearer: string;
  let viewerBearer: string;
  let productId: string;

  beforeAll(async () => {
    process.env.AUTH_TOKEN_TTL_SECONDS = '3600';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Server;

    const seller = await request(server)
      .post('/api/auth/signup')
      .send({
        email: `seller-${randomUUID()}@example.com`,
        password: 'Str0ng-Pass!',
        nickname: '샘플판매자',
        region: '사당동',
      })
      .expect(201);
    sellerBearer = seller.body.token as string;

    const viewer = await request(server)
      .post('/api/auth/signup')
      .send({
        email: `viewer-${randomUUID()}@example.com`,
        password: 'Str0ng-Pass!',
        nickname: '구경꾼',
        region: '논현동',
      })
      .expect(201);
    viewerBearer = viewer.body.token as string;

    const created = await request(server)
      .post('/api/products')
      .set('Authorization', `Bearer ${sellerBearer}`)
      .send({
        title: '원목 식탁 4인용',
        price: 120000,
        category_code: 'furniture',
        condition: 'like_new',
        description: '이사 가면서 판매합니다.',
        region: '사당동',
        image_urls: [
          'http://localhost:3000/uploads/table-1.png',
          'http://localhost:3000/uploads/table-2.png',
        ],
      })
      .expect(201);
    productId = created.body.product.id as string;
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers a guest with the full contract body and favorited null', async () => {
    const response = await request(server).get(`/api/products/${productId}`).expect(200);

    expect(response.body.favorited).toBeNull();
    const product = response.body.product as Record<string, unknown>;
    expect(Object.keys(product).sort()).toEqual([
      'category_code',
      'condition',
      'created_at',
      'description',
      'id',
      'images',
      'price',
      'region',
      'seller',
      'status',
      'title',
    ]);
    expect(product.id).toBe(productId);
    expect(product.title).toBe('원목 식탁 4인용');
    expect(product.price).toBe(120000);
    expect(product.category_code).toBe('furniture');
    expect(product.condition).toBe('like_new');
    expect(product.region).toBe('사당동');
    expect(product.status).toBe('ACTIVE');
    expect(product.seller).toMatchObject({ nickname: '샘플판매자', region: '사당동' });
    expect((product.images as Array<Record<string, unknown>>).map((i) => i.sort_order)).toEqual([
      1, 2,
    ]);
  });

  it('requires no login and no Authorization header (공개 화면, §3)', async () => {
    // Same request again without any auth material, asserting the status.
    await request(server).get(`/api/products/${productId}`).expect(200);
  });

  it('answers a logged-in viewer with favorited as a boolean', async () => {
    const response = await request(server)
      .get(`/api/products/${productId}`)
      .set('Authorization', `Bearer ${viewerBearer}`)
      .expect(200);
    // No favorites can exist yet (card C6 owns the writes) — the honest
    // boolean is false, never null for a live session.
    expect(response.body.favorited).toBe(false);
  });

  it('observes a stale/unknown token as a guest, not a 401 (공개 화면)', async () => {
    const response = await request(server)
      .get(`/api/products/${productId}`)
      .set('Authorization', 'Bearer not-a-real-token')
      .expect(200);
    expect(response.body.favorited).toBeNull();
  });

  it('answers an unknown id with the contract 404 NOT_FOUND body', async () => {
    const response = await request(server)
      .get(`/api/products/${randomUUID()}`)
      .expect(404);
    expect(response.body.code).toBe('NOT_FOUND');
    expect(typeof response.body.message).toBe('string');
  });

  it('answers a non-id path segment with the same 404 NOT_FOUND', async () => {
    const response = await request(server).get('/api/products/not-an-id').expect(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });
});
