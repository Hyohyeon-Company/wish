/**
 * API-level e2e of the §2-4 favorites contract over real HTTP with supertest
 * (card C6): the 401 boundary for a 비로그인 caller on all three endpoints,
 * the idempotent POST (201 신규 / 200 이미 찜함), the idempotent 204 DELETE,
 * the GET listing (최신 찜순 ProductCards, 0건도 200), the 404 for favoriting
 * a missing product, and the detail's favorited personalization now served
 * by the real favorites adapter (the C5 seam replaced end to end).
 */
import 'reflect-metadata';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

describe('/api/favorites (§2-4)', () => {
  let app: INestApplication;
  let server: Server;
  let sellerBearer: string;
  let memberBearer: string;
  let otherBearer: string;
  let productIdA: string;
  let productIdB: string;

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
        description: '찜 슬라이스 샘플 상품입니다.',
        region: '사당동',
        image_urls: ['http://localhost:3000/uploads/fav-1.png'],
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
    memberBearer = await signUp('찜하는사람');
    otherBearer = await signUp('다른사람');
    productIdA = await createProduct(sellerBearer, '원목 의자');
    productIdB = await createProduct(sellerBearer, '원목 책상');
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers a 비로그인 POST with the contract 401 (AC6.3)', async () => {
    const response = await request(server)
      .post('/api/favorites')
      .send({ product_id: productIdA })
      .expect(401);
    expect(response.body).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('answers a 비로그인 DELETE with the contract 401', async () => {
    const response = await request(server)
      .delete(`/api/favorites/${productIdA}`)
      .expect(401);
    expect(response.body).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('answers a 비로그인 GET with the contract 401', async () => {
    const response = await request(server).get('/api/favorites').expect(401);
    expect(response.body).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('favorites a product with 201 and reflects it in the detail (favorited true)', async () => {
    await request(server)
      .post('/api/favorites')
      .set('Authorization', `Bearer ${memberBearer}`)
      .send({ product_id: productIdA })
      .expect(201)
      .expect({ favorited: true });

    const detail = await request(server)
      .get(`/api/products/${productIdA}`)
      .set('Authorization', `Bearer ${memberBearer}`)
      .expect(200);
    expect(detail.body.favorited).toBe(true);
  });

  it('re-favoriting is the idempotent 200, and a different member still sees 201', async () => {
    await request(server)
      .post('/api/favorites')
      .set('Authorization', `Bearer ${memberBearer}`)
      .send({ product_id: productIdA })
      .expect(200)
      .expect({ favorited: true });

    await request(server)
      .post('/api/favorites')
      .set('Authorization', `Bearer ${otherBearer}`)
      .send({ product_id: productIdA })
      .expect(201);
  });

  it('favoriting a missing product is the contract 404 NOT_FOUND', async () => {
    const response = await request(server)
      .post('/api/favorites')
      .set('Authorization', `Bearer ${memberBearer}`)
      .send({ product_id: '00000000-0000-0000-0000-000000000000' })
      .expect(404);
    expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a malformed body (missing/blank/non-string product_id) is the 400 field error', async () => {
    const bearer = memberBearer;
    const missing = await request(server)
      .post('/api/favorites')
      .set('Authorization', `Bearer ${bearer}`)
      .send({})
      .expect(400);
    expect(missing.body.code).toBe('VALIDATION_FAILED');
    expect(missing.body.fields).toHaveProperty('product_id');

    const blank = await request(server)
      .post('/api/favorites')
      .set('Authorization', `Bearer ${bearer}`)
      .send({ product_id: '   ' })
      .expect(400);
    expect(blank.body.fields).toHaveProperty('product_id');

    const wrongType = await request(server)
      .post('/api/favorites')
      .set('Authorization', `Bearer ${bearer}`)
      .send({ product_id: 42 })
      .expect(400);
    expect(wrongType.body.fields).toHaveProperty('product_id');
  });

  it('the GET listing answers 최신 찜순 ProductCards with the §2-0 envelope', async () => {
    // other already favorited A (idempotent-200 test above); favoriting B now
    // puts B first — 최신 찜순.
    await request(server)
      .post('/api/favorites')
      .set('Authorization', `Bearer ${otherBearer}`)
      .send({ product_id: productIdB })
      .expect(201);

    const response = await request(server)
      .get('/api/favorites')
      .set('Authorization', `Bearer ${otherBearer}`)
      .expect(200);

    expect(response.body).toMatchObject({ total: 2, page: 1, limit: 24 });
    expect(response.body.items).toHaveLength(2);
    expect(response.body.items[0]).toMatchObject({
      id: productIdB,
      title: '원목 책상',
      price: 45000,
      region: '사당동',
      status: 'ACTIVE',
      condition: 'like_new',
      thumbnail_url: 'http://localhost:3000/uploads/fav-1.png',
    });
    expect(Object.keys(response.body.items[0]).sort()).toEqual([
      'condition',
      'created_at',
      'id',
      'price',
      'region',
      'status',
      'thumbnail_url',
      'title',
    ]);
  });

  it('orders the listing newest favorite first across two products', async () => {
    // member has A (from the earlier 201). Favoriting B now puts B first.
    await request(server)
      .post('/api/favorites')
      .set('Authorization', `Bearer ${memberBearer}`)
      .send({ product_id: productIdB })
      .expect(201);

    const response = await request(server)
      .get('/api/favorites')
      .set('Authorization', `Bearer ${memberBearer}`)
      .expect(200);

    expect(response.body.total).toBe(2);
    expect(response.body.items.map((item: { id: string }) => item.id)).toEqual([
      productIdB,
      productIdA,
    ]);
  });

  it('an empty favorites list is a 200 with items [] and total 0', async () => {
    const fresh = await signUp('새로운사람');
    const response = await request(server)
      .get('/api/favorites')
      .set('Authorization', `Bearer ${fresh}`)
      .expect(200);
    expect(response.body).toEqual({ items: [], total: 0, page: 1, limit: 24 });
  });

  it('an out-of-range limit is the 400 field error', async () => {
    const response = await request(server)
      .get('/api/favorites?limit=51')
      .set('Authorization', `Bearer ${memberBearer}`)
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
    expect(response.body.fields).toHaveProperty('limit');
  });

  it('unfavoriting answers 204 and the listing/detail drop the product', async () => {
    await request(server)
      .delete(`/api/favorites/${productIdB}`)
      .set('Authorization', `Bearer ${memberBearer}`)
      .expect(204);

    const response = await request(server)
      .get('/api/favorites')
      .set('Authorization', `Bearer ${memberBearer}`)
      .expect(200);
    expect(response.body.total).toBe(1);
    expect(response.body.items.map((item: { id: string }) => item.id)).toEqual([productIdA]);

    const detail = await request(server)
      .get(`/api/products/${productIdB}`)
      .set('Authorization', `Bearer ${memberBearer}`)
      .expect(200);
    expect(detail.body.favorited).toBe(false);
  });

  it('DELETE is idempotent — a repeat call and an unknown product id both answer 204', async () => {
    await request(server)
      .delete(`/api/favorites/${productIdB}`)
      .set('Authorization', `Bearer ${memberBearer}`)
      .expect(204);
    await request(server)
      .delete('/api/favorites/no-such-product')
      .set('Authorization', `Bearer ${memberBearer}`)
      .expect(204);
  });
});
