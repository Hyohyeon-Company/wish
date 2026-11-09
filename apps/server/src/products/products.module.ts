import { Module } from '@nestjs/common';
import {
  ChangeProductStatus,
  CreateProduct,
  DeleteProduct,
  FavoriteLookup,
  ListCategories,
  ListMyProducts,
  ListProducts,
  ProductDeletionTransaction,
  ProductFavoriteCleanup,
  ReadProductDetail,
  UploadImage,
  ImageStore,
} from './application/product-use-cases';
import { ProductRepository } from './domain/product';
import { MemberRepository } from '../members/domain/member';
import {
  FavoriteProduct,
  ListFavorites,
  UnfavoriteProduct,
} from '../favorites/application/favorite-use-cases';
import { FavoriteRepository } from '../favorites/domain/favorite';
import { CategoriesController } from '../api/categories.controller';
import { ProductsController } from '../api/products.controller';
import { MyProductsController } from '../api/my-products.controller';
import { FavoritesController } from '../api/favorites.controller';
import { UploadedFilesController } from '../api/uploaded-files.controller';
import { UploadsController } from '../api/uploads.controller';
import { CurrentMemberGuard, OptionalCurrentMemberGuard } from '../api/current-member.guard';
import { InMemoryProductRepository } from './infrastructure/in-memory-product.repository';
import { InMemoryDeletionTransaction } from './infrastructure/in-memory-deletion-transaction';
import { InMemoryFavoriteRepository } from '../favorites/infrastructure/in-memory-favorite.repository';
import { FavoriteRepositoryLookup } from '../favorites/infrastructure/favorite-repository.lookup';
import { FavoriteRepositoryCleanup } from '../favorites/infrastructure/favorite-repository.cleanup';
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
    MyProductsController,
    FavoritesController,
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
    // One favorites store serves both directions: the §2-4 endpoints' write
    // side (FavoriteRepository) and the detail's favorited personalization
    // (FavoriteLookup port — card C6 replaced the C5-time false stub behind
    // the same port, without touching ReadProductDetail or the contract).
    { provide: FavoriteRepository, useClass: InMemoryFavoriteRepository },
    {
      provide: FavoriteLookup,
      useFactory: (favorites: FavoriteRepository) => new FavoriteRepositoryLookup(favorites),
      inject: [FavoriteRepository],
    },
    {
      provide: FavoriteProduct,
      useFactory: (
        products: ProductRepository,
        favorites: FavoriteRepository,
      ) => new FavoriteProduct(products, favorites),
      inject: [ProductRepository, FavoriteRepository],
    },
    {
      provide: UnfavoriteProduct,
      useFactory: (favorites: FavoriteRepository) => new UnfavoriteProduct(favorites),
      inject: [FavoriteRepository],
    },
    {
      provide: ListFavorites,
      useFactory: (favorites: FavoriteRepository, products: ProductRepository) =>
        new ListFavorites(favorites, products),
      inject: [FavoriteRepository, ProductRepository],
    },
    {
      provide: ReadProductDetail,
      useFactory: (
        products: ProductRepository,
        members: MemberRepository,
        favorites: FavoriteLookup,
      ) => new ReadProductDetail(products, members, favorites),
      inject: [ProductRepository, MemberRepository, FavoriteLookup],
    },
    // C7: status change, deletion (with its AC6.2 favorite cleanup inside
    // the deletion transaction boundary) and the my listing read side.
    {
      provide: ChangeProductStatus,
      useFactory: (products: ProductRepository) => new ChangeProductStatus(products),
      inject: [ProductRepository],
    },
    { provide: ProductDeletionTransaction, useClass: InMemoryDeletionTransaction },
    {
      provide: ProductFavoriteCleanup,
      useFactory: (favorites: FavoriteRepository) => new FavoriteRepositoryCleanup(favorites),
      inject: [FavoriteRepository],
    },
    {
      provide: DeleteProduct,
      useFactory: (
        products: ProductRepository,
        favorites: ProductFavoriteCleanup,
        transactions: ProductDeletionTransaction,
      ) => new DeleteProduct(products, favorites, transactions),
      inject: [ProductRepository, ProductFavoriteCleanup, ProductDeletionTransaction],
    },
    {
      provide: ListMyProducts,
      useFactory: (products: ProductRepository) => new ListMyProducts(products),
      inject: [ProductRepository],
    },
    CurrentMemberGuard,
    OptionalCurrentMemberGuard,
  ],
})
export class ProductsModule {}
