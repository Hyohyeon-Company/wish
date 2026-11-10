-- wish MySQL schema v1 — brief §6 도메인 개체 초안 + user-flow §2 계약 제약.
--
-- Applied by the API's migration entry point (`src/infrastructure/mysql/migrator.ts`,
-- `WISH_STORAGE=mysql` startup, or `node dist/db/migrate.js`) and recorded in
-- `schema_migrations`. The runner splits statements itself, so this file is a
-- plain sequence of statements (no client-side DELIMITER logic).
--
-- Recorded mapping decisions:
-- - ids are the application's UUID strings (CHAR(36)); `products.seq` and
--   `favorites.seq` are auto-increment tie-breakers so "최신순" stays stable
--   when two rows share a millisecond timestamp (the in-memory adapters use
--   their insertion sequence for the same purpose).
-- - DATETIME(3) columns are UTC; the adapter sets the connection timezone to
--   'Z' so a stored value round-trips as the same instant.
-- - `deleted_at` is the §6 soft-delete marker: every read path filters it out,
--   and the FK cascade on favorites is only a safety net (the API deletes a
--   product by writing deleted_at, so the cascade never fires for soft deletes).
-- - `product_status_transitions` persists the §6 상태 전이표 as data. The
--   Product aggregate remains the enforcing authority (a transition outside
--   this set is refused with 400 INVALID_TRANSITION before any write); the
--   table keeps the same set queryable from SQL surface for the verification
--   card and future reporting. A MySQL trigger was deliberately not used: it
--   would duplicate the domain rule with a different error surface (SQLSTATE →
--   500) and cannot be applied by a statement splitter without DELIMITER
--   handling.

CREATE TABLE IF NOT EXISTS categories (
  code VARCHAR(32) NOT NULL,
  name VARCHAR(30) NOT NULL,
  display_order TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (code),
  UNIQUE KEY uq_categories_name (name),
  KEY idx_categories_display_order (display_order),
  CONSTRAINT ck_categories_display_order CHECK (display_order > 0),
  CONSTRAINT ck_categories_name CHECK (CHAR_LENGTH(name) BETWEEN 1 AND 30)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS members (
  id CHAR(36) NOT NULL,
  email VARCHAR(254) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  nickname VARCHAR(20) NOT NULL,
  region VARCHAR(20) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_members_email (email),
  UNIQUE KEY uq_members_nickname (nickname),
  CONSTRAINT ck_members_email CHECK (CHAR_LENGTH(email) BETWEEN 3 AND 254),
  CONSTRAINT ck_members_nickname CHECK (CHAR_LENGTH(nickname) BETWEEN 1 AND 20),
  CONSTRAINT ck_members_region CHECK (CHAR_LENGTH(region) BETWEEN 1 AND 20),
  CONSTRAINT ck_members_password_hash CHECK (CHAR_LENGTH(password_hash) > 0)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS products (
  id CHAR(36) NOT NULL,
  seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  seller_id CHAR(36) NOT NULL,
  title VARCHAR(50) NOT NULL,
  description VARCHAR(1000) NOT NULL,
  price BIGINT UNSIGNED NOT NULL,
  category_code VARCHAR(32) NOT NULL,
  condition_code VARCHAR(20) NOT NULL,
  region VARCHAR(20) NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  deleted_at DATETIME(3) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_products_seq (seq),
  KEY idx_products_latest (created_at DESC, seq DESC),
  KEY idx_products_title (title),
  KEY idx_products_status (status),
  KEY idx_products_category_status (category_code, status),
  KEY idx_products_seller_latest (seller_id, created_at DESC, seq DESC),
  CONSTRAINT fk_products_seller FOREIGN KEY (seller_id) REFERENCES members (id),
  CONSTRAINT fk_products_category FOREIGN KEY (category_code) REFERENCES categories (code),
  CONSTRAINT ck_products_price CHECK (price > 0 AND price <= 9007199254740991),
  CONSTRAINT ck_products_title CHECK (CHAR_LENGTH(title) BETWEEN 1 AND 50),
  CONSTRAINT ck_products_description CHECK (CHAR_LENGTH(description) BETWEEN 1 AND 1000),
  CONSTRAINT ck_products_region CHECK (CHAR_LENGTH(region) BETWEEN 1 AND 20),
  CONSTRAINT ck_products_condition CHECK (condition_code IN ('new', 'like_new', 'used', 'needs_repair')),
  CONSTRAINT ck_products_status CHECK (status IN ('ACTIVE', 'RESERVED', 'SOLD'))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_images (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id CHAR(36) NOT NULL,
  url VARCHAR(2048) NOT NULL,
  sort_order TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_product_images_order (product_id, sort_order),
  CONSTRAINT fk_product_images_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE,
  CONSTRAINT ck_product_images_sort_order CHECK (sort_order BETWEEN 1 AND 10),
  CONSTRAINT ck_product_images_url CHECK (CHAR_LENGTH(url) BETWEEN 1 AND 2048)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS favorites (
  member_id CHAR(36) NOT NULL,
  product_id CHAR(36) NOT NULL,
  favorited_at DATETIME(3) NOT NULL,
  seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (member_id, product_id),
  UNIQUE KEY uq_favorites_seq (seq),
  KEY idx_favorites_member_recent (member_id, favorited_at DESC, seq DESC),
  KEY idx_favorites_product (product_id),
  CONSTRAINT fk_favorites_member FOREIGN KEY (member_id) REFERENCES members (id) ON DELETE CASCADE,
  CONSTRAINT fk_favorites_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_status_transitions (
  from_status VARCHAR(10) NOT NULL,
  to_status VARCHAR(10) NOT NULL,
  PRIMARY KEY (from_status, to_status),
  CONSTRAINT ck_transitions_from CHECK (from_status IN ('ACTIVE', 'RESERVED', 'SOLD')),
  CONSTRAINT ck_transitions_to CHECK (to_status IN ('ACTIVE', 'RESERVED', 'SOLD')),
  CONSTRAINT ck_transitions_distinct CHECK (from_status <> to_status)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- §6 전이표: 판매중→예약중, 판매중→거래완료, 예약중→판매중, 예약중→거래완료.
-- SOLD(거래완료) is the terminal state, so it has no outgoing row.
INSERT INTO product_status_transitions (from_status, to_status)
VALUES ('ACTIVE', 'RESERVED'), ('ACTIVE', 'SOLD'), ('RESERVED', 'ACTIVE'), ('RESERVED', 'SOLD')
ON DUPLICATE KEY UPDATE from_status = from_status;

-- Fixed flat category list — codes/labels/order mirror
-- apps/server/src/catalog/domain/category.ts (extracted from the approved
-- sell-v1 screen chips; user-flow §2-5-4).
INSERT INTO categories (code, name, display_order)
VALUES ('furniture', '가구/인테리어', 1), ('digital', '디지털', 2), ('fashion', '의류', 3),
       ('beauty', '뷰티', 4), ('sports', '스포츠/레저', 5)
ON DUPLICATE KEY UPDATE code = code;
