import { Module } from '@nestjs/common';
import { GatewayModule } from '../gateway/gateway.module';
import { OrdersModule } from '../orders/orders.module';
import { DiffusionsModule } from '../diffusions/diffusions.module';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [GatewayModule, OrdersModule, DiffusionsModule],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
