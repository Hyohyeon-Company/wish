/**
 * API-level e2e of the §2-3 GET /api/products listing over real HTTP with
 * supertest: the public access boundary (no login), the empty-list 200, the
 * latest-first order including the just-registered product as the first card
 * (AC4.3), paging, and the query 400 boundaries — alongside the untouched
 * POST contract.
 */
import 'reflect-metadata';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

describe('GET /api/products (§2-3)', () => {
  let app: INestApplication;
  let server: Server;
  let bearer: string;

  beforeAll(async () => {
    process.env.AUTH_TOKEN_TTL_SECONDS = '3600';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Server;

    const email = `seller-${randomUUID()}@example.com`;
    const signup = await request(server)
      .post('/api/auth/signup')
      .send({ email, password: 'Str0ng-Pass!', nickname: '판매자', region: '사당동' })
      .expect(201);
    bearer = signup.body.token;
  });

  afterAll(async () => {
    await app.close();
  });

  async function createListing(overrides: Record<string, unknown> = {}): Promise<string> {
    const response = await request(server)
      .post('/api/products')
      .set('Authorization', `Bearer ${bearer}`)
      .send({
        title: '아이패드 미니 6세대',
        price: 350000,
        category_code: 'digital',
        condition: 'like_new',
        description: '거의 사용하지 않은 상품입니다.',
        region: '사당동',
        image_urls: ['http://localhost:3000/uploads/listing.png'],
        ...overrides,
      })
      .expect(201);
    return response.body.product.id as string;
  }

  it('answers the public empty listing with the §2-0 page shape', async () => {
    const response = await request(server).get('/api/products').expect(200);
    expect(response.body).toEqual({ items: [], total: 0, page: 1, limit: 24 });
  });

  it('requires no login (비로그인 GET, §2-0) and no Authorization header', async () => {
    await createListing();
    const response = await request(server).get('/api/products').expect(200);
    expect(response.body.total).toBe(1);
    expect(Object.keys(response.body.items[0] ?? {}).sort()).toEqual([
      'condition',
      'created_at',
      'id',
      'price',
      'region',
      'status',
      'thumbnail_url',
      'title',
    ]);
    expect(response.body.items[0]?.status).toBe('ACTIVE');
    expect(response.body.items[0]?.thumbnail_url).toBe('http://localhost:3000/uploads/listing.png');
  });

  it('serves the most recently registered product as the first card (AC4.3)', async () => {
    const firstId = await createListing({ title: '먼저 등록한 상품' });
    const secondId = await createListing({ title: '방금 등록한 상품' });

    const response = await request(server).get('/api/products').expect(200);
    expect(response.body.total).toBe(3);
    expect(response.body.items[0]?.id).toBe(secondId);
    expect(response.body.items[1]?.id).toBe(firstId);
    expect(response.body.items[0]?.title).toBe('방금 등록한 상품');
    expect(response.body.items[1]?.title).toBe('먼저 등록한 상품');
  });

  it('pages with page/limit and echoes the effective page values', async () => {
    const response = await request(server)
      .get('/api/products?page=2&limit=2')
      .expect(200);
    expect(response.body.page).toBe(2);
    expect(response.body.limit).toBe(2);
    expect(response.body.total).toBe(3);
    expect(response.body.items).toHaveLength(1);
  });

  it('answers an unknown sort value with the contract 400 field error', async () => {
    const response = await request(server)
      .get('/api/products?sort=oldest')
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
    expect(response.body.fields).toEqual({ sort: '정렬 값을 확인해 주세요.' });
  });

  it('answers unknown category/status values with the contract 400 field errors', async () => {
    const category = await request(server)
      .get('/api/products?category=vehicles')
      .expect(400);
    expect(category.body.fields).toEqual({ category: '카테고리를 확인해 주세요.' });

    const status = await request(server)
      .get('/api/products?status=PAUSED')
      .expect(400);
    expect(status.body.fields).toEqual({ status: '상태 값을 확인해 주세요.' });
  });

  it('rejects an out-of-range limit with the contract 400 field error', async () => {
    const response = await request(server)
      .get('/api/products?limit=51')
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
    expect(response.body.fields).toEqual({ limit: 'limit은 1 이상 50 이하로 요청해 주세요.' });
  });

  it('filters by q as a case-insensitive partial title match', async () => {
    const response = await request(server)
      .get(`/api/products?q=${encodeURIComponent('방금')}`)
      .expect(200);
    expect(response.body.total).toBe(1);
    expect(response.body.items[0]?.title).toBe('방금 등록한 상품');
  });

  // -- C4 검색 슬라이스: 검색어 × 필터 조합·정렬 전환·특수문자 over real HTTP --

  it('narrows a keyword search by the category filter (A3+A4, AC2.2)', async () => {
    await createListing({ title: '레고 클래식 박스', category_code: 'digital' });
    await createListing({ title: '레고 호환 테이블', category_code: 'furniture' });

    const both = await request(server)
      .get(`/api/products?q=${encodeURIComponent('레고')}`)
      .expect(200);
    expect(both.body.total).toBe(2);

    const narrowed = await request(server)
      .get(`/api/products?q=${encodeURIComponent('레고')}&category=furniture`)
      .expect(200);
    expect(narrowed.body.total).toBe(1);
    expect(narrowed.body.items[0]?.title).toBe('레고 호환 테이블');
  });

  it('switching the sort value reorders the same filtered result (AC2.3)', async () => {
    await createListing({ title: '정렬시험 상품 A', price: 30000 });
    await createListing({ title: '정렬시험 상품 B', price: 10000 });
    await createListing({ title: '정렬시험 상품 C', price: 20000 });
    const q = encodeURIComponent('정렬시험');

    const asc = await request(server).get(`/api/products?q=${q}&sort=price_asc`).expect(200);
    expect(asc.body.items.map((item: { title: string }) => item.title)).toEqual([
      '정렬시험 상품 B',
      '정렬시험 상품 C',
      '정렬시험 상품 A',
    ]);

    const desc = await request(server).get(`/api/products?q=${q}&sort=price_desc`).expect(200);
    expect(desc.body.items.map((item: { title: string }) => item.title)).toEqual([
      '정렬시험 상품 A',
      '정렬시험 상품 C',
      '정렬시험 상품 B',
    ]);
  });

  it('answers a special-character keyword with a literal match and 200 (RF4)', async () => {
    await createListing({ title: 'C++ 입문서 (정품)' });

    const literal = await request(server)
      .get(`/api/products?q=${encodeURIComponent('C++')}`)
      .expect(200);
    expect(literal.body.total).toBe(1);
    expect(literal.body.items[0]?.title).toBe('C++ 입문서 (정품)');

    const pattern = await request(server)
      .get(`/api/products?q=${encodeURIComponent('.*')}`)
      .expect(200);
    expect(pattern.body.total).toBe(0);
    expect(pattern.body.items).toEqual([]);
  });

  it('treats an empty q as no filter at all (A3: 빈 검색어는 오류 아님)', async () => {
    const unfiltered = await request(server).get('/api/products').expect(200);
    const emptyQ = await request(server).get('/api/products?q=').expect(200);
    expect(emptyQ.body.total).toBe(unfiltered.body.total);
  });
});
