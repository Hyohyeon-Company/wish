/**
 * Unit tests of the global error filter's contract mapping: DomainErrors
 * render their own code/status, framework HttpExceptions (routing, body
 * parsing) translate to the contract vocabulary at the exception's status,
 * and anything unexpected stays a sanitized 500 INTERNAL.
 */
import 'reflect-metadata';
import type { ArgumentsHost } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DomainErrorFilter } from '../../src/shared/domain-error.filter';
import { DomainError } from '../../src/shared/domain-error';

describe('DomainErrorFilter', () => {
  let status: jest.Mock;
  let json: jest.Mock;
  let filter: DomainErrorFilter;

  beforeEach(() => {
    status = jest.fn();
    json = jest.fn();
    status.mockImplementation(() => ({ json }));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    filter = new DomainErrorFilter();
  });

  function catchWith(exception: unknown): void {
    const host = {
      switchToHttp: () => ({ getResponse: () => ({ status }) }),
    } as unknown as ArgumentsHost;
    filter.catch(exception, host);
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders a DomainError with its own code, status and message', () => {
    catchWith(new DomainError('EMAIL_TAKEN', '이미 가입된 이메일이에요.'));
    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      code: 'EMAIL_TAKEN',
      message: '이미 가입된 이메일이에요.',
    });
  });

  it('attaches field details to a 400 DomainError only', () => {
    catchWith(
      new DomainError('VALIDATION_FAILED', '입력값을 확인해 주세요.', {
        email: '이메일 형식이 아니에요.',
      }),
    );
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      code: 'VALIDATION_FAILED',
      message: '입력값을 확인해 주세요.',
      fields: { email: '이메일 형식이 아니에요.' },
    });
  });

  it('translates a framework BadRequestException to 400 VALIDATION_FAILED', () => {
    catchWith(new BadRequestException('Unexpected token i in JSON'));
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      code: 'VALIDATION_FAILED',
      message: '요청 본문을 확인해 주세요.',
    });
  });

  it('translates a framework NotFoundException to 404 NOT_FOUND', () => {
    catchWith(new NotFoundException('Cannot GET /api/unknown'));
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      code: 'NOT_FOUND',
      message: '요청을 찾을 수 없어요.',
    });
  });

  it('sanitizes an unexpected error to 500 INTERNAL and logs the detail', () => {
    catchWith(new Error('database connection refused'));
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      code: 'INTERNAL',
      message: '서버에 문제가 발생했어요.',
    });
    expect(json.mock.calls[0][0]).not.toContain('database connection refused');
    expect(console.error).toHaveBeenCalled();
  });
});
