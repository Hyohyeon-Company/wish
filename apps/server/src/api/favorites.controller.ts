/**
 * /api/favorites transport (§2-4, card C6). Every route is authenticated
 * (CurrentMemberGuard) — 등록·찜·상태변경·마이·업로드 are the 401-boundary
 * operations (§2-0). Body/query legality stays with the domain: the
 * product_id field check and the page/limit value object produce the
 * contract's 400-with-fields shape; the member is always the authenticated
 * principal, never request input.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { FavoriteListPage } from '../favorites/application/favorite-use-cases';
// Value import required: DI token (see current-member.guard.ts note).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
  FavoriteProduct,
  ListFavorites,
  UnfavoriteProduct,
} from '../favorites/application/favorite-use-cases';
import { CurrentMemberGuard } from './current-member.guard';
import { asRecord } from '../shared/request-body';

@Controller('api/favorites')
@UseGuards(CurrentMemberGuard)
export class FavoritesController {
  constructor(
    private readonly favoriteProduct: FavoriteProduct,
    private readonly unfavoriteProduct: UnfavoriteProduct,
    private readonly listFavorites: ListFavorites,
  ) {}

  /**
   * §2-4 POST /api/favorites {product_id} — 201 신규 / 200 이미 찜함(멱등).
   * The status is the contract's observable distinction, so it is set per
   * response (passthrough) instead of a static @HttpCode.
   */
  @Post()
  async create(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: unknown,
  ): Promise<{ favorited: boolean }> {
    const raw = asRecord(body);
    const result = await this.favoriteProduct.execute(
      raw.product_id,
      request.currentMember!,
    );
    // 201 신규 / 200 이미 찜함(멱등) — the status IS the contract's
    // distinction; the body is the same {favorited: true} for both.
    response.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
    return { favorited: result.favorited };
  }

  /** §2-4 DELETE /api/favorites/{productId} — 204 멱등. */
  @Delete(':productId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('productId') productId: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.unfavoriteProduct.execute(productId, request.currentMember!);
  }

  /** §2-4 GET /api/favorites — 최신 찜순 ProductCard page, 0건도 200. */
  @Get()
  async list(
    @Req() request: Request,
    @Query() query: Record<string, unknown>,
  ): Promise<FavoriteListPage> {
    return this.listFavorites.execute(query, request.currentMember!);
  }
}
