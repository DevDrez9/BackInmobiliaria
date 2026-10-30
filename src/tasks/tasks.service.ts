import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogService } from '../catalog/catalog.service';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private prisma: PrismaService,
    private catalogService: CatalogService,
  ) {}

  // 1. Cada 5 minutos: Expirar órdenes PENDIENTE_PAGO cuyo QR haya vencido
  @Cron(CronExpression.EVERY_5_MINUTES)
  async expirePendingOrders() {
    const now = new Date();
    const expiredOrders = await this.prisma.order.findMany({
      where: {
        status: 'PENDIENTE_PAGO',
        expiresAt: { lt: now },
      },
      select: { id: true, idempotencyKey: true },
    });

    if (expiredOrders.length === 0) return;

    const orderIds = expiredOrders.map((o) => o.id);
    const keys = expiredOrders.map((o) => o.idempotencyKey);

    await this.prisma.$transaction([
      this.prisma.order.updateMany({
        where: { id: { in: orderIds }, status: 'PENDIENTE_PAGO' },
        data: { status: 'EXPIRADA' },
      }),
      this.prisma.payment.updateMany({
        where: { idempotencyKey: { in: keys }, status: 'PENDIENTE' },
        data: { status: 'CANCELADO' },
      }),
      this.prisma.subscription.updateMany({
        where: { orderId: { in: orderIds }, status: 'PENDIENTE_PAGO' },
        data: { status: 'CANCELADA' },
      }),
    ]);

    this.logger.log(`Órdenes expiradas automáticamente: ${orderIds.length}`);
  }

  // 2. Cada hora: Vencer destacados en el mapa
  @Cron(CronExpression.EVERY_HOUR)
  async expirePropertyBoosts() {
    const now = new Date();

    const [boostsResult, propsResult] = await this.prisma.$transaction([
      this.prisma.propertyBoost.updateMany({
        where: { status: 'ACTIVO', endDate: { lt: now } },
        data: { status: 'VENCIDO' },
      }),
      this.prisma.property.updateMany({
        where: { featuredUntil: { lt: now } },
        data: { featuredUntil: null },
      }),
    ]);

    if (boostsResult.count > 0 || propsResult.count > 0) {
      this.logger.log(
        `Destacados vencidos: boosts=${boostsResult.count}, properties=${propsResult.count}`,
      );
    }
  }

  // 3. Diario (00:05): Vencer suscripciones y pausar inmuebles excedentes
  @Cron('0 5 0 * * *')
  async expireSubscriptionsAndPauseExcess() {
    const now = new Date();
    const expiredSubs = await this.prisma.subscription.findMany({
      where: {
        status: 'ACTIVA',
        endDate: { lt: now },
      },
      include: {
        user: true,
        plan: true,
      },
    });

    if (expiredSubs.length === 0) return;

    const freePlan = await this.catalogService.ensureDefaultFreePlan();

    for (const sub of expiredSubs) {
      await this.prisma.$transaction(async (tx) => {
        await tx.subscription.update({
          where: { id: sub.id },
          data: { status: 'VENCIDA' },
        });

        // Verificar si el usuario tiene otra suscripción activa posterior
        const otherActive = await tx.subscription.findFirst({
          where: {
            userId: sub.userId,
            status: 'ACTIVA',
            endDate: { gt: now },
          },
        });

        if (otherActive || sub.user.role === 'ADMIN') {
          return;
        }

        await tx.user.update({
          where: { id: sub.userId },
          data: { currentPlanId: freePlan.id },
        });

        const baseLimit = freePlan.maxActiveProperties ?? 1;
        const effectiveLimit =
          sub.user.customMaxProperties !== null &&
          sub.user.customMaxProperties !== undefined
            ? Math.max(sub.user.customMaxProperties, baseLimit)
            : baseLimit;

        const activeProps = await tx.property.findMany({
          where: { userId: sub.userId, status: 'ACTIVO' },
          orderBy: { createdAt: 'desc' }, // El más reciente se mantiene activo
          select: { id: true },
        });

        const excessProps = activeProps.slice(effectiveLimit);
        if (excessProps.length > 0) {
          await tx.property.updateMany({
            where: { id: { in: excessProps.map((p) => p.id) } },
            data: { status: 'PAUSADO' },
          });
        }

        await tx.notification.create({
          data: {
            userId: sub.userId,
            title: 'Tu suscripción ha vencido',
            message:
              excessProps.length > 0
                ? `Tu ${sub.plan.name} venció y tu cuenta volvió al Plan Gratis. Se pausaron ${excessProps.length} inmueble(s) excedente(s) sin borrarlos; al renovar se reactivarán automáticamente.`
                : `Tu ${sub.plan.name} venció y tu cuenta volvió al Plan Gratis.`,
            type: 'SUBSCRIPTION_EXPIRED',
            metadata: {
              subscriptionId: sub.id,
              pausedCount: excessProps.length,
            },
          },
        });
      });
    }

    this.logger.log(`Suscripciones vencidas procesadas: ${expiredSubs.length}`);
  }

  // 4. Diario (09:00): Recordatorio de renovación 3 días antes del vencimiento
  @Cron('0 0 9 * * *')
  async sendRenewalReminders() {
    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    const expiringSoon = await this.prisma.subscription.findMany({
      where: {
        status: 'ACTIVA',
        reminderSent: false,
        endDate: {
          gt: now,
          lte: threeDaysFromNow,
        },
      },
      include: {
        plan: true,
        user: { select: { id: true, name: true, phone: true, email: true } },
      },
    });

    if (expiringSoon.length === 0) return;

    for (const sub of expiringSoon) {
      const endDateStr = sub.endDate
        ? sub.endDate.toISOString().split('T')[0]
        : '';

      await this.prisma.$transaction([
        this.prisma.subscription.update({
          where: { id: sub.id },
          data: { reminderSent: true },
        }),
        this.prisma.notification.create({
          data: {
            userId: sub.userId,
            title: 'Tu suscripción vence pronto',
            message: `Tu ${sub.plan.name} vence el ${endDateStr}. Renueva con QR para mantener todos tus inmuebles activos sin interrupción.`,
            type: 'SUBSCRIPTION_RENEWAL_REMINDER',
            metadata: {
              subscriptionId: sub.id,
              planId: sub.planId,
              endDate: sub.endDate,
            },
          },
        }),
      ]);
    }

    this.logger.log(
      `Recordatorios de renovación enviados: ${expiringSoon.length}`,
    );
  }

  // 5. Diario (00:30): Vencer verificaciones con validUntil pasada
  @Cron('0 30 0 * * *')
  async expireVerifications() {
    const now = new Date();
    const expiredVerifs = await this.prisma.propertyVerification.findMany({
      where: {
        status: 'VERIFICADO',
        validUntil: { lt: now },
      },
      include: {
        property: { select: { id: true, title: true, userId: true } },
      },
    });

    if (expiredVerifs.length === 0) return;

    for (const verif of expiredVerifs) {
      await this.prisma.$transaction(async (tx) => {
        await tx.propertyVerification.update({
          where: { id: verif.id },
          data: { status: 'VENCIDO' },
        });

        const anotherValid = await tx.propertyVerification.findFirst({
          where: {
            propertyId: verif.propertyId,
            status: 'VERIFICADO',
            validUntil: { gt: now },
          },
        });

        if (!anotherValid) {
          await tx.property.update({
            where: { id: verif.propertyId },
            data: { isVerified: false },
          });

          await tx.notification.create({
            data: {
              userId: verif.property.userId,
              title: 'Vigencia de verificación finalizada',
              message: `El sello Verificado de "${verif.property.title}" cumplió su periodo de vigencia.`,
              type: 'VERIFICATION_EXPIRED',
              metadata: {
                verificationId: verif.id,
                propertyId: verif.propertyId,
              },
            },
          });
        }
      });
    }

    this.logger.log(
      `Verificaciones vencidas procesadas: ${expiredVerifs.length}`,
    );
  }
}
