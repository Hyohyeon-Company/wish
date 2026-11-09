/**
 * Serving endpoint for uploaded images: GET /uploads/<stored-name>.
 * The stored name is server-generated (UUID + known extension), so the route
 * pattern rejects anything else — path traversal and arbitrary reads have no
 * input surface. Missing files answer the contract 404 shape.
 */
import {
  Controller,
  Get,
  Param,
  Res,
} from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Response } from 'express';
import { DomainError } from '../shared/domain-error';
import { uploadDirFromEnv } from '../products/infrastructure/local-image-store';

const NAME_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|gif|webp)$/;

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

@Controller('uploads')
export class UploadedFilesController {
  @Get(':name')
  serve(@Param('name') name: string, @Res() response: Response): void {
    if (!NAME_PATTERN.test(name)) {
      throw new DomainError('NOT_FOUND', '요청을 찾을 수 없어요.');
    }
    try {
      const data = readFileSync(join(uploadDirFromEnv(), name));
      response
        .type(CONTENT_TYPE_BY_EXTENSION[name.split('.').pop() ?? ''] ?? 'application/octet-stream')
        .send(data);
    } catch {
      throw new DomainError('NOT_FOUND', '요청을 찾을 수 없어요.');
    }
  }
}
