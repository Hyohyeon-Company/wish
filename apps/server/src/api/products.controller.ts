/**
 * /api/products transport (§2-3): the public GET listing, the public GET
 * {id} detail (favorited personalized through the optional guard) and the
 * authenticated POST creation. Query-string legality (page/limit bounds,
 * known sort/category/status values) is owned by the ProductListingQuery
 * value object — the controller only hands the raw map over. Body
 * validation stays JSON-shape-only; every creation rule lives in the
 * Product aggregate. The seller is the authenticated principal — never
 * body input (AC4.4).
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type {
  ProductDetailView,
  ProductListPage,
  ProductView,
} from '../products/application/product-use-cases';
// Value import required: DI token (see current-member.guard.ts note).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
  ChangeProductStatus,
  CreateProduct,
  DeleteProduct,
  ListProducts,
  ReadProductDetail,
} from '../products/application/product-use-cases';
// Value import required: DI token (see current-member.guard.ts note).
import {
  CurrentMemberGuard,
  OptionalCurrentMemberGuard,
} from './current-member.guard';
import { asRecord } from '../shared/request-body';

@Controller('api/products')
export class ProductsController {
  constructor(
    private readonly listProducts: ListProducts,
    private readonly createProduct: CreateProduct,
    private readonly readProductDetail: ReadProductDetail,
    private readonly changeProductStatus: ChangeProductStatus,
    private readonly deleteProduct: DeleteProduct,
  ) {}

  @Get()
  async list(@Query() query: Record<string, unknown>): Promise<ProductListPage> {
    return this.listProducts.execute(query);
  }

  /**
   * §2-3 GET /api/products/{id} — a public read (§3 detail-v1 row) that
   * personalizes `favorited` when a live bearer token is presented; the
   * optional guard leaves the request a guest otherwise. Deleted and
   * unknown products surface as the contract's 404 NOT_FOUND.
   */
  @Get(':id')
  @UseGuards(OptionalCurrentMemberGuard)
  async detail(
    @Param('id') id: string,
    @Req() request: Request,
  ): Promise<ProductDetailView> {
    return this.readProductDetail.execute(id, request.currentMember ?? null);
  }

  @Post()
  @UseGuards(CurrentMemberGuard)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Req() request: Request,
    @Body() body: unknown,
  ): Promise<{ product: ProductView }> {
    const raw = asRecord(body);
    return this.createProduct.execute(raw, request.currentMember!);
  }

  /**
   * §2-3 PATCH /api/products/{id}/status {status} (card C7, B10) — the
   * authenticated seller's own status change. Route order matters: this
   * `/status` sub-route is declared before any conflicting `:id` PATCH
   * route could shadow it (there is none, but the contract path is fixed).
   */
  @Patch(':id/status')
  @UseGuards(CurrentMemberGuard)
  async changeStatus(
    @Param('id') id: string,
    @Req() request: Request,
    @Body() body: unknown,
  ): Promise<{ product: ProductView }> {
    return this.changeProductStatus.execute(id, asRecord(body), request.currentMember!);
  }

  /** §2-3 DELETE /api/products/{id} (card C7, B12) — 204, 찜 정리 포함. */
  @Delete(':id')
  @UseGuards(CurrentMemberGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @Req() request: Request): Promise<void> {
    await this.deleteProduct.execute(id, request.currentMember!);
  }
}
