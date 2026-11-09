/**
 * /api/products transport (§2-3): the public GET listing and the
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
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type {
  ProductListPage,
  ProductView,
} from '../products/application/product-use-cases';
// Value import required: DI token (see current-member.guard.ts note).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { CreateProduct, ListProducts } from '../products/application/product-use-cases';
// Value import required: DI token (see current-member.guard.ts note).
import { CurrentMemberGuard } from './current-member.guard';
import { asRecord } from '../shared/request-body';

@Controller('api/products')
export class ProductsController {
  constructor(
    private readonly listProducts: ListProducts,
    private readonly createProduct: CreateProduct,
  ) {}

  @Get()
  async list(@Query() query: Record<string, unknown>): Promise<ProductListPage> {
    return this.listProducts.execute(query);
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
