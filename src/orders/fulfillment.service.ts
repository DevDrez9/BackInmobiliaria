import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface ConfirmGatewayPaymentInput {
  idempotencyKey: string;
  externalReference?: string;
  gatewayTxId?: number;
  amountPaid: number;
  amountCommission?: number;
  amountNet?: number;
  paidAt?: string | Date | null;
  rawPayload: any;
}

@Injectable()
export class FulfillmentService {
  private readonly logger = new Logger(FulfillmentService.name);

  constructor(private prisma: PrismaService) {}

  private buildInitialPostText(property: {
    title: string;
    listingType: string;
    propertyType: string;
    price: number;
    currency: string;
    city: string;
    zone?: string | null;
    bedrooms?: number | null;
    description: string;
  }): string {
    const location = property.zone
      ? `${property.zone}, ${property.city}`
      : property.city;
    const bedroomsLine = property.bedrooms
      ? `🛏️ Dormitorios: ${property.bedrooms}\n`
      : '';
    return (
      `🏠 ${property.listingType} — ${property.title}\n` +
      `📍 Ubicación: ${location}\n` +
      `💰 Precio: ${property.price.toLocaleString('es-BO')} ${property.currency}\n` +
      bedroomsLine +
      `\n${property.description.slice(0, 300)}`
    );
  }

