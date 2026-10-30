import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { TrackPropertyEventDto } from './dto/analytics.dto';

@Injectable()
export class AnalyticsService {
  constructor(
    private prisma: PrismaService,
    private usersService: UsersService,
  ) {}

  async trackEvent(dto: TrackPropertyEventDto) {
    const exists = await this.prisma.property.findUnique({
      where: { id: dto.propertyId },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException('Inmueble no encontrado');
    }

    const normalizedSource = dto.source?.trim().toLowerCase() || 'directo';

    await this.prisma.propertyEvent.create({
      data: {
        propertyId: dto.propertyId,
        type: dto.type,
        source: normalizedSource.slice(0, 80),
      },
    });

    return { recorded: true };
  }

  async getPropertyStats(userId: string, propertyId: string, days = 30) {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: { id: true, title: true, userId: true },
    });

    if (!property) {
      throw new NotFoundException('Inmueble no encontrado');
    }

    const { user, includesStats } =
      await this.usersService.getEffectivePlanForUser(userId);

    if (property.userId !== userId && user.role !== 'ADMIN') {
      throw new ForbiddenException(
        'No tienes permiso para ver las estadísticas de este inmueble',
      );
    }

    if (!includesStats && user.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Tu plan actual no incluye acceso a estadísticas. Sube al Plan Agente para visualizar el historial completo.',
      );
    }

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [byType, bySource, recentEvents] = await Promise.all([
      this.prisma.propertyEvent.groupBy({
        by: ['type'],
        where: { propertyId, createdAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.propertyEvent.groupBy({
        by: ['source'],
        where: { propertyId, createdAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.propertyEvent.findMany({
        where: { propertyId, createdAt: { gte: since } },
        select: { type: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const totalsByType: Record<string, number> = {
      VISTA_PIN: 0,
      VISTA_DETALLE: 0,
      CLIC_CONTACTO: 0,
      CLIC_WHATSAPP: 0,
      CLIC_LLAMAR: 0,
    };
    for (const item of byType) {
      totalsByType[item.type] = item._count._all;
    }

    const totalsBySource: Record<string, number> = {};
    for (const item of bySource) {
      const key = item.source || 'directo';
      totalsBySource[key] = item._count._all;
    }

    const dailyMap: Record<string, { views: number; contacts: number }> = {};
    for (const ev of recentEvents) {
      const day = ev.createdAt.toISOString().split('T')[0];
      if (!dailyMap[day]) {
        dailyMap[day] = { views: 0, contacts: 0 };
      }
      if (ev.type === 'VISTA_PIN' || ev.type === 'VISTA_DETALLE') {
        dailyMap[day].views += 1;
      } else {
        dailyMap[day].contacts += 1;
      }
    }

    const timeline = Object.entries(dailyMap).map(([date, counts]) => ({
      date,
      ...counts,
    }));

    return {
      propertyId: property.id,
      propertyTitle: property.title,
      periodDays: days,
      since,
      totalsByType,
      totalsBySource,
      timeline,
    };
  }
}
