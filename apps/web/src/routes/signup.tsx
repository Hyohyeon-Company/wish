/**
 * signup-v1 — minimal auth screen built from design-system-v1 tokens only.
 *
 * Contract behavior (§2-1 + §3 matrix row signup-v1):
 * - fields: email · password · nickname · region; client-side validation
 *   mirrors the server rules (double defense, B6).
 * - submit → POST /api/auth/signup; 201 → session starts immediately
 *   (auto session, B1) and the member lands on `returnTo` or the landing.
 * - 400 VALIDATION_FAILED → per-field errors rendered under each field,
 *   inputs preserved.
 * - 409 EMAIL_TAKEN → the server message shown as the email field error.
 *   The 409 body has no `fields` key (fields are 400-only) — mapping it to
 *   the email field is Frontend's responsibility (C1 review observation).
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import { ApiError, request } from '../lib/api';
import { authStore, type MemberView } from '../lib/auth';
import { navigate, safeReturnTo, useLocation } from '../lib/router';
import { validateSignup, type FieldErrors, type SignupValues } from '../lib/validation';

interface SignupFieldProps {
  readonly id: string;
  readonly label: string;
  readonly type: 'email' | 'password' | 'text';
  readonly autoComplete: string;
  readonly placeholder: string;
  readonly value: string;
  readonly error: string | undefined;
  readonly onChange: (value: string) => void;
}

function SignupField(props: SignupFieldProps): ReactElement {
  return (
    <div className="auth-field">
      <label className="auth-label" htmlFor={props.id}>{props.label}</label>
      <input
        id={props.id}
        className="auth-input"
        type={props.type}
        autoComplete={props.autoComplete}
        placeholder={props.placeholder}
        value={props.value}
        aria-invalid={props.error !== undefined}
        aria-describedby={props.error !== undefined ? `${props.id}-error` : undefined}
        onChange={(event) => props.onChange(event.target.value)}
      />
      {props.error !== undefined && (
        <p className="auth-field-error" id={`${props.id}-error`}>{props.error}</p>
      )}
    </div>
  );
}

export function SignupPage(): ReactElement {
  const location = useLocation();
  const returnTo = safeReturnTo(location.query.get('returnTo')) ?? '/';

  const [values, setValues] = useState<SignupValues>({
    email: '',
    password: '',
    nickname: '',
    region: '',
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update(field: keyof SignupValues, value: string): void {
    setValues((previous) => ({ ...previous, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);
    const errors = validateSignup(values);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      const { body } = await request<{ member: MemberView; token: string }>(
        '/api/auth/signup',
        {
          method: 'POST',
          body: {
            email: values.email.trim().toLowerCase(),
            password: values.password,
            nickname: values.nickname.trim(),
            region: values.region.trim(),
          },
        },
      );
      authStore.applySession(body);
      navigate(returnTo, { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        if (Object.keys(error.fields).length > 0) {
          // 400 with field errors — show them per field, keep the input.
          setFieldErrors(error.fields as FieldErrors);
        } else if (error.code === 'EMAIL_TAKEN') {
          // 409 carries no fields; map it to the email field ourselves.
          setFieldErrors({ email: error.message });
        } else {
          setFormError(error.message);
        }
      } else {
        setFormError('서버에 문제가 발생했어요.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-sheet" aria-labelledby="signup-title">
        <p className="auth-wordmark">wish</p>
        <h1 className="auth-title" id="signup-title">회원가입</h1>
        <form className="auth-form" noValidate onSubmit={(event) => { void handleSubmit(event); }}>
          <SignupField
            id="signup-email"
            label="이메일"
            type="email"
            autoComplete="email"
            placeholder="이메일을 입력하세요"
            value={values.email}
            error={fieldErrors.email}
            onChange={(value) => update('email', value)}
          />
          <SignupField
            id="signup-password"
            label="비밀번호"
            type="password"
            autoComplete="new-password"
            placeholder="비밀번호를 입력하세요"
            value={values.password}
            error={fieldErrors.password}
            onChange={(value) => update('password', value)}
          />
          <SignupField
            id="signup-nickname"
            label="닉네임"
            type="text"
            autoComplete="nickname"
            placeholder="닉네임을 입력하세요"
            value={values.nickname}
            error={fieldErrors.nickname}
            onChange={(value) => update('nickname', value)}
          />
          <SignupField
            id="signup-region"
            label="활동지역"
            type="text"
            autoComplete="address-level3"
            placeholder="예: 사당동"
            value={values.region}
            error={fieldErrors.region}
            onChange={(value) => update('region', value)}
          />
          {formError !== null && (
            <p className="auth-form-error" role="alert">{formError}</p>
          )}
          <button className="button-primary" type="submit" disabled={submitting}>
            {submitting ? '가입 중…' : '가입하기'}
          </button>
        </form>
        <p className="auth-footer">
          이미 계정이 있나요? <a href="/login" onClick={(event) => { event.preventDefault(); navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`); }}>로그인</a>
        </p>
      </section>
    </main>
  );
}
