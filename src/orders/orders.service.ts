import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { GatewayService } from '../gateway/gateway.service';
import { FulfillmentService } from './fulfillment.service';
import {
  CreateProductOrderDto,
  CreateSubscriptionOrderDto,
} from './dto/orders.dto';

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private gatewayService: GatewayService,
    private fulfillmentService: FulfillmentService,
  ) {}

  private get expirationMinutes(): number {
    const parsed = Number(process.env.QR_EXPIRATION_MINUTES || 30);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 30;
  }

  private generateIdempotencyKey(prefix: 'SUB' | 'PRD'): string {
    const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `ORD-${prefix}-${Date.now()}-${rand}`;
  }

  private formatOrderResponse(order: any) {
    const latestPayment = order.payments?.[0] ?? null;
    const qrBase64 = latestPayment?.qrImageBase64 ?? null;

    return {
      id: order.id,
      idempotencyKey: order.idempotencyKey,
      type: order.type,
      status: order.status,
      amountBs: Number(order.amountBs),
      expiresAt: order.expiresAt,
      paidAt: order.paidAt,
      createdAt: order.createdAt,
      plan: order.plan
        ? {
            id: order.plan.id,
            code: order.plan.code,
            name: order.plan.name,
            monthlyPriceBs: Number(order.plan.monthlyPriceBs),
          }
        : null,
      product: order.product
        ? {
            id: order.product.id,
            code: order.product.code,
            name: order.product.name,
            priceBs: Number(order.product.priceBs),
          }
        : null,
      propertyId: order.propertyId,
      qr: qrBase64
        ? {
            qrImageBase64: qrBase64,
            qrDataUrl: `data:image/png;base64,${qrBase64}`,
            bankQrId: latestPayment?.externalReference ?? null,
            paymentStatus: latestPayment?.status ?? 'PENDIENTE',
          }
        : null,
    };
  }

  async createSubscriptionOrder(userId: string, dto: CreateSubscriptionOrderDto) {
    const plan = await this.prisma.plan.findUnique({
      where: { id: dto.planId },
    });

    if (!plan || !plan.isActive) {
      throw new NotFoundException('El plan seleccionado no está disponible');
    }

    const amount = Number(plan.monthlyPriceBs);
    if (amount <= 0) {
      throw new BadRequestException(
        'El Plan Gratis es el plan base por defecto y no requiere generar orden de pago',
      );
    }

    // Reutilizar orden pendiente vigente (con al menos 2 minutos restantes) para evitar duplicar QRs
    const minValidThreshold = new Date(Date.now() + 2 * 60 * 1000);
    const existingOrder = await this.prisma.order.findFirst({
      where: {
        userId,
        type: 'SUSCRIPCION',
        planId: plan.id,
        status: 'PENDIENTE_PAGO',
        expiresAt: { gt: minValidThreshold },
      },
      include: {
        plan: true,
        product: true,
        payments: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existingOrder && existingOrder.payments[0]?.qrImageBase64) {
      return this.formatOrderResponse(existingOrder);
    }

    const idempotencyKey = this.generateIdempotencyKey('SUB');
    const expMinutes = this.expirationMinutes;

    const qrResponse = await this.gatewayService.generateQr({
      amount,
      idempotencyKey,
      description: `Suscripcion ${plan.name}`,
      expirationMinutes: expMinutes,
    });

    const parsedExp = qrResponse.expirationDate
      ? new Date(qrResponse.expirationDate)
      : null;
    const expiresAt =
      parsedExp && !isNaN(parsedExp.getTime())
        ? parsedExp
        : new Date(Date.now() + expMinutes * 60 * 1000);

    const created = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          idempotencyKey,
          userId,
          type: 'SUSCRIPCION',
          planId: plan.id,
          amountBs: amount,
          status: 'PENDIENTE_PAGO',
          expiresAt,
        },
      });

      await tx.subscription.create({
        data: {
          userId,
          planId: plan.id,
          orderId: order.id,
          status: 'PENDIENTE_PAGO',
        },
      });

      const payment = await tx.payment.create({
        data: {
          orderId: order.id,
          method: 'QR_DINAMICO',
          provider: 'APIBANCO',
          idempotencyKey,
          externalReference: qrResponse.bankQrId || null,
          gatewayTxId: qrResponse.id,
          qrImageBase64: qrResponse.qrImageBase64 || null,
          amountBs: qrResponse.amountTotal,
          amountCommission: qrResponse.amountCommission,
          amountNet: qrResponse.amountNet,
          status: 'PENDIENTE',
          rawPayload: qrResponse as any,
        },
      });

      return {
        ...order,
        plan,
        product: null,
        payments: [payment],
      };
    });

    return this.formatOrderResponse(created);
  }

  async createProductOrder(userId: string, dto: CreateProductOrderDto) {
    const [product, property, user] = await Promise.all([
      this.prisma.product.findUnique({ where: { id: dto.productId } }),
      this.prisma.property.findUnique({ where: { id: dto.propertyId } }),
      this.prisma.user.findUnique({ where: { id: userId } }),
    ]);

    if (!product || !product.isActive) {
      throw new NotFoundException('El producto seleccionado no está disponible');
    }

    if (!property) {
      throw new NotFoundException('El inmueble indicado no existe');
    }

    if (property.userId !== userId && user?.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Solo puedes comprar productos para tus propios inmuebles',
      );
    }

    if (property.status !== 'ACTIVO') {
      throw new BadRequestException(
        'Solo los inmuebles con estado ACTIVO pueden adquirir este producto',
      );
    }

    if (product.includesVerification) {
      if (property.isVerified) {
        throw new BadRequestException('Este inmueble ya cuenta con verificación vigente');
      }
      const activeVerification = await this.prisma.propertyVerification.findFirst({
        where: {
          propertyId: property.id,
          status: { in: ['DOCUMENTOS_PENDIENTES', 'EN_REVISION'] },
        },
      });
      if (activeVerification) {
        throw new BadRequestException(
          'Este inmueble ya tiene un proceso de verificación en curso',
        );
      }
    }

    const minValidThreshold = new Date(Date.now() + 2 * 60 * 1000);
    const existingOrder = await this.prisma.order.findFirst({
      where: {
        userId,
        type: 'PRODUCTO',
        productId: product.id,
        propertyId: property.id,
        status: 'PENDIENTE_PAGO',
        expiresAt: { gt: minValidThreshold },
      },
      include: {
        plan: true,
        product: true,
        payments: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existingOrder && existingOrder.payments[0]?.qrImageBase64) {
      return this.formatOrderResponse(existingOrder);
    }

    const amount = Number(product.priceBs);
    const idempotencyKey = this.generateIdempotencyKey('PRD');
    const expMinutes = this.expirationMinutes;

    const qrResponse = await this.gatewayService.generateQr({
      amount,
      idempotencyKey,
      description: `${product.name} - ${property.title}`.slice(0, 120),
      expirationMinutes: expMinutes,
    });

    const parsedExp = qrResponse.expirationDate
      ? new Date(qrResponse.expirationDate)
      : null;
    const expiresAt =
      parsedExp && !isNaN(parsedExp.getTime())
        ? parsedExp
        : new Date(Date.now() + expMinutes * 60 * 1000);

    const created = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          idempotencyKey,
          userId,
          type: 'PRODUCTO',
          productId: product.id,
          propertyId: property.id,
          amountBs: amount,
          status: 'PENDIENTE_PAGO',
          expiresAt,
        },
      });

      const payment = await tx.payment.create({
        data: {
          orderId: order.id,
          method: 'QR_DINAMICO',
          provider: 'APIBANCO',
          idempotencyKey,
          externalReference: qrResponse.bankQrId || null,
          gatewayTxId: qrResponse.id,
          qrImageBase64: qrResponse.qrImageBase64 || null,
          amountBs: qrResponse.amountTotal,
          amountCommission: qrResponse.amountCommission,
          amountNet: qrResponse.amountNet,
          status: 'PENDIENTE',
          rawPayload: qrResponse as any,
        },
      });

      return {
        ...order,
        plan: null,
        product,
        payments: [payment],
      };
    });

    return this.formatOrderResponse(created);
  }

  async getMyOrders(userId: string) {
    const orders = await this.prisma.order.findMany({
      where: { userId },
      include: {
        plan: true,
        product: true,
        payments: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
    });

    return orders.map((o) => this.formatOrderResponse(o));
  }

  async getOrderById(userId: string, orderId: string) {
    const [order, user] = await Promise.all([
      this.prisma.order.findUnique({
        where: { id: orderId },
        include: {
          plan: true,
          product: true,
          payments: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      }),
      this.prisma.user.findUnique({ where: { id: userId } }),
    ]);

    if (!order) throw new NotFoundException('Orden no encontrada');
    if (order.userId !== userId && user?.role !== 'ADMIN') {
      throw new ForbiddenException('No tienes acceso a esta orden');
    }

    return this.formatOrderResponse(order);
  }

  async syncOrderPayment(userId: string, orderId: string) {
    const [order, user] = await Promise.all([
      this.prisma.order.findUnique({
        where: { id: orderId },
        include: {
          plan: true,
          product: true,
          payments: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      }),
      this.prisma.user.findUnique({ where: { id: userId } }),
    ]);

    if (!order) throw new NotFoundException('Orden no encontrada');
    if (order.userId !== userId && user?.role !== 'ADMIN') {
      throw new ForbiddenException('No tienes acceso a esta orden');
    }

    if (order.status === 'PAGADA') {
      return this.formatOrderResponse(order);
    }

    const synced = await this.gatewayService.forceSyncQr(order.idempotencyKey);

    if (synced.status === 'PAID') {
      await this.fulfillmentService.confirmPaymentFromGateway({
        idempotencyKey: order.idempotencyKey,
        externalReference: synced.bankQrId,
        gatewayTxId: synced.id,
        amountPaid: synced.amountTotal,
        amountCommission: synced.amountCommission,
        amountNet: synced.amountNet,
        paidAt: synced.paidAt,
        rawPayload: synced,
      });
    } else if (synced.status === 'CANCELLED' && order.status === 'PENDIENTE_PAGO') {
      await this.prisma.$transaction([
        this.prisma.order.update({
          where: { id: order.id },
          data: { status: 'EXPIRADA' },
        }),
        this.prisma.payment.updateMany({
          where: { idempotencyKey: order.idempotencyKey },
          data: { status: 'CANCELADO', rawPayload: synced as any },
        }),
      ]);
    }

    return this.getOrderById(userId, order.id);
  }

  async getAdminPayments(status?: string) {
    const where: any = {};
    if (status) {
      where.status = status;
    }

    const orders = await this.prisma.order.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, phone: true, email: true } },
        plan: true,
        product: true,
        property: { select: { id: true, title: true, city: true } },
        payments: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return orders.map((o) => ({
      ...this.formatOrderResponse(o),
      user: o.user,
      property: o.property,
      payments: o.payments.map((p) => ({
        id: p.id,
        status: p.status,
        externalReference: p.externalReference,
        amountBs: Number(p.amountBs),
        amountCommission: p.amountCommission ? Number(p.amountCommission) : null,
        amountNet: p.amountNet ? Number(p.amountNet) : null,
        confirmedAt: p.confirmedAt,
        createdAt: p.createdAt,
      })),
    }));
  }
}
