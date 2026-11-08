/**
 * sell-v1 — the 판매 등록 form (journey B4~B8, card C2).
 *
 * Visual source: design/t_8db2c17c/wish-sell-v1.html, rendered with
 * design-system-v1 tokens only (same posture as login-v1/signup-v1). Two
 * recorded intentional differences from the static HTML, both because the
 * approved §2-3 request contract has no field to back them:
 * - 거래 방식 (직거래/택배): not part of the §2-3 body or brief §6 Product —
 *   omitted until a contract revision adds it (same precedent as detail-v1's
 *   omitted 채팅 CTA).
 * - 임시저장: no draft contract exists in v1 — a button with no backing
 *   behavior would be fake UI, so it is omitted too.
 *
 * Contract behavior:
 * - guest on /sell → login redirect with returnTo=/sell; after login the
 *   member returns to this form (AC4.1, journey B3).
 * - categories load from GET /api/categories (§2-2); failure keeps the form
 *   and offers retry (B4, §3).
 * - each photo is uploaded one by one (POST /api/uploads, multipart 'image');
 *   one failed upload marks only that file — the rest stay (B5, brief §10
 *   RF2: partial failure). The 11th photo is blocked client-side; the
 *   server's 1..10 boundary is the second line of defense (B6).
 * - price input rejects non-digits immediately (B6: 클라이언트 즉시 거부);
 *   the server 400 is the double defense.
 * - submit → POST /api/products with the authenticated token; 201 →
 *   navigate to `/products/{id}` (detail-v1 rendering is card C5 — until it
 *   exists the route falls through to the placeholder landing, but the URL
 *   is already the destination the contract names).
 * - 400 VALIDATION_FAILED → per-field errors, inputs preserved (B7).
 * - 401 → the shared session policy (wireUnauthorizedHandling) clears the
 *   session and routes to login with returnTo (AC4.1).
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { ApiError, NETWORK_ERROR_MESSAGE, request } from '../lib/api';
import { authStore, type MemberView } from '../lib/auth';
import { navigate } from '../lib/router';

interface CategoryView {
  readonly code: string;
  readonly name: string;
  readonly display_order: number;
}

/** The four 상품상태 codes extracted from the sell-v1 HTML (server-confirmed set). */
const CONDITIONS: ReadonlyArray<{ readonly code: string; readonly label: string }> = [
  { code: 'new', label: '새 제품' },
  { code: 'like_new', label: '거의 새 것' },
  { code: 'used', label: '사용감 있음' },
  { code: 'needs_repair', label: '부품/수리 필요' },
];

export const MAX_PHOTOS = 10;

interface SellValues {
  readonly title: string;
  readonly price: string;
  readonly description: string;
  readonly region: string;
}

/** Mirrors the server rules (double defense, B6) — same messages, same fields. */
function validateSell(values: SellValues, category: string | null, photoCount: number): Record<string, string> {
  const errors: Record<string, string> = {};
  const title = values.title.trim();
  if (title.length < 1 || title.length > 50) {
    errors.title = '제목은 1자 이상 50자 이하로 입력해 주세요.';
  }
  if (values.price.length === 0) {
    errors.price = '가격은 숫자로 입력해 주세요.';
  } else {
    const price = Number(values.price);
    if (!Number.isSafeInteger(price) || price <= 0) {
      errors.price = '가격은 1원 이상으로 입력해 주세요.';
    }
  }
  if (category === null) errors.category_code = '카테고리를 선택해 주세요.';
  const description = values.description.trim();
  if (description.length < 1 || description.length > 1000) {
    errors.description = '설명은 1자 이상 1,000자 이하로 입력해 주세요.';
  }
  const region = values.region.trim();
  if (region.length < 1 || region.length > 20) {
    errors.region = '거래 지역은 1자 이상 20자 이하로 입력해 주세요.';
  }
  if (photoCount < 1 || photoCount > MAX_PHOTOS) {
    errors.image_urls = '사진을 1장 이상 추가해 주세요.';
  }
  return errors;
}

export function SellRoute({
  location,
  auth,
}: {
  location: string;
  auth: { readonly status: string; readonly member: MemberView | null };
}): ReactElement {
  useEffect(() => {
    if (auth.status === 'guest') {
      navigate(`/login?returnTo=${encodeURIComponent(location)}`, { replace: true });
    }
  }, [auth.status, location]);

  if (auth.status === 'authenticated' && auth.member !== null) {
    return <SellPage member={auth.member} />;
  }
  // 'unknown' (boot in flight) and the guest redirect frame render nothing —
  // an empty frame beats flashing the wrong screen (same as the landing).
  return <div className="sell" aria-busy="true" />;
}

