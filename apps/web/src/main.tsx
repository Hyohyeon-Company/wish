import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import { authStore, wireUnauthorizedHandling } from './lib/auth';
import './styles/tokens.css';
import './styles/base.css';

// 401 on a protected endpoint → session cleared + login route with returnTo.
wireUnauthorizedHandling();
// Revalidate a persisted token before the first meaningful paint resolves.
void authStore.boot();

const rootElement = document.getElementById('root');
if (rootElement === null) {
  throw new Error('#root element is required');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
