/**
 * /api/me/products transport (§2-4, card C7): the authenticated seller's
 * own listings with their status — journey B9's data source and the my-v1
 * 관리 section's binding. Every route is authenticated (CurrentMemberGuard);
 * the member is the authenticated principal, never request input, so 타인의
 * 상품은 부재 (AC8.1's precondition) holds by construction.
 */
import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
// Value import required: DI token (see current-member.guard.ts note).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ListMyProducts } from '../products/application/product-use-cases';
import type { ProductListPage } from '../products/application/product-use-cases';
import { CurrentMemberGuard } from './current-member.guard';

@Controller('api/me/products')
@UseGuards(CurrentMemberGuard)
export class MyProductsController {
  constructor(private readonly listMyProducts: ListMyProducts) {}

  /** §2-4 GET /api/me/products — query: status, page, limit. 0건도 200. */
  @Get()
  async list(
    @Req() request: Request,
    @Query() query: Record<string, unknown>,
  ): Promise<ProductListPage> {
    return this.listMyProducts.execute(query, request.currentMember!);
  }
}
