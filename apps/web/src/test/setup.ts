/**
 * Node >=26 defines its own experimental `localStorage` accessor on the
 * worker global, and vitest's jsdom environment only copies jsdom window
 * properties listed in its fixed KEYS set — `localStorage` is not among
 * them. On Node 24 the accessor does not exist, so vitest copies jsdom's
 * own; on Node 26 the Node accessor shadows it and `window.localStorage`
 * is undefined (with a "--localstorage-file" warning). Bridge the real
 * jsdom storages back onto the test global so tests behave the same on
 * both runtimes.
 */
const win = (globalThis as unknown as { jsdom?: { window: Window & { localStorage?: Storage; sessionStorage?: Storage } } }).jsdom
  ?.window;
if (win) {
  for (const key of ['localStorage', 'sessionStorage'] as const) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      enumerable: true,
      get() {
        return win[key];
      },
    });
  }
}