function SellPage({ member }: { member: MemberView }): ReactElement {
  // --- categories (B4) ------------------------------------------------------
  const [categories, setCategories] = useState<readonly CategoryView[] | null>(null);
  const [categoriesFailed, setCategoriesFailed] = useState(false);

  const loadCategories = useCallback(async (): Promise<void> => {
    setCategoriesFailed(false);
    try {
      const { body } = await request<readonly CategoryView[]>('/api/categories');
      setCategories(body);
    } catch {
      setCategoriesFailed(true);
    }
  }, []);
  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  // --- form state -----------------------------------------------------------
  const [values, setValues] = useState<SellValues>({
    title: '',
    price: '',
    description: '',
    region: member.region,
  });
  const [category, setCategory] = useState<string | null>(null);
  const [condition, setCondition] = useState<string | null>(null);
  const [photos, setPhotos] = useState<readonly string[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function update(field: keyof SellValues, value: string): void {
    setValues((previous) => ({ ...previous, [field]: value }));
  }

  /** B6: non-digit input is refused immediately, not on submit. */
  function updatePrice(raw: string): void {
    update('price', raw.replace(/\D/g, ''));
  }

  async function handleFilesChosen(files: FileList | null): Promise<void> {
    if (files === null || files.length === 0) return;
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) {
      // UI 차단: the 11th photo can never enter the list (B5).
      setPhotoError(`사진은 ${MAX_PHOTOS}장까지 등록할 수 있어요.`);
      return;
    }
    const chosen = Array.from(files);
    if (chosen.length > room) {
      setPhotoError(`사진은 ${MAX_PHOTOS}장까지 등록할 수 있어요.`);
    }
    setUploading(true);
    setPhotoError(null);
    const token = authStore.getToken();
    for (const file of chosen.slice(0, room)) {
      const data = new FormData();
      data.append('image', file);
      try {
        const { body } = await request<{ url: string }>('/api/uploads', {
          method: 'POST',
          body: data,
          token,
        });
        setPhotos((previous) => [...previous, body.url]);
      } catch (error) {
        // B5/RF2 partial failure: only this file is marked, the rest stay.
        setPhotoError(
          error instanceof ApiError && error.fields['image'] !== undefined
            ? error.fields['image']
            : '사진 업로드에 실패했어요. 다시 시도해 주세요.',
        );
        break;
      }
    }
    setUploading(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);
    const errors = validateSell(values, category, photos.length);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      const { body } = await request<{ product: { id: string } }>('/api/products', {
        method: 'POST',
        body: {
          title: values.title.trim(),
          price: Number(values.price),
          category_code: category,
          condition,
          description: values.description.trim(),
          region: values.region.trim(),
          image_urls: photos,
        },
        token: authStore.getToken(),
      });
      // B7/B8: the contract's destination is the product detail screen; its
      // rendering is card C5, so this lands on the placeholder route for now.
      navigate(`/products/${body.product.id}`);
    } catch (error) {
      if (error instanceof ApiError) {
        if (Object.keys(error.fields).length > 0) {
          setFieldErrors({ ...error.fields });
        } else {
          setFormError(error.message);
        }
      } else {
        setFormError(NETWORK_ERROR_MESSAGE);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const categoryChips: readonly CategoryView[] = categories ?? [];

  return (
    <main className="sell">
      <header className="sell-header">
        <div className="sell-header-in">
          <button
            className="sell-back"
            type="button"
            aria-label="뒤로 가기"
            onClick={() => window.history.back()}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <span className="sell-title">판매 등록</span>
          <span className="sell-header-spacer" aria-hidden="true" />
        </div>
      </header>

      <form className="sell-form" noValidate onSubmit={(event) => { void handleSubmit(event); }}>
        <div className="sell-field">
          <span className="sell-label" id="sell-photo-label">
            사진 <span className="sell-hint">{photos.length}/{MAX_PHOTOS} · 첫 번째 사진이 대표 이미지입니다</span>
          </span>
          <div className="sell-photos" role="group" aria-labelledby="sell-photo-label">
            {photos.map((url, index) => (
              <div className="sell-photo-item" key={url}>
                <img src={url} alt={`사진 ${index + 1}`} />
                {index === 0 && <span className="sell-photo-main">대표</span>}
                <button
                  className="sell-photo-remove"
                  type="button"
                  aria-label={`사진 ${index + 1} 삭제`}
                  onClick={() => setPhotos((previous) => previous.filter((_, i) => i !== index))}
                >
                  ✕
                </button>
              </div>
            ))}
            {photos.length < MAX_PHOTOS && (
              <button className="sell-photo-add" type="button" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                사진 추가
              </button>
            )}
            <input
              className="sell-photo-input"
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              aria-label="사진 선택"
              onChange={(event) => {
                void handleFilesChosen(event.target.files);
                event.target.value = '';
              }}
            />
          </div>
          {photoError !== null && <p className="sell-field-error" role="alert">{photoError}</p>}
          {fieldErrors.image_urls !== undefined && <p className="sell-field-error">{fieldErrors.image_urls}</p>}
        </div>

        <div className="sell-field">
          <label className="sell-label" htmlFor="sell-title">제목</label>
          <input
            className="sell-input"
            id="sell-title"
            type="text"
            placeholder="제목을 입력하세요"
            maxLength={50}
            value={values.title}
            aria-invalid={fieldErrors.title !== undefined}
            onChange={(event) => update('title', event.target.value)}
          />
          <p className="sell-counter">{values.title.length} / 50자</p>
          {fieldErrors.title !== undefined && <p className="sell-field-error">{fieldErrors.title}</p>}
        </div>

        <div className="sell-field">
          <span className="sell-label" id="sell-category-label">카테고리</span>
          {categoriesFailed ? (
            <div>
              <p className="sell-field-error" role="alert">카테고리를 불러오지 못했어요.</p>
              <button className="sell-retry" type="button" onClick={() => { void loadCategories(); }}>다시 시도</button>
            </div>
          ) : (
            <div className="sell-chips" role="group" aria-labelledby="sell-category-label">
              {categoryChips.map((chip) => (
                <button
                  className="sell-chip"
                  key={chip.code}
                  type="button"
                  aria-pressed={category === chip.code}
                  onClick={() => setCategory(chip.code)}
                >
                  {chip.name}
                </button>
              ))}
            </div>
          )}
          {fieldErrors.category_code !== undefined && <p className="sell-field-error">{fieldErrors.category_code}</p>}
        </div>

        <div className="sell-field">
          <label className="sell-label" htmlFor="sell-price">가격</label>
          <div className="sell-price-wrap">
            <input
              className="sell-input sell-price-input"
              id="sell-price"
              type="text"
              inputMode="numeric"
              placeholder="0"
              value={values.price}
              aria-invalid={fieldErrors.price !== undefined}
              onChange={(event) => updatePrice(event.target.value)}
            />
            <span className="sell-won" aria-hidden="true">원</span>
          </div>
          {fieldErrors.price !== undefined && <p className="sell-field-error">{fieldErrors.price}</p>}
        </div>

        <div className="sell-field">
          <span className="sell-label" id="sell-condition-label">상품상태</span>
          <div className="sell-chips" role="group" aria-labelledby="sell-condition-label">
            {CONDITIONS.map((item) => (
              <button
                className="sell-chip"
                key={item.code}
                type="button"
                aria-pressed={condition === item.code}
                onClick={() => setCondition(item.code)}
              >
                {item.label}
              </button>
            ))}
          </div>
          {fieldErrors.condition !== undefined && <p className="sell-field-error">{fieldErrors.condition}</p>}
        </div>

        <div className="sell-field">
          <label className="sell-label" htmlFor="sell-description">설명</label>
          <textarea
            className="sell-input sell-textarea"
            id="sell-description"
            placeholder="사용 기간, 사유, 거래 방식 등을 적어주세요"
            maxLength={1000}
            value={values.description}
            aria-invalid={fieldErrors.description !== undefined}
            onChange={(event) => update('description', event.target.value)}
          />
          <p className="sell-counter">{values.description.length} / 1,000자</p>
          {fieldErrors.description !== undefined && <p className="sell-field-error">{fieldErrors.description}</p>}
        </div>

        <div className="sell-field">
          <label className="sell-label" htmlFor="sell-region">거래 지역</label>
          <input
            className="sell-input"
            id="sell-region"
            type="text"
            maxLength={20}
            value={values.region}
            aria-invalid={fieldErrors.region !== undefined}
            onChange={(event) => update('region', event.target.value)}
          />
          {fieldErrors.region !== undefined && <p className="sell-field-error">{fieldErrors.region}</p>}
        </div>

        {formError !== null && <p className="sell-form-error" role="alert">{formError}</p>}

        <div className="sell-submit-bar">
          <button className="button-primary" type="submit" disabled={submitting}>
            {submitting ? '등록 중…' : '등록하기'}
          </button>
        </div>
      </form>
    </main>
  );
}
