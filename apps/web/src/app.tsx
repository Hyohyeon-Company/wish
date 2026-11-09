/**
 * Route table after the detail slice (C5):
 *   /        — home-v1, the PUBLIC feed (AC1.1: 로그인 없이 홈 접속; the
 *             pre-C3 guest redirect at / was the placeholder posture and is
 *             superseded here).
 *   /search  — search-v1, the PUBLIC search/category screen (A3/A4, card C4;
 *             §3 marks search as 공개 화면, so a guest must NOT be
 *             login-redirected there).
 *   /products/{id} — detail-v1, the PUBLIC product detail (A6, card C5;
 *             §3 marks detail as 공개 화면 — a guest must NOT be
 *             login-redirected; an unknown/deleted product shows the 404
 *             screen instead, AC3.2).
 *   /login   — login-v1
 *   /signup  — signup-v1
 *   /sell    — sell-v1 (guest → login redirect, AC4.1)
 *   /my      — placeholder landing: the session observation surface (logout,
 *             AC5.1) until C8 renders my-v1; guests are login-redirected
 *             with returnTo (마이 is an authenticated destination).
 *   anything else — public destinations awaiting their slice. Until the
 *             owning card renders the screen, arriving at such a URL
 *             returns to the home feed (the design's 목록 복귀 pattern).
 */
import { useEffect, useState, type ReactElement } from 'react';
import { authStore, type AuthState } from './lib/auth';
import { navigate, useLocation } from './lib/router';
import { DetailPage } from './routes/detail';
import { HomePage } from './routes/home';
import { LandingPage } from './routes/landing';
import { LoginPage } from './routes/login';
import { SearchPage } from './routes/search';
import { SellRoute } from './routes/sell';
import { SignupPage } from './routes/signup';

export function App(): ReactElement {
  const location = useLocation();
  const auth = useAuthState();

  if (location.path === '/') return <HomePage auth={auth} />;
  if (location.path === '/search') return <SearchPage query={location.query} auth={auth} />;
  const productMatch = /^\/products\/([^/]+)$/.exec(location.path);
  const productId = productMatch?.[1];
  if (productId !== undefined) return <DetailPage productId={productId} />;
  if (location.path === '/login') return <LoginPage />;
  if (location.path === '/signup') return <SignupPage />;
  if (location.path === '/sell') return <SellRoute location={location.path} auth={auth} />;
  if (location.path === '/my') return <LandingRoute location={location.path} auth={auth} />;
  return <UnbuiltPublicRoute location={location.path} />;
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

function UnbuiltPublicRoute({ location }: { location: string }): ReactElement {
  useEffect(() => {
    navigate('/', { replace: true });
  }, [location]);
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
