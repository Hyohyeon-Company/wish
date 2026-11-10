/**
 * Splits a migration/seed script into single statements.
 *
 * The MySQL protocol applies one statement per round trip here (the adapter
 * deliberately does not enable `multipleStatements`), and client-side
 * `DELIMITER` logic is not available. Rather than shipping a fragile
 * `split(';')`, this scanner understands the parts of MySQL syntax that
 * actually contain semicolons or comment markers:
 *
 * - single-quoted, double-quoted and backtick-quoted regions (with `\x`
 *   escapes inside strings and doubled quotes as an escaped quote);
 * - `-- ` line comments, `#` line comments and `/* ... *\/` block comments.
 *
 * Consequence, documented for future migration authors: this subset does not
 * support stored-program bodies (`BEGIN ... END`), which is why the schema
 * keeps its rules in CHECK constraints, unique indexes and the aggregate
 * instead of triggers.
 */
export function splitSqlStatements(script: string): string[] {
  const statements: string[] = [];
  let current = '';
  let quote: "'" | '"' | '`' | null = null;
  let index = 0;

  const flush = (): void => {
    const statement = current.trim();
    if (statement !== '') statements.push(statement);
    current = '';
  };

  while (index < script.length) {
    const char = script[index];
    const next = script[index + 1] ?? '';

    if (quote !== null) {
      current += char;
      if (char === '\\' && quote !== '`') {
        current += next;
        index += 2;
        continue;
      }
      if (char === quote) {
        if (next === quote) {
          current += next;
          index += 2;
          continue;
        }
        quote = null;
      }
      index += 1;
      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      current += char;
      index += 1;
      continue;
    }

    if (char === '-' && next === '-') {
      while (index < script.length && script[index] !== '\n') index += 1;
      continue;
    }

    if (char === '#') {
      while (index < script.length && script[index] !== '\n') index += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      index += 2;
      while (index < script.length && !(script[index] === '*' && script[index + 1] === '/')) {
        index += 1;
      }
      index += 2;
      continue;
    }

    if (char === ';') {
      flush();
      index += 1;
      continue;
    }

    current += char;
    index += 1;
  }

  flush();
  return statements;
}
