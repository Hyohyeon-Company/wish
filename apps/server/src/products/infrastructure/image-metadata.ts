/**
 * Image metadata probing for POST /api/uploads (§2-2).
 *
 * Recorded decision: dimensions and format are read from the file's own
 * bytes (magic-number sniffing via `image-size`), never from the client's
 * declared Content-Type or filename — both are trivially spoofable, and the
 * contract's 400 "이미지 아님" boundary must hold against a mislabeled file.
 * `image-size` is a pure-JS, dependency-free reader; hand-rolling parsers for
 * JPEG/PNG/GIF/WebP was rejected as risk without payoff.
 *
 * Allowed set (recorded, §2-5-3 open item): the four raster formats typical
 * of C2C listing photos — JPEG, PNG, GIF, WebP. Anything else (SVG, HEIC,
 * PDF, …) is refused with a field failure on `image`.
 */
import { imageSize } from 'image-size';
import { FieldValidation } from '../domain/product-field-validation';

export interface ImageMetadata {
  readonly format: 'jpeg' | 'png' | 'gif' | 'webp';
  readonly width: number;
  readonly height: number;
}

const ALLOWED_TYPES: Record<string, ImageMetadata['format']> = {
  jpg: 'jpeg',
  jpeg: 'jpeg',
  png: 'png',
  gif: 'gif',
  webp: 'webp',
};

/** Extension used on disk for a parsed format (never the client filename). */
export function extensionFor(format: ImageMetadata['format']): string {
  switch (format) {
    case 'jpeg':
      return 'jpg';
    case 'png':
      return 'png';
    case 'gif':
      return 'gif';
    case 'webp':
      return 'webp';
  }
}

/**
 * `null` means "not a decodable, allowed image" — callers map that to the
 * contract's 400 VALIDATION_FAILED on the `image` field.
 */
export function parseImageMetadata(buffer: Buffer): ImageMetadata | null {
  if (buffer.byteLength === 0) return null;
  let probe: { width: number; height: number; type?: string };
  try {
    probe = imageSize(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
  } catch {
    return null;
  }
  const format = probe.type === undefined ? null : ALLOWED_TYPES[probe.type] ?? null;
  if (format === null || probe.width <= 0 || probe.height <= 0) {
    return null;
  }
  return { format, width: probe.width, height: probe.height };
}

export function refuseNonImage(): never {
  throw new FieldValidation('image', '이미지 파일을 확인해 주세요.');
}
