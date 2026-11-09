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
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
  CreateProduct,
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
}
