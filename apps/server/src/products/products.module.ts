import { Module } from '@nestjs/common';
import {
  CreateProduct,
  FavoriteLookup,
  ListCategories,
  ListProducts,
  ReadProductDetail,
  UploadImage,
  ImageStore,
} from './application/product-use-cases';
import { ProductRepository } from './domain/product';
import { MemberRepository } from '../members/domain/member';
import { CategoriesController } from '../api/categories.controller';
import { ProductsController } from '../api/products.controller';
import { UploadedFilesController } from '../api/uploaded-files.controller';
import { UploadsController } from '../api/uploads.controller';
import { CurrentMemberGuard, OptionalCurrentMemberGuard } from '../api/current-member.guard';
import { InMemoryProductRepository } from './infrastructure/in-memory-product.repository';
import { InMemoryFavoriteReader } from './infrastructure/in-memory-favorite.reader';
import { LocalImageStore } from './infrastructure/local-image-store';
import { AuthModule } from '../auth.module';

/**
 * The sell/catalog slice. CurrentMemberGuard is declared here too — the
 * auth module owns its creation, this module needs an instance for its
 * protected controllers; AuthModule exports the AuthenticateMember use case
 * it depends on.
 */
@Module({
  imports: [AuthModule],
  controllers: [
    CategoriesController,
    UploadsController,
    ProductsController,
    UploadedFilesController,
  ],
  providers: [
    { provide: ProductRepository, useClass: InMemoryProductRepository },
    { provide: ImageStore, useClass: LocalImageStore },
    // Explicit factories: the use cases stay framework-free (no @Injectable),
    // mirroring the auth module's wiring.
    {
      provide: ListCategories,
      useFactory: () => new ListCategories(),
    },
    {
      provide: UploadImage,
      useFactory: (images: ImageStore) => new UploadImage(images),
      inject: [ImageStore],
    },
    {
      provide: CreateProduct,
      useFactory: (products: ProductRepository) => new CreateProduct(products),
      inject: [ProductRepository],
    },
    {
      provide: ListProducts,
      useFactory: (products: ProductRepository) => new ListProducts(products),
      inject: [ProductRepository],
    },
    { provide: FavoriteLookup, useClass: InMemoryFavoriteReader },
    {
      provide: ReadProductDetail,
      useFactory: (
        products: ProductRepository,
        members: MemberRepository,
        favorites: FavoriteLookup,
      ) => new ReadProductDetail(products, members, favorites),
      inject: [ProductRepository, MemberRepository, FavoriteLookup],
    },
    CurrentMemberGuard,
    OptionalCurrentMemberGuard,
  ],
})
export class ProductsModule {}
