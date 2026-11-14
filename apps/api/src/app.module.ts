import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { AppController } from './app.controller';
import { createAuth } from './auth';
import { CareController } from './care.controller';
import { CareService } from './care.service';
import { DatabaseModule } from './database/database.module';
import { PrismaService } from './database/prisma.service';
import { WorkflowModule } from './workflow.module';
import { ChatModule } from './chat/chat.module';
import { NearModule } from './near/near.module';
import { NotificationService } from './notification.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    DatabaseModule,
    NearModule,
    WorkflowModule,
    ChatModule,
    AuthModule.forRootAsync({
      imports: [DatabaseModule],
      inject: [PrismaService, ConfigService],
      useFactory: (prisma: PrismaService, config: ConfigService) => ({
        auth: createAuth(prisma, config),
      }),
    }),
  ],
  controllers: [AppController, CareController],
  providers: [CareService, NotificationService],
})
export class AppModule {}
