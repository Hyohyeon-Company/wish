/**
 * Route table for the auth screens slice:
 *   /login  — login-v1
 *   /signup — signup-v1
 *   /       — minimal authenticated landing (session observation surface;
 *             the real home-v1 feed is card C3, not this slice).
 * A guest landing on any other path is routed to the login screen with a
 * `returnTo` reference (401 유도와 동일한 복귀 규칙, AC4.1).
 */
import { useEffect, useState, type ReactElement } from 'react';
import { authStore, type AuthState } from './lib/auth';
import { navigate, useLocation } from './lib/router';
import { LandingPage } from './routes/landing';
import { LoginPage } from './routes/login';
import { SignupPage } from './routes/signup';

export function App(): ReactElement {
  const location = useLocation();
  const auth = useAuthState();

  if (location.path === '/login') return <LoginPage />;
  if (location.path === '/signup') return <SignupPage />;
  return <LandingRoute location={location.path} auth={auth} />;
}

function LandingRoute({ location, auth }: { location: string; auth: AuthState }): ReactElement {
  useEffect(() => {
    if (auth.status === 'guest') {
      navigate(`/login?returnTo=${encodeURIComponent(location)}`, { replace: true });
    }
  }, [auth.status, location]);

  if (auth.status === 'authenticated' && auth.member !== null) {
    return <LandingPage member={auth.member} />;
  }
  // 'unknown' (boot in flight) and the guest redirect frame render nothing —
  // an empty frame beats flashing the wrong screen.
  return <div className="landing" aria-busy="true" />;
}

function useAuthState(): AuthState {
  const [state, setState] = useState<AuthState>(() => authStore.getState());
  useEffect(
    () => authStore.subscribe(() => setState(authStore.getState())),
    [],
  );
  return state;
}
