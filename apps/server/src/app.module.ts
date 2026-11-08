import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuthModule } from './auth.module';
import { ProductsModule } from './products/products.module';
import { DomainErrorFilter } from './shared/domain-error.filter';

@Module({
  imports: [AuthModule, ProductsModule],
  providers: [{ provide: APP_FILTER, useClass: DomainErrorFilter }],
})
export class AppModule {}
