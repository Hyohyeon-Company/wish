import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port);
  console.log(`wish API listening on port ${port}`);
}

void bootstrap();
