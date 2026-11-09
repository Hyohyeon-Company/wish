/**
 * API-level e2e of the C7 contract over real HTTP with supertest:
 * §2-3 PATCH /api/products/{id}/status (401 boundary, 403 본인 아님,
 * 404 없음·삭제됨, 전이표 happy path 판매중⇄예약중→거래완료, 표 밖 400
 * INVALID_TRANSITION, unknown status 400) and §2-3 DELETE /api/products/{id}
 * (204, 찜 정리 AC6.2, 403, repeat-delete 404), plus §2-4 GET
 * /api/me/products (own rows only, status filter).
 */
import 'reflect-metadata';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

describe('/api/products/{id} status & deletion (§2-3, card C7)', () => {
  let app: INestApplication;
  let server: Server;
  let sellerBearer: string;
  let otherBearer: string;
  let productId: string;

  async function signUp(nickname: string): Promise<string> {
    const response = await request(server)
      .post('/api/auth/signup')
      .send({
        email: `${nickname.toLowerCase()}-${randomUUID()}@example.com`,
        password: 'Str0ng-Pass!',
        nickname,
        region: '사당동',
      })
      .expect(201);
    return response.body.token as string;
  }

  async function createProduct(bearer: string, title: string): Promise<string> {
    const response = await request(server)
      .post('/api/products')
      .set('Authorization', `Bearer ${bearer}`)
      .send({
        title,
        price: 45000,
        category_code: 'furniture',
        condition: 'like_new',
        description: 'C7 슬라이스 샘플 상품입니다.',
        region: '사당동',
        image_urls: ['http://localhost:3000/uploads/c7-1.png'],
      })
      .expect(201);
    return response.body.product.id as string;
  }

  beforeAll(async () => {
    process.env.AUTH_TOKEN_TTL_SECONDS = '3600';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Server;
    sellerBearer = await signUp('판매자');
    otherBearer = await signUp('타인');
    productId = await createProduct(sellerBearer, '원목 의자');
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers a 비로그인 PATCH and DELETE with the contract 401', async () => {
    const patched = await request(server)
      .patch(`/api/products/${productId}/status`)
      .send({ status: 'RESERVED' })
      .expect(401);
    expect(patched.body).toMatchObject({ code: 'UNAUTHORIZED' });
    const deleted = await request(server)
      .delete(`/api/products/${productId}`)
      .expect(401);
    expect(deleted.body).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('refuses a non-owner status change with 403 FORBIDDEN (AC7.1)', async () => {
    const response = await request(server)
      .patch(`/api/products/${productId}/status`)
      .set('Authorization', `Bearer ${otherBearer}`)
      .send({ status: 'RESERVED' })
      .expect(403);
    expect(response.body).toMatchObject({ code: 'FORBIDDEN' });
    const detail = await request(server).get(`/api/products/${productId}`).expect(200);
    expect(detail.body.product.status).toBe('ACTIVE');
  });

  it('refuses a non-owner deletion with 403 FORBIDDEN', async () => {
    await request(server)
      .delete(`/api/products/${productId}`)
      .set('Authorization', `Bearer ${otherBearer}`)
      .expect(403);
    await request(server).get(`/api/products/${productId}`).expect(200);
  });

  it('walks the §6 전이표: 판매중→예약중→판매중 and finally 거래완료 (AC7.2)', async () => {
    const toReserved = await request(server)
      .patch(`/api/products/${productId}/status`)
      .set('Authorization', `Bearer ${sellerBearer}`)
      .send({ status: 'RESERVED' })
      .expect(200);
    expect(toReserved.body.product.status).toBe('RESERVED');

    const backToActive = await request(server)
      .patch(`/api/products/${productId}/status`)
      .set('Authorization', `Bearer ${sellerBearer}`)
      .send({ status: 'ACTIVE' })
      .expect(200);
    expect(backToActive.body.product.status).toBe('ACTIVE');

    const toSold = await request(server)
      .patch(`/api/products/${productId}/status`)
      .set('Authorization', `Bearer ${sellerBearer}`)
      .send({ status: 'SOLD' })
      .expect(200);
    expect(toSold.body.product.status).toBe('SOLD');
  });

  it('refuses the terminal-state reversal with 400 INVALID_TRANSITION (B11, 직접 API 호출 포함)', async () => {
    const response = await request(server)
      .patch(`/api/products/${productId}/status`)
      .set('Authorization', `Bearer ${sellerBearer}`)
      .send({ status: 'ACTIVE' })
      .expect(400);
    expect(response.body).toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('refuses an unknown status value with 400 VALIDATION_FAILED fields.status', async () => {
    const response = await request(server)
      .patch(`/api/products/${productId}/status`)
      .set('Authorization', `Bearer ${sellerBearer}`)
      .send({ status: '판매중' })
      .expect(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(response.body.fields).toMatchObject({ status: expect.any(String) });
  });

  it('answers 404 for a status change on an unknown product', async () => {
    await request(server)
      .patch('/api/products/no-such-id/status')
      .set('Authorization', `Bearer ${sellerBearer}`)
      .send({ status: 'RESERVED' })
      .expect(404);
  });

  it('lists the seller’s own products with status via GET /api/me/products and filters', async () => {
    const list = await request(server)
      .get('/api/me/products')
      .set('Authorization', `Bearer ${sellerBearer}`)
      .expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0]).toMatchObject({ id: productId, status: 'SOLD' });

    const filtered = await request(server)
      .get('/api/me/products?status=ACTIVE')
      .set('Authorization', `Bearer ${sellerBearer}`)
      .expect(200);
    expect(filtered.body.total).toBe(0);

    // 타인의 상품은 부재
    const otherList = await request(server)
      .get('/api/me/products')
      .set('Authorization', `Bearer ${otherBearer}`)
      .expect(200);
    expect(otherList.body.total).toBe(0);
  });

  it('deletes with 204, removes the product from detail/search AND cleans the favorites (AC6.2)', async () => {
    // A member favorites the product first, then the seller deletes it.
    await request(server)
      .post('/api/favorites')
      .set('Authorization', `Bearer ${otherBearer}`)
      .send({ product_id: productId })
      .expect(201);

    await request(server)
      .delete(`/api/products/${productId}`)
      .set('Authorization', `Bearer ${sellerBearer}`)
      .expect(204);

    // 목록·상세에서 즉시 제외 (AC3.2)
    await request(server).get(`/api/products/${productId}`).expect(404);
    const feed = await request(server)
      .get('/api/products?page=1&limit=24&sort=latest')
      .expect(200);
    expect(feed.body.items.some((item: { id: string }) => item.id === productId)).toBe(false);

    // 찜 목록에서도 소멸 (AC6.2)
    const favorites = await request(server)
      .get('/api/favorites?page=1&limit=24')
      .set('Authorization', `Bearer ${otherBearer}`)
      .expect(200);
    expect(favorites.body.items.some((item: { id: string }) => item.id === productId)).toBe(false);

    // my 목록에서도 제외
    const mine = await request(server)
      .get('/api/me/products')
      .set('Authorization', `Bearer ${sellerBearer}`)
      .expect(200);
    expect(mine.body.total).toBe(0);
  });

  it('observes a repeated DELETE as the contract 404, not idempotent success (B12)', async () => {
    const response = await request(server)
      .delete(`/api/products/${productId}`)
      .set('Authorization', `Bearer ${sellerBearer}`)
      .expect(404);
    expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});
