import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { PropertiesModule } from './properties/properties.module';
import { CatalogModule } from './catalog/catalog.module';
import { GatewayModule } from './gateway/gateway.module';
import { OrdersModule } from './orders/orders.module';
import { DiffusionsModule } from './diffusions/diffusions.module';
import { VerificationsModule } from './verifications/verifications.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { TasksModule } from './tasks/tasks.module';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ActionLogInterceptor } from './common/interceptors/action-log.interceptor';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    CatalogModule,
    GatewayModule,
    AuthModule,
    UsersModule,
    PropertiesModule,
    OrdersModule,
    DiffusionsModule,
    VerificationsModule,
    AnalyticsModule,
    WebhooksModule,
    TasksModule,
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ActionLogInterceptor,
    },
  ],
})
export class AppModule {}
