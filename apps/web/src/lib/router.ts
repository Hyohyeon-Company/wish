/**
 * Minimal history-based router for this slice (/login, /signup and the
 * authenticated landing at /). No routing dependency yet — react-router
 * becomes worth its weight when the feed/search/detail screens (C3+) need
 * nested layouts and params; this file is the seam they will replace.
 */
import { useSyncExternalStore } from 'react';

export interface Location {
  readonly path: string;
  readonly query: URLSearchParams;
}

const listeners = new Set<() => void>();

// getSnapshot must return a stable object identity while the URL is unchanged
// (useSyncExternalStore compares with Object.is), yet also pick up URL
// changes made outside navigate() — popstate, or a history.replaceState in a
// test. The fingerprint re-syncs the cached object only when the URL moved.
let cachedFingerprint = '';
let cachedLocation: Location = { path: '/', query: new URLSearchParams('') };

function getSnapshot(): Location {
  const path = window.location.pathname;
  const search = window.location.search;
  const fingerprint = `${path}?${search}`;
  if (fingerprint !== cachedFingerprint) {
    cachedFingerprint = fingerprint;
    cachedLocation = { path, query: new URLSearchParams(search) };
  }
  return cachedLocation;
}

function syncAndNotify(): void {
  getSnapshot();
  for (const listener of listeners) listener();
}

export function currentLocation(): Location {
  return getSnapshot();
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (options.replace === true) {
    window.history.replaceState(null, '', to);
  } else {
    window.history.pushState(null, '', to);
  }
  syncAndNotify();
}

let popstateWired = false;

function subscribe(listener: () => void): () => void {
  if (!popstateWired) {
    window.addEventListener('popstate', syncAndNotify);
    popstateWired = true;
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLocation(): Location {
  // useSyncExternalStore re-reads the snapshot after subscribing and forces a
  // re-render if it changed — so a navigate() fired from a child's mount
  // effect (LandingRoute's guest redirect, which runs before this parent
  // hook's own effect) is still observed. A hand-rolled useState+subscribe
  // loses that first notification and renders the stale route forever.
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Guards a `returnTo` parameter against open redirects: only in-app paths
 * are honored, absolute URLs and protocol-relative paths are refused.
 */
export function safeReturnTo(raw: string | null): string | null {
  if (raw === null) return null;
  if (raw.length === 0 || raw.length > 512) return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  if (raw.startsWith('/\\')) return null;
  return raw;
}
