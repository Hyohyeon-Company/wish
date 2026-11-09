/**
 * Display formatting helpers of the feed (design §3: 상대시간 "3분 전" ·
 * 위존 "사당동" · 천단위 콤마+원 표기). Pure functions — no locale runtime
 * dependency, so server and browser render the same string.
 */

/** 580000 → '580,000' (천단위 콤마). Non-finite input collapses to '0'. */
export function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const absolute = Math.abs(Math.trunc(value));
  const digits = String(absolute);
  let grouped = '';
  for (let index = 0; index < digits.length; index += 1) {
    if (index > 0 && (digits.length - index) % 3 === 0) grouped += ',';
    grouped += digits[index];
  }
  return value < 0 ? `-${grouped}` : grouped;
}

/**
 * Relative time in the design's own vocabulary: 방금 전 / N분 전 / N시간 전 /
 * N일 전, older than a week falls back to 'M월 D일'. A future or unparseable
 * timestamp degrades to '방금 전' / '' rather than inventing a new state.
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const diffSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diffSeconds < 60) return '방금 전';
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}분 전`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}시간 전`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}일 전`;
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}
