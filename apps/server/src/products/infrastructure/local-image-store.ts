/**
 * Image storage for uploaded listing photos (§2-2).
 *
 * Recorded decision (user-flow §2-5-3): v1 stores the original file bytes on
 * local disk under `UPLOAD_DIR` (default `./data/uploads`) and serves them
 * from the API itself at `/uploads/<stored-name>`; no external object
 * storage and no thumbnail generation in this slice — the client renders the
 * uploaded image directly, and the `ImageStore` port below is the seam a
 * storage adapter (S3 etc.) would replace without touching the use case.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ImageStore } from '../application/product-use-cases';

export const DEFAULT_UPLOAD_DIR = './data/uploads';

export function uploadDirFromEnv(): string {
  const raw = process.env.UPLOAD_DIR;
  if (raw === undefined || raw.trim() === '') return DEFAULT_UPLOAD_DIR;
  return raw;
}

export class LocalImageStore implements ImageStore {
  private readonly dir: string;

  constructor(dir: string = uploadDirFromEnv()) {
    this.dir = dir;
    mkdirSync(this.dir, { recursive: true });
  }

  /** Persists the bytes and returns the public URL path for the response. */
  async save(data: Buffer, extension: string): Promise<string> {
    const name = `${randomUUID()}.${extension}`;
    writeFileSync(join(this.dir, name), data, { flag: 'wx' });
    return `/uploads/${name}`;
  }
}
