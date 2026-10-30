import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { OrdersService } from './orders.service';
import {
  CreateProductOrderDto,
  CreateSubscriptionOrderDto,
} from './dto/orders.dto';

@ApiTags('orders & subscriptions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('subscriptions')
  createSubscriptionOrder(
    @Request() req,
    @Body() dto: CreateSubscriptionOrderDto,
  ) {
    return this.ordersService.createSubscriptionOrder(req.user.id, dto);
  }

  @Post('orders')
  createProductOrder(@Request() req, @Body() dto: CreateProductOrderDto) {
    return this.ordersService.createProductOrder(req.user.id, dto);
  }

  @Get('orders')
  getMyOrders(@Request() req) {
    return this.ordersService.getMyOrders(req.user.id);
  }

  @Get('orders/:id')
  getOrderById(@Request() req, @Param('id') id: string) {
    return this.ordersService.getOrderById(req.user.id, id);
  }

  @Post('orders/:id/sync')
  syncOrderPayment(@Request() req, @Param('id') id: string) {
    return this.ordersService.syncOrderPayment(req.user.id, id);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Get('admin/orders')
  getAdminOrders(@Query('status') status?: string) {
    return this.ordersService.getAdminPayments(status);
  }
}