  async confirmPaymentFromGateway(input: ConfirmGatewayPaymentInput) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: {
          plan: true,
          product: true,
          property: true,
          user: true,
          payments: true,
        },
      });

      if (!order) {
        this.logger.warn(
          `Orden no encontrada para idempotencyKey=${input.idempotencyKey}`,
        );
        return { found: false, alreadyProcessed: false };
      }

      // Idempotencia: si la orden ya fue pagada, no activar dos veces
      if (order.status === 'PAGADA') {
        return { found: true, alreadyProcessed: true, orderId: order.id };
      }

      if (input.externalReference) {
        const duplicateRef = await tx.payment.findUnique({
          where: { externalReference: input.externalReference },
        });
        if (duplicateRef && duplicateRef.status === 'CONFIRMADO') {
          return { found: true, alreadyProcessed: true, orderId: order.id };
        }
      }

      const expectedAmount = Number(order.amountBs);
      const paidAmount = Number(input.amountPaid);

      // Verificar monto exacto (tolerancia de centavos por punto flotante)
      if (Math.abs(paidAmount - expectedAmount) > 0.01) {
        this.logger.error(
          `Discrepancia de monto en orden ${order.id}: esperado=${expectedAmount}, pagado=${paidAmount}`,
        );

        await tx.order.update({
          where: { id: order.id },
          data: { status: 'EN_REVISION' },
        });

        await tx.payment.updateMany({
          where: { idempotencyKey: input.idempotencyKey },
          data: {
            rawPayload: input.rawPayload,
            amountBs: paidAmount,
          },
        });

        await tx.notification.create({
          data: {
            userId: order.userId,
            title: 'Pago en revisión',
            message: `Recibimos un pago de ${paidAmount} Bs que no coincide con el monto de la orden (${expectedAmount} Bs). Un administrador lo revisará en breve.`,
            type: 'PAYMENT_REVIEW',
            metadata: { orderId: order.id },
          },
        });

        return { found: true, alreadyProcessed: false, status: 'EN_REVISION' };
      }

      const confirmedDate = input.paidAt ? new Date(input.paidAt) : new Date();

      // 1. Confirmar el pago y la orden
      await tx.payment.update({
        where: { idempotencyKey: input.idempotencyKey },
        data: {
          status: 'CONFIRMADO',
          externalReference: input.externalReference || undefined,
          gatewayTxId: input.gatewayTxId ?? undefined,
          amountCommission: input.amountCommission ?? undefined,
          amountNet: input.amountNet ?? undefined,
          confirmedAt: confirmedDate,
          rawPayload: input.rawPayload,
        },
      });

      await tx.order.update({
        where: { id: order.id },
        data: {
          status: 'PAGADA',
          paidAt: confirmedDate,
        },
      });

      // 2. Activar lo comprado dentro de la misma transacción
      if (order.type === 'SUSCRIPCION' && order.plan) {
        const now = new Date();

        // Buscar si tiene una suscripción activa vigente del mismo plan para extender
        const currentActiveSub = await tx.subscription.findFirst({
          where: {
            userId: order.userId,
            status: 'ACTIVA',
            endDate: { gt: now },
          },
          orderBy: { endDate: 'desc' },
        });

        let baseEndDate = now;
        if (currentActiveSub && currentActiveSub.planId === order.plan.id && currentActiveSub.endDate) {
          baseEndDate = currentActiveSub.endDate;
        }

        // Cerrar suscripciones activas previas para dejar una sola vigente
        if (currentActiveSub) {
          await tx.subscription.updateMany({
            where: {
              userId: order.userId,
              status: 'ACTIVA',
              id: { not: undefined },
            },
            data: { status: 'CANCELADA' },
          });
        }

        const endDate = new Date(baseEndDate);
        endDate.setMonth(endDate.getMonth() + 1);

        await tx.subscription.upsert({
          where: { orderId: order.id },
          update: {
            status: 'ACTIVA',
            startDate: now,
            endDate,
            reminderSent: false,
          },
          create: {
            userId: order.userId,
            planId: order.plan.id,
            orderId: order.id,
            status: 'ACTIVA',
            startDate: now,
            endDate,
            reminderSent: false,
          },
        });

        await tx.user.update({
          where: { id: order.userId },
          data: { currentPlanId: order.plan.id },
        });

        // Reactivar inmuebles PAUSADO hasta el nuevo límite del plan
        const activeCount = await tx.property.count({
          where: { userId: order.userId, status: 'ACTIVO' },
        });

        const planMax = order.plan.maxActiveProperties;
        const effectiveMax =
          planMax === null
            ? Number.MAX_SAFE_INTEGER
            : Math.max(planMax, order.user.customMaxProperties ?? 0);

        const slotsAvailable = Math.max(0, effectiveMax - activeCount);
        if (slotsAvailable > 0) {
          const pausedProps = await tx.property.findMany({
            where: { userId: order.userId, status: 'PAUSADO' },
            orderBy: { createdAt: 'desc' },
            take:
              slotsAvailable === Number.MAX_SAFE_INTEGER
                ? undefined
                : slotsAvailable,
            select: { id: true },
          });

          if (pausedProps.length > 0) {
            await tx.property.updateMany({
              where: { id: { in: pausedProps.map((p) => p.id) } },
              data: { status: 'ACTIVO' },
            });
          }
        }

        await tx.notification.create({
          data: {
            userId: order.userId,
            title: `¡${order.plan.name} activado!`,
            message: `Tu suscripción al ${order.plan.name} ya está activa hasta el ${endDate.toISOString().split('T')[0]}.`,
            type: 'SUBSCRIPTION_ACTIVATED',
            metadata: { orderId: order.id, planCode: order.plan.code },
          },
        });
      } else if (order.type === 'PRODUCTO' && order.product && order.propertyId && order.property) {
        const now = new Date();
        const activatedItems: string[] = [];

        // A) Destacado en el mapa
        if (order.product.featuredDays && order.product.featuredDays > 0) {
          const currentFeaturedUntil = order.property.featuredUntil;
          const startDate =
            currentFeaturedUntil && currentFeaturedUntil > now
              ? currentFeaturedUntil
              : now;
          const endDate = new Date(
            startDate.getTime() + order.product.featuredDays * 24 * 60 * 60 * 1000,
          );

          await tx.propertyBoost.create({
            data: {
              propertyId: order.propertyId,
              orderId: order.id,
              startDate,
              endDate,
              status: 'ACTIVO',
            },
          });

          await tx.property.update({
            where: { id: order.propertyId },
            data: { featuredUntil: endDate },
          });

          activatedItems.push(`Destacado (${order.product.featuredDays} días)`);
        }

        // B) Difusión en redes sociales
        if (order.product.includesDiffusion) {
          const draftPost = this.buildInitialPostText(order.property);
          await tx.socialDiffusion.create({
            data: {
              userId: order.userId,
              propertyId: order.propertyId,
              orderId: order.id,
              isFreeQuota: false,
              status: 'PENDIENTE',
              postText: draftPost,
            },
          });
          activatedItems.push('Difusión en redes (en cola de revisión)');
        }

        // C) Verificación documental
        if (order.product.includesVerification) {
          const verification = await tx.propertyVerification.create({
            data: {
              propertyId: order.propertyId,
              orderId: order.id,
              status: 'DOCUMENTOS_PENDIENTES',
              documents: [],
            },
          });
          activatedItems.push(
            `Verificación iniciada (ID: ${verification.id} — sube los documentos requeridos)`,
          );
        }

        await tx.notification.create({
          data: {
            userId: order.userId,
            title: `Pago confirmado: ${order.product.name}`,
            message: `Se activó para "${order.property.title}": ${activatedItems.join(', ')}.`,
            type: 'PRODUCT_ACTIVATED',
            metadata: {
              orderId: order.id,
              propertyId: order.propertyId,
              productCode: order.product.code,
            },
          },
        });
      }

      return { found: true, alreadyProcessed: false, status: 'PAGADA', orderId: order.id };
    });
  }
}
