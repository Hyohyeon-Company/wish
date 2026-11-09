/**
 * GET /api/categories (§2-2): public, fixed flat list in display order.
 */
import { Controller, Get } from '@nestjs/common';
// Value import required: DI token (see current-member.guard.ts note).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ListCategories, type CategoryView } from '../products/application/product-use-cases';

@Controller('api/categories')
export class CategoriesController {
  constructor(private readonly listCategories: ListCategories) {}

  @Get()
  list(): CategoryView[] {
    return this.listCategories.execute();
  }
}
