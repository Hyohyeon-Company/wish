/** Router seams: safeReturnTo refuses open redirects. */
import { describe, expect, it } from 'vitest';
import { safeReturnTo } from './router';

describe('safeReturnTo', () => {
  it('accepts in-app absolute paths', () => {
    expect(safeReturnTo('/')).toBe('/');
    expect(safeReturnTo('/products/42')).toBe('/products/42');
    expect(safeReturnTo('/search?q=의자')).toBe('/search?q=의자');
  });

  it('refuses absolute URLs, protocol-relative paths and control characters', () => {
    expect(safeReturnTo('https://evil.example')).toBeNull();
    expect(safeReturnTo('//evil.example')).toBeNull();
    expect(safeReturnTo('/\\evil.example')).toBeNull();
    expect(safeReturnTo('javascript:alert(1)')).toBeNull();
    expect(safeReturnTo('relative/path')).toBeNull();
  });

  it('refuses null and oversized values', () => {
    expect(safeReturnTo(null)).toBeNull();
    expect(safeReturnTo('/' + 'a'.repeat(512))).toBeNull();
  });
});
