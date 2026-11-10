-- wish demo seed — the 현재 데이터 that makes the feed/search/detail screens
-- demonstrable on a fresh MySQL volume (plan C0 "Docker/MySQL 구성").
--
-- This is NOT a migration: it creates no schema and is applied on request
-- (`node dist/db/seed.js` or `docker compose exec api node dist/db/seed.js`),
-- never automatically at startup. Categories and the status-transition set are
-- reference data owned by migration 0001 and are not repeated here.
--
-- Recorded decisions:
-- - the seeded rows carry fixed UUIDs, so re-running the seed updates nothing
--   and never duplicates a listing (`ON DUPLICATE KEY UPDATE` no-op);
-- - `created_at` is relative to the seed run (`NOW(3) - INTERVAL n HOUR`) so a
--   freshly seeded feed shows a believable 최신순 order;
-- - the demo seller's password is `demo-pass-1234` (bcrypt hash below, cost
--   10). It exists only to make the demo listing attributable to a real member
--   row; change it or remove the demo member before any non-local use;
-- - demo image URLs point at an external placeholder service. The API stores
--   URLs, not bytes, so nothing else is needed for the feed/detail screens to
--   render a gallery; real local uploads replace them through POST /api/uploads.

INSERT INTO members (id, email, password_hash, nickname, region, created_at)
VALUES ('11111111-1111-4111-8111-111111111111', 'demo-seller@wish.local',
        '$2b$10$F6CH3/v.1f/MFkCp9K2yje2UueWLXmour.FHocuSH8MwGIbu/WRFK',
        '데모판매자', '서울 서초구', DATE_SUB(NOW(3), INTERVAL 30 DAY))
ON DUPLICATE KEY UPDATE id = id;

INSERT INTO products
  (id, seller_id, title, description, price, category_code, condition_code, region,
   status, created_at, updated_at, deleted_at, version)
