/**
 * POST /api/products (§2-3): authenticated creation of a listing. Transport
 * validation stays JSON-shape-only; every rule (price, image count, unknown
 * category/condition, required fields) is owned by the Product aggregate.
 * The seller is the authenticated principal — never body input (AC4.4).
 */
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { ProductView } from '../products/application/product-use-cases';
// Value import required: DI token (see current-member.guard.ts note).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { CreateProduct } from '../products/application/product-use-cases';
// Value import required: DI token (see current-member.guard.ts note).
import { CurrentMemberGuard } from './current-member.guard';
import { asRecord } from '../shared/request-body';

@Controller('api/products')
export class ProductsController {
  constructor(private readonly createProduct: CreateProduct) {}

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
