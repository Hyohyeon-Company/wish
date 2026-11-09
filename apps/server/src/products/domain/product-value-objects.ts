/**
 * Value objects of the Product aggregate. Each is hard to construct
 * invalidly: parsing either yields a normalized valid value or a field-scoped
 * validation failure (the same FieldValidation mechanism as the Member
 * aggregate), so the contract's 400-with-fields body is produced by the
 * domain, not the controller (user-flow §2-0/§2-3).
 *
 * Recorded bounds (user-flow §2-5-4, extracted from the sell-v1 screen):
 * - title ≤ 50 characters (the screen's maxlength=50 counter),
 * - description ≤ 1,000 characters (the screen's counter note),
 * - price is a positive integer in 원 (contract §2-3: 가격 양의 정수 아님 → 400),
 * - condition is the fixed four-value set from the screen's 상품상태 chips.
 */
import { DomainError } from '../../shared/domain-error';
import { findCategory } from '../../catalog/domain/category';
import { FieldValidation, fieldFailure } from './product-field-validation';

export class ProductTitle {
  private constructor(readonly value: string) {}

  static parse(raw: unknown): ProductTitle {
    if (typeof raw !== 'string') {
      fieldFailure('title', '제목을 입력해 주세요.');
    }
    const value = raw.trim();
    if (value.length < 1 || value.length > 50) {
      fieldFailure('title', '제목은 1자 이상 50자 이하로 입력해 주세요.');
    }
    return new ProductTitle(value);
  }
}

export class ProductPrice {
  private constructor(readonly value: number) {}

  static parse(raw: unknown): ProductPrice {
    if (typeof raw !== 'number' || !Number.isInteger(raw)) {
      fieldFailure('price', '가격은 숫자로 입력해 주세요.');
    }
    if (raw <= 0 || raw > Number.MAX_SAFE_INTEGER) {
      fieldFailure('price', '가격은 1원 이상으로 입력해 주세요.');
    }
    return new ProductPrice(raw);
  }
}

export class ProductDescription {
  private constructor(readonly value: string) {}

  static parse(raw: unknown): ProductDescription {
    if (typeof raw !== 'string') {
      fieldFailure('description', '설명을 입력해 주세요.');
    }
    const value = raw.trim();
    if (value.length < 1 || value.length > 1000) {
      fieldFailure('description', '설명은 1자 이상 1,000자 이하로 입력해 주세요.');
    }
    return new ProductDescription(value);
  }
}

export class ProductRegion {
  private constructor(readonly value: string) {}

  static parse(raw: unknown): ProductRegion {
    if (typeof raw !== 'string') {
      fieldFailure('region', '거래 지역을 입력해 주세요.');
    }
    const value = raw.trim();
    if (value.length < 1 || value.length > 20) {
      fieldFailure('region', '거래 지역은 1자 이상 20자 이하로 입력해 주세요.');
    }
    return new ProductRegion(value);
  }
}

/**
 * 상품상태 (physical condition) — distinct from the sales status badge
 * (판매중/예약중/거래완료). Codes mirror the sell-v1 chips in screen order;
 * the Korean labels stay in the screen, not in the API.
 */
export const CONDITION_CODES = ['new', 'like_new', 'used', 'needs_repair'] as const;
export type ConditionCode = (typeof CONDITION_CODES)[number];

export class ProductCondition {
  private constructor(readonly value: ConditionCode) {}

  static parse(raw: unknown): ProductCondition {
    if (
      typeof raw !== 'string' ||
      !(CONDITION_CODES as readonly string[]).includes(raw)
    ) {
      fieldFailure('condition', '상품 상태를 선택해 주세요.');
    }
    return new ProductCondition(raw as ConditionCode);
  }
}

/**
 * The 1..10 image list of one product (brief §6 ProductImage, AC4.2).
 * Array order IS the display order: index 0 becomes sort_order 1 and is the
 * 대표 이미지 (sell screen: "첫 번째 사진이 대표 이미지입니다").
 */
export class ProductImageList {
  private constructor(readonly urls: readonly string[]) {}

  static parse(raw: unknown): ProductImageList {
    if (!Array.isArray(raw)) {
      fieldFailure('image_urls', '사진을 1장 이상 추가해 주세요.');
    }
    const urls: string[] = [];
    for (const entry of raw) {
      if (typeof entry !== 'string') {
        fieldFailure('image_urls', '이미지 주소 형식을 확인해 주세요.');
      }
      const value = entry.trim();
      if (value.length === 0 || value.length > 2048) {
        fieldFailure('image_urls', '이미지 주소 형식을 확인해 주세요.');
      }
      urls.push(value);
    }
    if (urls.length < 1 || urls.length > 10) {
      fieldFailure('image_urls', '사진은 1장 이상 10장 이하로 등록해 주세요.');
    }
    return new ProductImageList(urls);
  }

  /** duplicates would render as repeated gallery entries — refused up front. */
  static assertNoDuplicates(urls: readonly string[]): void {
    if (new Set(urls).size !== urls.length) {
      throw new FieldValidation('image_urls', '같은 사진이 중복되었어요.');
    }
  }
}

/** Unknown category code is a field failure on `category_code` (§2-3 400). */
export function parseCategoryCode(raw: unknown): string {
  const category = findCategory(raw);
  if (category === null) {
    fieldFailure('category_code', '카테고리를 선택해 주세요.');
  }
  return category.code;
}

export interface ProductCreationFields {
  readonly title: ProductTitle;
  readonly price: ProductPrice;
  readonly categoryCode: string;
  readonly condition: ProductCondition;
  readonly description: ProductDescription;
  readonly region: ProductRegion;
  readonly imageUrls: readonly string[];
}

/**
 * Parses every sell-form field at once and aggregates the failures into the
 * single contract 400 body (mirrors member-value-objects.requireFields).
 */
export function requireProductFields(
  read: (collect: <V>(attempt: () => V) => V | undefined) => ProductCreationFields,
): ProductCreationFields {
  const fields: Record<string, string> = {};
  const collect = <V>(attempt: () => V): V | undefined => {
    try {
      return attempt();
    } catch (error) {
      if (error instanceof FieldValidation) {
        fields[error.field] = error.message;
        return undefined;
      }
      throw error;
    }
  };
  const value = read(collect);
  if (Object.keys(fields).length > 0) {
    throw new DomainError('VALIDATION_FAILED', '입력값을 확인해 주세요.', fields);
  }
  return value;
}
