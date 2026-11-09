import { describe, expect, it } from 'vitest';
import { formatPrice, formatRelativeTime } from './time';

describe('formatPrice (천단위 콤마, design §3)', () => {
  it('groups thousands and appends nothing itself — the caller adds 원', () => {
    expect(formatPrice(0)).toBe('0');
    expect(formatPrice(5)).toBe('5');
    expect(formatPrice(580)).toBe('580');
    expect(formatPrice(5800)).toBe('5,800');
    expect(formatPrice(580000)).toBe('580,000');
    expect(formatPrice(1234567)).toBe('1,234,567');
  });

  it('keeps negative and huge values well-formed', () => {
    expect(formatPrice(-120000)).toBe('-120,000');
    expect(formatPrice(Number.NaN)).toBe('0');
  });
});

describe('formatRelativeTime (상대시간, design §3)', () => {
  const now = new Date('2026-11-09T12:00:00.000Z');

  it('renders the design vocabulary for each range', () => {
    expect(formatRelativeTime('2026-11-09T11:59:40.000Z', now)).toBe('방금 전');
    expect(formatRelativeTime('2026-11-09T11:57:00.000Z', now)).toBe('3분 전');
    expect(formatRelativeTime('2026-11-09T11:00:00.000Z', now)).toBe('1시간 전');
    expect(formatRelativeTime('2026-11-09T09:00:00.000Z', now)).toBe('3시간 전');
    expect(formatRelativeTime('2026-11-08T12:00:00.000Z', now)).toBe('1일 전');
    expect(formatRelativeTime('2026-11-03T12:00:00.000Z', now)).toBe('6일 전');
  });

  it('falls back to a month/day stamp beyond a week', () => {
    expect(formatRelativeTime('2026-11-01T12:00:00.000Z', now)).toBe('11월 1일');
  });

  it('degrades a future or unparseable timestamp instead of crashing', () => {
    expect(formatRelativeTime('2026-11-09T12:00:10.000Z', now)).toBe('방금 전');
    expect(formatRelativeTime('not-a-date', now)).toBe('');
  });
});