VALUES
  ('0f1d0c00-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   '원목 4인 식탁', '이사하면서 판매합니다. 스크래치 거의 없고 튼튼합니다.',
   180000, 'furniture', 'like_new', '서울 서초구', 'ACTIVE',
   DATE_SUB(NOW(3), INTERVAL 1 HOUR), DATE_SUB(NOW(3), INTERVAL 1 HOUR), NULL, 0),
  ('0f1d0c00-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
   '무선 청소기', '배터리 교체 후 사용감 적습니다. 필터 새것으로 교체했습니다.',
   95000, 'digital', 'used', '서울 강남구', 'ACTIVE',
   DATE_SUB(NOW(3), INTERVAL 2 HOUR), DATE_SUB(NOW(3), INTERVAL 2 HOUR), NULL, 0),
  ('0f1d0c00-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111',
   '겨울 패딩 점퍼', '한 시즌 착용했습니다. 세탁 완료해서 보관 중입니다.',
   70000, 'fashion', 'like_new', '경기 성남시', 'RESERVED',
   DATE_SUB(NOW(3), INTERVAL 3 HOUR), DATE_SUB(NOW(3), INTERVAL 2 HOUR), NULL, 1),
  ('0f1d0c00-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111',
   '스킨케어 세트', '미개봉 정품입니다. 선물 받았는데 사용하지 않습니다.',
   32000, 'beauty', 'new', '인천 연수구', 'ACTIVE',
   DATE_SUB(NOW(3), INTERVAL 4 HOUR), DATE_SUB(NOW(3), INTERVAL 4 HOUR), NULL, 0),
  ('0f1d0c00-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111',
   '캠핑 의자 2개', '접이식 캠핑 의자 두 개 일괄 판매합니다. 거래 완료된 상품입니다.',
   25000, 'sports', 'used', '부산 해운대구', 'SOLD',
   DATE_SUB(NOW(3), INTERVAL 5 HOUR), DATE_SUB(NOW(3), INTERVAL 1 HOUR), NULL, 3),
  ('0f1d0c00-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111',
   '북유럽 책장', '원목 책장입니다. 모서리에 생활감 있는 사용감 있습니다.',
   45000, 'furniture', 'used', '서울 서초구', 'ACTIVE',
   DATE_SUB(NOW(3), INTERVAL 6 HOUR), DATE_SUB(NOW(3), INTERVAL 6 HOUR), NULL, 0),
  ('0f1d0c00-0000-4000-8000-000000000007', '11111111-1111-4111-8111-111111111111',
   '아이패드 에어', '케이스와 함께 드립니다. 액정 깨끗하고 배터리 성능 좋습니다.',
   420000, 'digital', 'like_new', '서울 강남구', 'ACTIVE',
   DATE_SUB(NOW(3), INTERVAL 7 HOUR), DATE_SUB(NOW(3), INTERVAL 7 HOUR), NULL, 0),
  ('0f1d0c00-0000-4000-8000-000000000008', '11111111-1111-4111-8111-111111111111',
   '데님 자켓', '오버핏 데님 자켓입니다. 거래 완료된 상품입니다.',
   38000, 'fashion', 'used', '경기 성남시', 'SOLD',
   DATE_SUB(NOW(3), INTERVAL 8 HOUR), DATE_SUB(NOW(3), INTERVAL 3 HOUR), NULL, 2),
  ('0f1d0c00-0000-4000-8000-000000000009', '11111111-1111-4111-8111-111111111111',
   '향수 50ml', '미개봉 향수입니다. 박스 포함입니다.',
   52000, 'beauty', 'new', '인천 연수구', 'ACTIVE',
   DATE_SUB(NOW(3), INTERVAL 9 HOUR), DATE_SUB(NOW(3), INTERVAL 9 HOUR), NULL, 0),
  ('0f1d0c00-0000-4000-8000-000000000010', '11111111-1111-4111-8111-111111111111',
   '등산 배낭 30L', '두 번 사용했습니다. 레인커버 포함입니다.',
   65000, 'sports', 'like_new', '부산 해운대구', 'RESERVED',
   DATE_SUB(NOW(3), INTERVAL 10 HOUR), DATE_SUB(NOW(3), INTERVAL 4 HOUR), NULL, 1),
  ('0f1d0c00-0000-4000-8000-000000000011', '11111111-1111-4111-8111-111111111111',
   '원목 협탁', '다리 하나가 흔들려서 직접 수리하실 분께 저렴하게 드립니다.',
   12000, 'furniture', 'needs_repair', '서울 서초구', 'ACTIVE',
   DATE_SUB(NOW(3), INTERVAL 11 HOUR), DATE_SUB(NOW(3), INTERVAL 11 HOUR), NULL, 0),
  ('0f1d0c00-0000-4000-8000-000000000012', '11111111-1111-4111-8111-111111111111',
   '블루투스 스피커', '음질 좋고 충전 케이블 포함입니다.',
   55000, 'digital', 'used', '서울 강남구', 'ACTIVE',
   DATE_SUB(NOW(3), INTERVAL 12 HOUR), DATE_SUB(NOW(3), INTERVAL 12 HOUR), NULL, 0)
ON DUPLICATE KEY UPDATE id = id;

INSERT INTO product_images (product_id, url, sort_order)
VALUES
  ('0f1d0c00-0000-4000-8000-000000000001', 'https://picsum.photos/seed/wish-demo-01/640/480', 1),
  ('0f1d0c00-0000-4000-8000-000000000002', 'https://picsum.photos/seed/wish-demo-02/640/480', 1),
  ('0f1d0c00-0000-4000-8000-000000000003', 'https://picsum.photos/seed/wish-demo-03/640/480', 1),
  ('0f1d0c00-0000-4000-8000-000000000004', 'https://picsum.photos/seed/wish-demo-04/640/480', 1),
  ('0f1d0c00-0000-4000-8000-000000000005', 'https://picsum.photos/seed/wish-demo-05/640/480', 1),
  ('0f1d0c00-0000-4000-8000-000000000006', 'https://picsum.photos/seed/wish-demo-06/640/480', 1),
  ('0f1d0c00-0000-4000-8000-000000000007', 'https://picsum.photos/seed/wish-demo-07/640/480', 1),
  ('0f1d0c00-0000-4000-8000-000000000008', 'https://picsum.photos/seed/wish-demo-08/640/480', 1),
  ('0f1d0c00-0000-4000-8000-000000000009', 'https://picsum.photos/seed/wish-demo-09/640/480', 1),
  ('0f1d0c00-0000-4000-8000-000000000010', 'https://picsum.photos/seed/wish-demo-10/640/480', 1),
  ('0f1d0c00-0000-4000-8000-000000000011', 'https://picsum.photos/seed/wish-demo-11/640/480', 1),
  ('0f1d0c00-0000-4000-8000-000000000012', 'https://picsum.photos/seed/wish-demo-12/640/480', 1)
ON DUPLICATE KEY UPDATE product_id = product_id;
