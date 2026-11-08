/**
 * POST /api/uploads (§2-2): one image per request, authenticated (journey B5
 * uploads happen while the sell form is open). The file is validated by its
 * own bytes, stored, and its public URL + pixel dimensions are returned so
 * the sell form can stack uploaded URLs in submission order.
 */
import {
  Controller,
  HttpCode,
  HttpStatus,
  PayloadTooLargeException,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { catchError, type Observable, throwError } from 'rxjs';
import {
  MAX_UPLOAD_BYTES,
  oversizeImageError,
  type UploadedImageView,
} from '../products/application/product-use-cases';
// Value import required: DI token (see current-member.guard.ts note).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { UploadImage } from '../products/application/product-use-cases';
import { DomainError } from '../shared/domain-error';
import { CurrentMemberGuard } from './current-member.guard';

/**
 * Multer's byte ceiling fires inside FileInterceptor — before the use case's
 * own re-check — and the platform turns its LIMIT_FILE_SIZE into a 413. §2-2
 * fixes the oversize boundary at 400 with `fields.image`, so this route
 * translates the framework's 413 back into the contract error before the
 * global filter renders it (either layer catching the oversize upload must
 * end in the same contract 400).
 */
@Injectable()
export class TranslateOversizeUpload implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown): Observable<unknown> => {
        if (error instanceof PayloadTooLargeException) {
          return throwError(() => oversizeImageError());
        }
        return throwError(() => error);
      }),
    );
  }
}

@Controller('api/uploads')
export class UploadsController {
  constructor(private readonly uploadImage: UploadImage) {}

  @Post()
  @UseGuards(CurrentMemberGuard)
  @UseInterceptors(
    // Outermost: sees the error FileInterceptor's multer middleware throws.
    TranslateOversizeUpload,
    // Multer's default storage keeps the part in memory; the byte ceiling is
    // enforced here and re-checked in the use case (either layer catching it
    // must end in the contract's 400).
    FileInterceptor('image', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }),
  )
  @HttpCode(HttpStatus.CREATED)
  async upload(
    @UploadedFile() file: Parameters<UploadImage['execute']>[0] | undefined,
  ): Promise<UploadedImageView> {
    if (file === undefined) {
      throw new DomainError('VALIDATION_FAILED', '업로드할 이미지를 선택해 주세요.');
    }
    return this.uploadImage.execute(file);
  }
}
