/**
 * Small conversions shared by the MySQL adapters. Everything here is
 * defensive: a persisted row is outside the domain's control, so a value that
 * does not match the schema is a loud data-integrity error rather than a
 * silently coerced `NaN`/Invalid Date flowing into the aggregate.
 */

/** MySQL duplicate-key error code (unique index violation). */
const DUPLICATE_ENTRY = 'ER_DUP_ENTRY';

interface MysqlErrorShape {
  readonly code?: unknown;
  readonly errno?: unknown;
  readonly message?: unknown;
  readonly sqlMessage?: unknown;
}

function asMysqlError(error: unknown): MysqlErrorShape | null {
  if (typeof error !== 'object' || error === null) return null;
  return error as MysqlErrorShape;
}

export function isDuplicateEntryError(error: unknown): boolean {
  const shaped = asMysqlError(error);
  return shaped !== null && shaped.code === DUPLICATE_ENTRY;
}

/**
 * Index name reported by a duplicate-key error, or null when it cannot be
 * determined. MySQL 8 reports `for key '<table>.<index>'`; older formats omit
 * the table prefix, so the last segment is returned either way.
 */
export function duplicateKeyName(error: unknown): string | null {
  const shaped = asMysqlError(error);
  if (shaped === null) return null;
  const text = typeof shaped.sqlMessage === 'string' ? shaped.sqlMessage : shaped.message;
  if (typeof text !== 'string') return null;
  const match = /for key '([^']+)'/.exec(text);
  if (match === null) return null;
  const segments = match[1].split('.');
  return segments[segments.length - 1] ?? null;
}

export function toDate(value: unknown, column: string): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error(`${column}: invalid Date value`);
    return new Date(value.getTime());
  }
  if (typeof value === 'string' && value.trim() !== '') {
    // DATETIME columns are stored in UTC; a bare value (no zone marker) is UTC.
    const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(value.trim());
    const parsed = new Date(hasZone ? value : `${value.trim()}Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  throw new Error(`${column}: expected a DATETIME value, got ${String(value)}`);
}

export function toNullableDate(value: unknown, column: string): Date | null {
  if (value === null || value === undefined) return null;
  return toDate(value, column);
}

export function toNumber(value: unknown, column: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint' && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error(`${column}: expected a numeric value, got ${String(value)}`);
}

/** Error text for a startup/log message; never includes credentials. */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
