/**
 * bcrypt password hashing adapter (PasswordHasher port). Salted, adaptive,
 * one-way: plaintext and reversibly-encoded storage are both ruled out
 * (AC5.3). Pure-JS bcryptjs keeps CI free of native build steps.
 */
import bcrypt from 'bcryptjs';
import type { PasswordHasher } from '../members/domain/member';

const BCRYPT_COST = 10;

export class BcryptPasswordHasher implements PasswordHasher {
  async hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, BCRYPT_COST);
  }

  async verify(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }
}
