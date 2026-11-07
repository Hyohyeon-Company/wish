/**
 * Minimal authenticated landing — NOT home-v1 (that is card C3).
 *
 * It exists so the auth slice's session lifecycle is observable end to end
 * (AC5.1: signup → logout → re-login) without pulling feed UI into this
 * card. It shows who is logged in and offers logout (POST /api/auth/logout,
 * §2-1); a failing logout keeps the session and reports the error.
 */
import { useState, type ReactElement } from 'react';
import { ApiError } from '../lib/api';
import { authStore, type MemberView } from '../lib/auth';
import { navigate } from '../lib/router';

export function LandingPage({ member }: { member: MemberView }): ReactElement {
  const [error, setError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout(): Promise<void> {
    setError(null);
    setLoggingOut(true);
    try {
      await authStore.logout();
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '서버에 문제가 발생했어요.');
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <main className="landing">
      <section className="landing-sheet" aria-labelledby="landing-greeting">
        <p className="auth-wordmark">wish</p>
        <h1 className="landing-greeting" id="landing-greeting">
          {member.nickname}님, 환영해요
        </h1>
        <p className="landing-meta">{member.email} · {member.region}</p>
        {error !== null && (
          <p className="auth-form-error" role="alert">{error}</p>
        )}
        <button
          className="button-primary"
          type="button"
          disabled={loggingOut}
          onClick={() => { void handleLogout(); }}
        >
          {loggingOut ? '로그아웃 중…' : '로그아웃'}
        </button>
      </section>
    </main>
  );
}
