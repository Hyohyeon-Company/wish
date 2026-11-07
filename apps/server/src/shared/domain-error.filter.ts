/**
 * Maps DomainError codes to the API contract's error body
 * (user-flow-v1 §2-0): `{ code, message }`, plus `fields` on 400 only.
 * Anything unexpected becomes a sanitized 500 INTERNAL — internal details
 * are logged, never returned.
 */
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch } from '@nestjs/common';
import { DomainError } from './domain-error';

interface ErrorResponse {
  status(code: number): { json(body: unknown): void };
}

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

    console.error('unhandled error:', exception instanceof Error ? exception.stack : String(exception));
    response.status(500).json({ code: 'INTERNAL', message: '서버에 문제가 발생했어요.' });
  }
}
