/**
 * login-v1 — minimal auth screen built from design-system-v1 tokens only
 * (user-flow §1c; no dedicated design screen exists for auth).
 *
 * Contract behavior (§2-1 + §3 matrix row login-v1):
 * - submit → POST /api/auth/login; success navigates back to the `returnTo`
 *   screen (or the landing) — 로그인 후 원래 화면 복귀 (AC4.1/A8).
 * - 401 → the server's single generalized message, shown under the form;
 *   wrong email and wrong password are indistinguishable (AC5.2).
 * - network failure → the §3 network message under the form; resubmitting
 *   is the retry.
 * - submitting keeps the button disabled at 40% opacity (§3 처리중 상태).
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import { ApiError, request } from '../lib/api';
import { authStore, type MemberView } from '../lib/auth';
import { navigate, safeReturnTo, useLocation } from '../lib/router';
import { validateLogin, type FieldErrors } from '../lib/validation';

export function LoginPage(): ReactElement {
  const location = useLocation();
  const returnTo = safeReturnTo(location.query.get('returnTo')) ?? '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);
    const errors = validateLogin({ email, password });
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      const { body } = await request<{ member: MemberView; token: string }>(
        '/api/auth/login',
        {
          method: 'POST',
          body: { email: email.trim().toLowerCase(), password },
          // 401 here is the generalized credentials error, not a redirect.
          unauthorized: 'error',
        },
      );
      authStore.applySession(body);
      navigate(returnTo, { replace: true });
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : '서버에 문제가 발생했어요.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-sheet" aria-labelledby="login-title">
        <p className="auth-wordmark">wish</p>
        <h1 className="auth-title" id="login-title">로그인</h1>
        <form className="auth-form" noValidate onSubmit={(event) => { void handleSubmit(event); }}>
          <div className="auth-field">
            <label className="auth-label" htmlFor="login-email">이메일</label>
            <input
              id="login-email"
              className="auth-input"
              type="email"
              autoComplete="email"
              placeholder="이메일을 입력하세요"
              value={email}
              aria-invalid={fieldErrors.email !== undefined}
              aria-describedby={fieldErrors.email !== undefined ? 'login-email-error' : undefined}
              onChange={(event) => setEmail(event.target.value)}
            />
            {fieldErrors.email !== undefined && (
              <p className="auth-field-error" id="login-email-error">{fieldErrors.email}</p>
            )}
          </div>
          <div className="auth-field">
            <label className="auth-label" htmlFor="login-password">비밀번호</label>
            <input
              id="login-password"
              className="auth-input"
              type="password"
              autoComplete="current-password"
              placeholder="비밀번호를 입력하세요"
              value={password}
              aria-invalid={fieldErrors.password !== undefined}
              aria-describedby={fieldErrors.password !== undefined ? 'login-password-error' : undefined}
              onChange={(event) => setPassword(event.target.value)}
            />
            {fieldErrors.password !== undefined && (
              <p className="auth-field-error" id="login-password-error">{fieldErrors.password}</p>
            )}
          </div>
          {formError !== null && (
            <p className="auth-form-error" role="alert">{formError}</p>
          )}
          <button className="button-primary" type="submit" disabled={submitting}>
            {submitting ? '로그인 중…' : '로그인'}
          </button>
        </form>
        <p className="auth-footer">
          계정이 없나요? <a href="/signup" onClick={(event) => { event.preventDefault(); navigate(`/signup?returnTo=${encodeURIComponent(returnTo)}`); }}>회원가입</a>
        </p>
      </section>
    </main>
  );
}
