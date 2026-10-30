import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogService } from '../catalog/catalog.service';
import { CreateReviewerDto, UpdateProfileDto } from './dto/users.dto';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private catalogService: CatalogService,
  ) {}

  /**
   * Calcula el inicio (Lunes 00:00:00.000) y fin (Domingo 23:59:59.999)
   * de la semana actual en hora de Bolivia (America/La_Paz, UTC-4 fijo).
   */
  getCurrentBoliviaWeekBounds(now = new Date()) {
    const BOLIVIA_OFFSET_MS = -4 * 60 * 60 * 1000;
    const boliviaNow = new Date(now.getTime() + BOLIVIA_OFFSET_MS);
    const daysSinceMonday = (boliviaNow.getUTCDay() + 6) % 7;

    const mondayBoliviaMs = Date.UTC(
      boliviaNow.getUTCFullYear(),
      boliviaNow.getUTCMonth(),
      boliviaNow.getUTCDate() - daysSinceMonday,
      0,
      0,
      0,
      0,
    );

    const weekStart = new Date(mondayBoliviaMs - BOLIVIA_OFFSET_MS);
    const weekEnd = new Date(
      weekStart.getTime() + 7 * 24 * 60 * 60 * 1000 - 1,
    );

    return { weekStart, weekEnd };
  }

  async getDiffusionQuotaForUser(userId: string) {
    const { user, plan } = await this.getEffectivePlanForUser(userId);
    const { weekStart, weekEnd } = this.getCurrentBoliviaWeekBounds();

    const freeWeeklyLimit = plan.freeWeeklyDiffusions ?? 1;

    const [dbFreeCount, agentePlan, diffusionProduct] = await Promise.all([
      this.prisma.socialDiffusion.count({
        where: {
          isFreeQuota: true,
          createdAt: { gte: weekStart, lte: weekEnd },
          OR: [{ userId }, { property: { userId } }],
        },
      }),
      user.accountType === 'INMOBILIARIA' && plan.code !== 'AGENTE'
        ? this.prisma.plan.findUnique({ where: { code: 'AGENTE' } })
        : Promise.resolve(null),
      this.prisma.product.findUnique({
        where: { code: 'DIFUSION_REDES' },
        select: { id: true, code: true },
      }),
    ]);

    const usedLastTimestampInThisWeek = Boolean(
      user.lastFreeDiffusionAt &&
        user.lastFreeDiffusionAt >= weekStart &&
        user.lastFreeDiffusionAt <= weekEnd,
    );

    const freeUsedThisWeek = Math.max(
      dbFreeCount,
      usedLastTimestampInThisWeek ? 1 : 0,
    );
    const freeRemainingThisWeek = Math.max(
      0,
      freeWeeklyLimit - freeUsedThisWeek,
    );

    // Regla de precios para difusiones adicionales:
    // Gratis / Propietario -> 10 Bs | Plan Agente o cuenta Inmobiliaria -> 35 Bs
    let extraDiffusionPriceBs = Number(plan.extraDiffusionPriceBs ?? 10);
    if (user.accountType === 'INMOBILIARIA' && plan.code !== 'AGENTE') {
      extraDiffusionPriceBs = agentePlan
        ? Number(agentePlan.extraDiffusionPriceBs)
        : 35;
    }

    return {
      weekStart,
      weekEnd,
      freeWeeklyLimit,
      freeUsedThisWeek,
      freeRemainingThisWeek,
      canPublishFree: freeRemainingThisWeek > 0,
      extraDiffusionPriceBs,
      diffusionProductId: diffusionProduct?.id ?? null,
    };
  }

  async getEffectivePlanForUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { currentPlan: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    let plan = user.currentPlan;
    if (!plan) {
      plan = await this.catalogService.ensureDefaultFreePlan();
      await this.prisma.user.update({
        where: { id: user.id },
        data: { currentPlanId: plan.id },
      });
    }

    const isAdmin = user.role === 'ADMIN';
    const maxActiveProperties = isAdmin
      ? null
      : plan.maxActiveProperties === null
        ? null
        : user.customMaxProperties !== null && user.customMaxProperties !== undefined
          ? Math.max(user.customMaxProperties, plan.maxActiveProperties)
          : plan.maxActiveProperties;

    const maxImagesPerProperty = isAdmin
      ? Math.max(15, plan.maxImagesPerProperty)
      : plan.maxImagesPerProperty;

    return {
      user,
      plan,
      maxActiveProperties,
      maxImagesPerProperty,
      includesStats: isAdmin || plan.includesStats,
      includesLogo: isAdmin || plan.includesLogo,
    };
  }

  async getMyPlan(userId: string) {
    const {
      plan,
      maxActiveProperties,
      maxImagesPerProperty,
      includesStats,
      includesLogo,
    } = await this.getEffectivePlanForUser(userId);

    const [
      activePropertiesCount,
      pausedPropertiesCount,
      activeSubscription,
      diffusionQuota,
    ] = await Promise.all([
      this.prisma.property.count({
        where: { userId, status: 'ACTIVO' },
      }),
      this.prisma.property.count({
        where: { userId, status: 'PAUSADO' },
      }),
      this.prisma.subscription.findFirst({
        where: {
          userId,
          status: 'ACTIVA',
          endDate: { gt: new Date() },
        },
        orderBy: { endDate: 'desc' },
      }),
      this.getDiffusionQuotaForUser(userId),
    ]);

    return {
      plan: {
        id: plan.id,
        code: plan.code,
        name: plan.name,
        monthlyPriceBs: Number(plan.monthlyPriceBs),
      },
      subscription: activeSubscription
        ? {
            id: activeSubscription.id,
            status: activeSubscription.status,
            startDate: activeSubscription.startDate,
            endDate: activeSubscription.endDate,
          }
        : null,
      limits: {
        maxActiveProperties,
        maxImagesPerProperty,
        includesStats,
        includesLogo,
      },
      usage: {
        activePropertiesCount,
        pausedPropertiesCount,
      },
      diffusionQuota,
    };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        currentPlan: true,
        _count: {
          select: { properties: true },
        },
      },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const myPlan = await this.getMyPlan(userId);
    const { password, currentPlan, ...result } = user;

    return {
      ...result,
      planDetails: myPlan,
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: dto,
      select: {
        id: true,
        phone: true,
        email: true,
        name: true,
        role: true,
        accountType: true,
        logoUrl: true,
      },
    });
    return updated;
  }

  async getNotifications(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async markNotificationRead(userId: string, notificationId: string) {
    const notif = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!notif || notif.userId !== userId) {
      throw new NotFoundException('Notificación no encontrada');
    }
    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });
  }

  async getAllUsers(adminId: string, roleFilter?: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (admin?.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Solo administradores pueden listar los usuarios',
      );
    }

    return this.prisma.user.findMany({
      where: roleFilter ? { role: roleFilter.toUpperCase() as any } : undefined,
      select: {
        id: true,
        phone: true,
        email: true,
        name: true,
        role: true,
        accountType: true,
        logoUrl: true,
        customMaxProperties: true,
        currentPlan: {
          select: { id: true, code: true, name: true },
        },
        createdAt: true,
        _count: {
          select: { properties: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createReviewer(adminId: string, dto: CreateReviewerDto) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (admin?.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Solo administradores pueden dar de alta revisores',
      );
    }

    const existing = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
    });
    if (existing) {
      throw new BadRequestException(
        'Ya existe un usuario registrado con ese número de teléfono',
      );
    }

    const freePlan = await this.catalogService.ensureDefaultFreePlan();
    const hashedPassword = await bcrypt.hash(dto.password, 10);

    return this.prisma.user.create({
      data: {
        phone: dto.phone,
        email: dto.email,
        password: hashedPassword,
        name: dto.name,
        role: 'REVISOR',
        currentPlanId: freePlan.id,
      },
      select: {
        id: true,
        phone: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });
  }

  async listReviewers(adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (admin?.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Solo administradores pueden consultar el equipo de revisores',
      );
    }

    return this.prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'REVISOR'] } },
      select: {
        id: true,
        phone: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        _count: {
          select: {
            approvedDiffusions: true,
            reviewedVerifications: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateUserRole(
    adminId: string,
    userId: string,
    role: 'USER' | 'ADMIN' | 'REVISOR' | 'INMOBILIARIA' | 'GRATIS',
  ) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (admin?.role !== 'ADMIN') {
      throw new ForbiddenException('Solo administradores pueden cambiar roles');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { role },
      select: { id: true, email: true, role: true },
    });
  }

  async updateMaxProperties(
    adminId: string,
    userId: string,
    customMaxProperties: number | null,
  ) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (admin?.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Solo administradores pueden cambiar límites',
      );
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { customMaxProperties },
      select: { id: true, email: true, customMaxProperties: true },
    });
  }
}
