/**
 * Maps thrown errors to the API contract's error body (user-flow-v1 §2-0):
 * `{ code, message }`, plus `fields` on 400 only.
 *
 * Framework-raised client errors (routing misses, body parsing) are
 * HttpExceptions; they are translated to the contract vocabulary at the
 * exception's own status — a client mistake must never surface as
 * 500 INTERNAL. Anything unexpected becomes a sanitized 500 INTERNAL —
 * internal details are logged, never returned.
 */
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException } from '@nestjs/common';
import { DomainError, type ErrorCode } from './domain-error';

interface ErrorResponse {
  status(code: number): { json(body: unknown): void };
}

/** Contract rendering for framework-raised statuses, by HTTP status code. */
const FRAMEWORK_TRANSLATION: Record<number, { code: ErrorCode; message: string }> = {
  400: { code: 'VALIDATION_FAILED', message: '요청 본문을 확인해 주세요.' },
  401: { code: 'UNAUTHORIZED', message: '로그인이 필요해요.' },
  403: { code: 'FORBIDDEN', message: '권한이 없어요.' },
  404: { code: 'NOT_FOUND', message: '요청을 찾을 수 없어요.' },
  405: { code: 'NOT_FOUND', message: '요청을 찾을 수 없어요.' },
  413: { code: 'VALIDATION_FAILED', message: '요청 본문을 확인해 주세요.' },
  422: { code: 'VALIDATION_FAILED', message: '요청 본문을 확인해 주세요.' },
};

@Catch()
export class DomainErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<ErrorResponse>();

    if (exception instanceof DomainError) {
      const body: Record<string, unknown> = {
        code: exception.code,
        message: exception.message,
      };
      if (exception.fields !== undefined && exception.httpStatus === 400) {
        body.fields = exception.fields;
      }
      response.status(exception.httpStatus).json(body);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const translation = FRAMEWORK_TRANSLATION[status];
      if (translation !== undefined) {
        response.status(status).json({
          code: translation.code,
          message: translation.message,
        });
        return;
      }
    }

    console.error('unhandled error:', exception instanceof Error ? exception.stack : String(exception));
    response.status(500).json({ code: 'INTERNAL', message: '서버에 문제가 발생했어요.' });
  }
}
