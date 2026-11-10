import { Module, type Provider } from '@nestjs/common';
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
import { MysqlProductRepository } from './infrastructure/mysql-product.repository';
import { MysqlDeletionTransaction } from './infrastructure/mysql-deletion-transaction';
import { InMemoryFavoriteRepository } from '../favorites/infrastructure/in-memory-favorite.repository';
import { MysqlFavoriteRepository } from '../favorites/infrastructure/mysql-favorite.repository';
import { FavoriteRepositoryLookup } from '../favorites/infrastructure/favorite-repository.lookup';
import { FavoriteRepositoryCleanup } from '../favorites/infrastructure/favorite-repository.cleanup';
import { LocalImageStore } from './infrastructure/local-image-store';
import { MysqlModule } from '../infrastructure/mysql/mysql.module';
import { SqlClient } from '../infrastructure/mysql/sql-client';
import { storageModeFromEnv } from '../infrastructure/storage/storage-mode';
import { AuthModule } from '../auth.module';

const STORAGE_MODE = storageModeFromEnv();

/**
 * The three persistence ports of this slice switch together: the product
 * store, the favorites store and the deletion transaction must all point at
 * the same backend, or the AC6.2 cleanup would touch a different store than
 * the product write. Image storage is intentionally untouched — uploads stay
 * local-disk in v1 (recorded decision, user-flow §2-5-3).
 */
function productRepositoryProvider(): Provider {
  if (STORAGE_MODE === 'mysql') {
    return {
      provide: ProductRepository,
      useFactory: (client: SqlClient) => new MysqlProductRepository(client),
      inject: [SqlClient],
    };
  }
  return { provide: ProductRepository, useClass: InMemoryProductRepository };
}

function favoriteRepositoryProvider(): Provider {
  if (STORAGE_MODE === 'mysql') {
    return {
      provide: FavoriteRepository,
      useFactory: (client: SqlClient) => new MysqlFavoriteRepository(client),
      inject: [SqlClient],
    };
  }
  return { provide: FavoriteRepository, useClass: InMemoryFavoriteRepository };
}

function deletionTransactionProvider(): Provider {
  if (STORAGE_MODE === 'mysql') {
    return {
      provide: ProductDeletionTransaction,
      useFactory: (client: SqlClient) => new MysqlDeletionTransaction(client),
      inject: [SqlClient],
    };
  }
  return { provide: ProductDeletionTransaction, useClass: InMemoryDeletionTransaction };
}


/**
 * The sell/catalog slice. CurrentMemberGuard is declared here too — the
 * auth module owns its creation, this module needs an instance for its
 * protected controllers; AuthModule exports the AuthenticateMember use case
 * it depends on.
 */
@Module({
  imports: [AuthModule, MysqlModule],
  controllers: [
    CategoriesController,
    UploadsController,
    ProductsController,
    MyProductsController,
    FavoritesController,
    UploadedFilesController,
  ],
  providers: [
    productRepositoryProvider(),
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
    favoriteRepositoryProvider(),
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
    deletionTransactionProvider(),
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
