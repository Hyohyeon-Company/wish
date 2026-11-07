/**
 * Application use cases with the real in-memory adapters: the AC5.1/5.2/5.3
 * domain tests the C1 card names — duplicate email 409, generalized 401,
 * hash storage — plus token issuance/verification behavior.
 */
import 'reflect-metadata';
import { SignUpMember, LogInMember, AuthenticateMember } from '../../src/members/application/auth-use-cases';
import { InvalidCredentialsError } from '../../src/members/domain/member-errors';
import { BcryptPasswordHasher } from '../../src/infrastructure/bcrypt-password-hasher';
import { InMemoryMemberRepository } from '../../src/infrastructure/in-memory-member.repository';
import { SessionTokenService } from '../../src/infrastructure/session-token.service';

const VALID_SIGNUP = {
  email: 'seller@example.com',
  password: 'Str0ng-Pass!',
  nickname: '판매자',
  region: '서울',
};

function buildHarness(options: { tokenTtlSeconds?: number; clock?: () => number } = {}) {
  const members = new InMemoryMemberRepository();
  const hasher = new BcryptPasswordHasher();
  const tokens = new SessionTokenService(
    options.tokenTtlSeconds ?? 604800,
    options.clock ?? (() => Date.now()),
  );
  return {
    members,
    hasher,
    tokens,
    signUp: new SignUpMember(members, hasher, tokens),
    logIn: new LogInMember(members, hasher, tokens),
    authenticate: new AuthenticateMember(members, tokens),
  };
}

describe('SignUpMember', () => {
  it('creates the member, issues a token and returns the hash-free public view', async () => {
    const { signUp, members } = buildHarness();
    const result = await signUp.execute({ ...VALID_SIGNUP });

    expect(result.token).toBeTruthy();
    expect(result.member).toEqual({
      id: expect.any(String),
      email: 'seller@example.com',
      nickname: '판매자',
      region: '서울',
      created_at: expect.any(String),
    });
    expect(Object.keys(result.member)).toEqual([
      'id',
      'email',
      'nickname',
      'region',
      'created_at',
    ]);
    // AC5.3: what reached the store is a bcrypt hash, not the typed password.
    const stored = await members.findById(result.member.id);
    expect(stored).not.toBeNull();
    expect(stored?.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(stored?.passwordHash).not.toContain(VALID_SIGNUP.password);
  });

  it('refuses a duplicate email with the 409 EMAIL_TAKEN contract error', async () => {
    const { signUp } = buildHarness();
    await signUp.execute({ ...VALID_SIGNUP });
    await expect(
      signUp.execute({ ...VALID_SIGNUP, password: 'Other-Pass-9', nickname: '다른사람' }),
    ).rejects.toMatchObject({
      code: 'EMAIL_TAKEN',
      httpStatus: 409,
      message: '이미 가입된 이메일이에요.',
    });
  });

  it('treats an existing email case-insensitively', async () => {
    const { signUp } = buildHarness();
    await signUp.execute({ ...VALID_SIGNUP });
    await expect(
      signUp.execute({ ...VALID_SIGNUP, email: 'SELLER@EXAMPLE.COM' }),
    ).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
  });
});

describe('LogInMember', () => {
  it('fails with ONE generalized 401 for unknown email and for wrong password alike', async () => {
    const { signUp, logIn } = buildHarness();
    await signUp.execute({ ...VALID_SIGNUP });

    const unknownEmail = await logIn
      .execute({ email: 'nobody@example.com', password: VALID_SIGNUP.password })
      .catch((error) => error);
    const wrongPassword = await logIn
      .execute({ email: VALID_SIGNUP.email, password: 'totally-wrong' })
      .catch((error) => error);

    for (const failure of [unknownEmail, wrongPassword]) {
      expect(failure).toBeInstanceOf(InvalidCredentialsError);
      expect(failure.code).toBe('UNAUTHORIZED');
      expect(failure.httpStatus).toBe(401);
      expect(failure.message).toBe('이메일 또는 비밀번호가 올바르지 않아요.');
    }
    expect(unknownEmail.message).toBe(wrongPassword.message);
  });

  it('succeeds with a fresh token for correct credentials', async () => {
    const { signUp, logIn } = buildHarness();
    await signUp.execute({ ...VALID_SIGNUP });
    const result = await logIn.execute({
      email: 'Seller@Example.com',
      password: VALID_SIGNUP.password,
    });
    expect(result.token).toBeTruthy();
    expect(result.member.email).toBe('seller@example.com');
  });
});

describe('AuthenticateMember + SessionTokenService', () => {
  it('resolves the member for a live token and rejects unknown tokens', async () => {
    const { signUp, authenticate, tokens } = buildHarness();
    const signup = await signUp.execute({ ...VALID_SIGNUP });

    const member = await authenticate.memberFor(signup.token);
    expect(member.id).toBe(signup.member.id);
    await expect(authenticate.memberFor('not-a-real-token')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      httpStatus: 401,
    });
    await expect(authenticate.memberFor(undefined)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    // The token is opaque: it is not the member id or any decodable payload.
    expect(signup.token).not.toContain(signup.member.id);
    expect(await tokens.verifyMemberId(signup.token)).toBe(signup.member.id);
  });

  it('expires tokens after the configured TTL', async () => {
    let now = 1_000_000;
    const { signUp, authenticate } = buildHarness({
      tokenTtlSeconds: 60,
      clock: () => now,
    });
    const signup = await signUp.execute({ ...VALID_SIGNUP });
    expect((await authenticate.memberFor(signup.token)).id).toBe(signup.member.id);
    now += 61_000;
    await expect(authenticate.memberFor(signup.token)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('revokes the session on logout so the token stops working', async () => {
    const { signUp, authenticate } = buildHarness();
    const signup = await signUp.execute({ ...VALID_SIGNUP });
    await authenticate.revoke(signup.token);
    await expect(authenticate.memberFor(signup.token)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});
