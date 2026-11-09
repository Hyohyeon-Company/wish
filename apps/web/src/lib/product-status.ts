/**
 * Status vocabulary for the seller's own status-change UI (card C7, §6).
 *
 * This mirrors the §6 전이표 for UI affordance only — which action buttons
 * to offer. The SERVER remains the rule's authority: a stale screen that
 * offers a now-illegal transition gets the contract's 400
 * INVALID_TRANSITION and the UI surfaces it as an error toast, exactly like
 * any other contract refusal. Never widen this table without the brief.
 */
import type { ReactElement } from 'react';

/** The §2-0 status enum ↔ label (design §5 badge vocabulary). */
export const STATUS_LABELS: Record<string, string> = {
  ACTIVE: '판매중',
  RESERVED: '예약중',
  SOLD: '거래완료',
};

/** The §6 전이표 (mirror of the server's PRODUCT_TRANSITIONS). */
export const ALLOWED_STATUS_CHANGES: Readonly<Record<string, readonly string[]>> = {
  ACTIVE: ['RESERVED', 'SOLD'],
  RESERVED: ['ACTIVE', 'SOLD'],
  SOLD: [], // 종착 상태 (B11): no reversal UI, ever
};

/**
 * Renders the seller's status-change actions for one status. Returns null
 * for the terminal 거래완료 — B11: 되돌림 UI 없음.
 */
export function allowedStatusChanges(status: string): readonly string[] {
  return ALLOWED_STATUS_CHANGES[status] ?? [];
}

export type StatusActionRender = (target: string) => ReactElement;
