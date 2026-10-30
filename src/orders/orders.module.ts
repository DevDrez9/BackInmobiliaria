import { Module } from '@nestjs/common';
import { GatewayModule } from '../gateway/gateway.module';
import { UsersModule } from '../users/users.module';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { FulfillmentService } from './fulfillment.service';

@Module({
  imports: [GatewayModule, UsersModule],
  controllers: [OrdersController],
  providers: [OrdersService, FulfillmentService],
  exports: [OrdersService, FulfillmentService],
})
export class OrdersModule {}
