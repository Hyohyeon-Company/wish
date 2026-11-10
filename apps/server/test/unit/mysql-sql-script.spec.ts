/**
 * Statement splitter used by the migration and seed runners. It exists because
 * the adapters never enable `multipleStatements`; the tests pin the quoting and
 * comment cases that would otherwise split a script in the wrong place.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { splitSqlStatements } from '../../src/infrastructure/mysql/sql-script';

describe('splitSqlStatements', () => {
  it('splits on statement terminators and trims the result', () => {
    expect(splitSqlStatements('SELECT 1;\n\n  SELECT 2  ;\n')).toEqual([
      'SELECT 1',
      'SELECT 2',
    ]);
  });

  it('keeps a trailing statement without a semicolon', () => {
    expect(splitSqlStatements('CREATE TABLE t (a INT)')).toEqual(['CREATE TABLE t (a INT)']);
  });

  it('ignores empty statements', () => {
    expect(splitSqlStatements('; ;\n;')).toEqual([]);
  });

  it('does not split on a semicolon inside a string literal', () => {
    expect(
      splitSqlStatements("INSERT INTO t (a) VALUES ('a;b'); INSERT INTO t (a) VALUES ('c');"),
    ).toEqual(["INSERT INTO t (a) VALUES ('a;b')", "INSERT INTO t (a) VALUES ('c')"]);
  });

  it('handles escaped and doubled quotes inside literals', () => {
    expect(splitSqlStatements("INSERT INTO t (a) VALUES ('it''s; fine');")).toEqual([
      "INSERT INTO t (a) VALUES ('it''s; fine')",
    ]);
    expect(splitSqlStatements("INSERT INTO t (a) VALUES ('back\\\\slash;');")).toEqual([
      "INSERT INTO t (a) VALUES ('back\\\\slash;')",
    ]);
  });

  it('keeps a semicolon inside backtick identifiers', () => {
    expect(splitSqlStatements('SELECT `we;ird` FROM t; SELECT 2;')).toEqual([
      'SELECT `we;ird` FROM t',
      'SELECT 2',
    ]);
  });

  it('strips line and block comments, including comment markers inside literals', () => {
    const script = [
      '-- leading comment; with semicolon',
      'SELECT 1; -- trailing comment',
      '# hash comment; also ignored',
      '/* block; comment */ SELECT 2;',
      "SELECT '-- not a comment;' AS literal;",
    ].join('\n');
    expect(splitSqlStatements(script)).toEqual([
      'SELECT 1',
      'SELECT 2',
      "SELECT '-- not a comment;' AS literal",
    ]);
  });

  it('splits the packaged schema migration into whole statements', () => {
    // Guard against a future migration author using MySQL syntax the splitter
    // cannot represent (stored-program bodies) without noticing.
    const file = resolve(__dirname, '../../../../db/migrations/0001_initial_schema.sql');
    const statements = splitSqlStatements(readFileSync(file, 'utf8'));
    expect(statements.length).toBeGreaterThanOrEqual(8);
    for (const statement of statements) {
      expect(statement).toMatch(/^(CREATE TABLE|INSERT INTO)\b/);
    }
  });
});
