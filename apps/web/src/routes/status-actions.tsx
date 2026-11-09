/**
 * Seller status-change and delete actions (card C7, journeys B10~B12).
 *
 * Contract behavior:
 * - the buttons offered are the §6 전이표's legal targets for the CURRENT
 *   status (lib/product-status mirror — UI affordance only; the server is
 *   the authority);
 * - tapping sends PATCH /api/products/{id}/status {status}; the caller's
 *   onChanged receives the server's returned status (AC7.3 즉시 반영 is the
 *   caller's re-render, from the server's answer — not local guessing);
 * - 401 is handled by the session policy (login + returnTo); 400
 *   INVALID_TRANSITION / VALIDATION_FAILED, 403 and 409 CONFLICT surface as
 *   the caller's error toast (§3: 403/409 have no dedicated screens);
 * - 거래완료 is terminal: nothing renders (B11 되돌림 UI 없음);
 * - the delete button is the --danger 텍스트 버튼 (B12). Deletion is
 *   destructive and un-recoverable, so the first tap ARMS the button
 *   ("정말 삭제할까요?") and only the second tap sends DELETE /api/products/{id}
 *   (204) — tapping elsewhere/blur disarms. This is reversible UI polish,
 *   not a contract addition; the contract's observable is the 204 → the
 *   row leaves the list (the caller re-requests the server's truth).
 */
import { useEffect, useState, type ReactElement } from 'react';
import { ApiError, NETWORK_ERROR_MESSAGE, request } from '../lib/api';
import { allowedStatusChanges, STATUS_LABELS } from '../lib/product-status';

export function StatusChangeActions({
  productId,
  status,
  onChanged,
  onError,
  disabled = false,
}: {
  productId: string;
  status: string;
  onChanged: (nextStatus: string) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}): ReactElement | null {
  const targets = allowedStatusChanges(status);
  const [pending, setPending] = useState<string | null>(null);

  if (targets.length === 0) return null;

  async function change(target: string): Promise<void> {
    setPending(target);
    try {
      const { body } = await request<{ product: { status: string } }>(
        `/api/products/${encodeURIComponent(productId)}/status`,
        { method: 'PATCH', body: { status: target } },
      );
      onChanged(body.product.status);
    } catch (caught) {
      // 401 already routed by the session policy.
      if (caught instanceof ApiError && caught.status === 401) return;
      onError(caught instanceof ApiError ? caught.message : NETWORK_ERROR_MESSAGE);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="status-actions" role="group" aria-label="상태 변경">
      {targets.map((target) => (
        <button
          className="btn btn-ghost status-action"
          key={target}
          type="button"
          disabled={disabled || pending !== null}
          onClick={() => { void change(target); }}
        >
          {pending === target
            ? '변경 중…'
            : `${STATUS_LABELS[target]}(으)로 변경`}
        </button>
      ))}
    </div>
  );
}

export function DeleteProductButton({
  productId,
  onDeleted,
  onError,
  disabled = false,
}: {
  productId: string;
  onDeleted: () => void;
  onError: (message: string) => void;
  disabled?: boolean;
}): ReactElement {
  const [armed, setArmed] = useState(false);
  const [pending, setPending] = useState(false);

  // Disarm when focus leaves the button — an armed destructive action must
  // not linger waiting for a stray second tap.
  useEffect(() => {
    if (!armed) return;
    const disarm = (): void => setArmed(false);
    const interval = window.setInterval(disarm, 4000);
    return () => window.clearInterval(interval);
  }, [armed]);

  async function remove(): Promise<void> {
    if (!armed) {
      setArmed(true);
      return;
    }
    setPending(true);
    try {
      await request<void>(`/api/products/${encodeURIComponent(productId)}`, {
        method: 'DELETE',
      });
      onDeleted();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) return;
      onError(caught instanceof ApiError ? caught.message : NETWORK_ERROR_MESSAGE);
      setArmed(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      className={`text-danger${armed ? ' armed' : ''}`}
      type="button"
      disabled={disabled || pending}
      onClick={() => { void remove(); }}
      onBlur={() => setArmed(false)}
    >
      {pending ? '삭제 중…' : armed ? '정말 삭제할까요?' : '삭제'}
    </button>
  );
}
