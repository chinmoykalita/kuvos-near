import { NestFactory } from '@nestjs/core';
import type { Server } from 'node:http';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.enableCors({
    origin: [
      // The kuvos-near web app sends the Better Auth session cookie.
      process.env.WEB_ORIGIN ?? 'http://localhost:8090',
    ],
    credentials: true,
  });
  app.enableShutdownHooks();
  app.setGlobalPrefix('api');

  const server = (await app.listen(
    Number(process.env.PORT ?? 3001),
    '0.0.0.0',
  )) as Server;
  // Mobile HTTP stacks reuse idle sockets well past Node's 5s default, so a
  // request sent after a pause can land on a socket the server is closing.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
}

void bootstrap();
