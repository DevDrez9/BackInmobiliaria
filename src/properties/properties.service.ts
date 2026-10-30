import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import {
  CreatePropertyDto,
  UpdatePropertyDto,
  UpdatePropertyStatusDto,
} from './dto/properties.dto';
import { FilterPropertiesDto } from './dto/filter-properties.dto';

@Injectable()
export class PropertiesService {
  constructor(
    private prisma: PrismaService,
    private usersService: UsersService,
  ) {}

  private serializePublicProperty(property: any, now = new Date()) {
    const isFeatured = Boolean(
      property.featuredUntil && new Date(property.featuredUntil) > now,
    );
    const publisherUser = property.user;
    const canShowLogo =
      publisherUser?.role === 'ADMIN' ||
      Boolean(publisherUser?.currentPlan?.includesLogo);

    const { user, ...rest } = property;

    return {
      ...rest,
      isFeatured,
      publisher: publisherUser
        ? {
            id: publisherUser.id,
            name: publisherUser.name,
            accountType: publisherUser.accountType,
            logoUrl: canShowLogo ? publisherUser.logoUrl : null,
          }
        : undefined,
    };
  }

  private shuffleArray<T>(items: T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  async create(userId: string, dto: CreatePropertyDto) {
    const {
      user,
      plan,
      maxActiveProperties,
      maxImagesPerProperty,
    } = await this.usersService.getEffectivePlanForUser(userId);

    if (dto.images.length === 0) {
      throw new BadRequestException('Debes enviar al menos 1 imagen');
    }
    if (dto.images.length > maxImagesPerProperty) {
      throw new BadRequestException(
        `Tu ${plan.name} permite un máximo de ${maxImagesPerProperty} imágenes por inmueble.`,
      );
    }

    const activeCount = await this.prisma.property.count({
      where: { userId, status: 'ACTIVO' },
    });

    if (maxActiveProperties !== null && activeCount >= maxActiveProperties) {
      throw new BadRequestException(
        `Has alcanzado el límite de ${maxActiveProperties} inmueble(s) activo(s) de tu ${plan.name}. Sube de plan para tener más inmuebles activos.`,
      );
    }

    const quota = dto.requestDiffusion
      ? await this.usersService.getDiffusionQuotaForUser(userId)
      : null;

    return this.prisma.$transaction(async (tx) => {
      const createdProperty = await tx.property.create({
        data: {
          title: dto.title,
          description: dto.description,
          price: dto.price,
          currency: dto.currency as any,
          listingType: dto.listingType as any,
          propertyType: dto.propertyType as any,
          status: 'ACTIVO',
          city: dto.city,
          zone: dto.zone,
          bedrooms: dto.bedrooms,
          latitude: dto.latitude,
          longitude: dto.longitude,
          whatsapp: dto.whatsapp || user.phone,
          images: dto.images,
          facebookUrl: dto.facebookUrl,
          userId: user.id,
        },
      });

      if (!dto.requestDiffusion || !quota) {
        return createdProperty;
      }

      if (quota.canPublishFree) {
        const location = createdProperty.zone
          ? `${createdProperty.zone}, ${createdProperty.city}`
          : createdProperty.city;
        const bedroomsLine = createdProperty.bedrooms
          ? `🛏️ Dormitorios: ${createdProperty.bedrooms}\n`
          : '';
        const postText =
          `🏠 ${createdProperty.listingType} — ${createdProperty.title}\n` +
          `📍 Ubicación: ${location}\n` +
          `💰 Precio: ${createdProperty.price.toLocaleString('es-BO')} ${createdProperty.currency}\n` +
          bedroomsLine +
          `\n${createdProperty.description.slice(0, 300)}`;

        await tx.user.update({
          where: { id: user.id },
          data: { lastFreeDiffusionAt: new Date() },
        });

        const diffusion = await tx.socialDiffusion.create({
          data: {
            userId: user.id,
            propertyId: createdProperty.id,
            orderId: null,
            isFreeQuota: true,
            status: 'PENDIENTE',
            postText,
          },
        });

        return {
          ...createdProperty,
          diffusionRequest: {
            queuedFree: true,
            requiresPayment: false,
            diffusionId: diffusion.id,
            status: diffusion.status,
          },
        };
      }

      // Si ya agotó su publicación gratis de esta semana (Lunes a Domingo), avisa al front para cobrar con QR
      return {
        ...createdProperty,
        diffusionRequest: {
          queuedFree: false,
          requiresPayment: true,
          extraDiffusionPriceBs: quota.extraDiffusionPriceBs,
          diffusionProductId: quota.diffusionProductId,
          weekEnd: quota.weekEnd,
        },
      };
    });
  }

  async findAll(filterDto: FilterPropertiesDto) {
    const {
      city,
      zone,
      listingType,
      propertyType,
      search,
      minPrice,
      maxPrice,
      onlyFeatured,
      onlyVerified,
      page = 1,
      limit = 20,
    } = filterDto;

    const now = new Date();
    const where: any = {
      status: 'ACTIVO',
    };

    if (city) where.city = city;
    if (zone) where.zone = { contains: zone };
    if (listingType && listingType !== 'TODOS') where.listingType = listingType;
    if (propertyType && propertyType !== 'TODOS') where.propertyType = propertyType;
    if (onlyFeatured) where.featuredUntil = { gt: now };
    if (onlyVerified) where.isVerified = true;

    if (minPrice !== undefined || maxPrice !== undefined) {
      where.price = {};
      if (minPrice !== undefined) where.price.gte = minPrice;
      if (maxPrice !== undefined) where.price.lte = maxPrice;
    }

    if (search) {
      where.OR = [
        { title: { contains: search } },
        { description: { contains: search } },
        { zone: { contains: search } },
      ];
    }

    const skip = (page - 1) * limit;

    const [rawItems, total] = await Promise.all([
      this.prisma.property.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ featuredUntil: 'desc' }, { createdAt: 'desc' }],
        include: {
          user: {
            select: {
              id: true,
              name: true,
              accountType: true,
              logoUrl: true,
              role: true,
              currentPlan: {
                select: {
                  code: true,
                  includesLogo: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.property.count({ where }),
    ]);

    const serialized = rawItems.map((item) =>
      this.serializePublicProperty(item, now),
    );

    // Destacados primero y rotados entre sí para repartir visibilidad en la misma zona
    const featured = this.shuffleArray(
      serialized.filter((item) => item.isFeatured),
    );
    const regular = serialized.filter((item) => !item.isFeatured);

    return {
      data: [...featured, ...regular],
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findMyProperties(userId: string) {
    const now = new Date();
    const items = await this.prisma.property.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        diffusions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            status: true,
            rejectionReason: true,
            publishedAt: true,
            createdAt: true,
          },
        },
        verifications: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            status: true,
            rejectionReason: true,
            verifiedAt: true,
            validUntil: true,
            createdAt: true,
          },
        },
      },
    });

    return items.map((p) => ({
      ...p,
      isFeatured: Boolean(p.featuredUntil && p.featuredUntil > now),
      latestDiffusion: p.diffusions[0] ?? null,
      latestVerification: p.verifications[0] ?? null,
    }));
  }

  async findOne(id: string) {
    const property = await this.prisma.property.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            accountType: true,
            logoUrl: true,
            role: true,
            currentPlan: {
              select: {
                code: true,
                includesLogo: true,
              },
            },
          },
        },
        verifications: {
          where: { status: 'VERIFICADO' },
          orderBy: { verifiedAt: 'desc' },
          take: 1,
          select: {
            verifiedAt: true,
            validUntil: true,
          },
        },
      },
    });
    if (!property) throw new NotFoundException('Propiedad no encontrada');

    const { verifications, ...rest } = property;
    return {
      ...this.serializePublicProperty(rest),
      verificationInfo: property.isVerified ? (verifications[0] ?? null) : null,
    };
  }

  async updateStatus(userId: string, id: string, dto: UpdatePropertyStatusDto) {
    const [property, { user, plan, maxActiveProperties }] = await Promise.all([
      this.prisma.property.findUnique({ where: { id } }),
      this.usersService.getEffectivePlanForUser(userId),
    ]);

    if (!property) throw new NotFoundException('Propiedad no encontrada');
    if (property.userId !== userId && user.role !== 'ADMIN') {
      throw new ForbiddenException(
        'No tienes permiso para cambiar el estado de esta propiedad',
      );
    }

    if (dto.status === 'ACTIVO' && property.status !== 'ACTIVO') {
      const activeCount = await this.prisma.property.count({
        where: { userId: property.userId, status: 'ACTIVO' },
      });

      if (
        user.role !== 'ADMIN' &&
        maxActiveProperties !== null &&
        activeCount >= maxActiveProperties
      ) {
        throw new BadRequestException(
          `Sube de plan para tener más inmuebles activos (límite actual de ${plan.name}: ${maxActiveProperties}). Puedes pausar otro inmueble primero.`,
        );
      }
    }

    return this.prisma.property.update({
      where: { id },
      data: { status: dto.status },
    });
  }

  async update(userId: string, id: string, dto: UpdatePropertyDto) {
    const property = await this.prisma.property.findUnique({ where: { id } });
    if (!property) throw new NotFoundException('Propiedad no encontrada');

    const { user, plan, maxImagesPerProperty } =
      await this.usersService.getEffectivePlanForUser(userId);

    if (property.userId !== userId && user.role !== 'ADMIN') {
      throw new ForbiddenException(
        'No tienes permiso para editar esta propiedad',
      );
    }

    if (dto.images && dto.images.length > maxImagesPerProperty) {
      throw new BadRequestException(
        `Tu ${plan.name} permite un máximo de ${maxImagesPerProperty} imágenes.`,
      );
    }

    // Regla de seguridad de Inmueble Verificado: si cambia ubicación sensible, se suspende la verificación
    const sensitiveLocationChanged =
      (dto.city !== undefined && dto.city !== property.city) ||
      (dto.zone !== undefined && dto.zone !== property.zone) ||
      (dto.latitude !== undefined &&
        Math.abs(dto.latitude - property.latitude) > 0.0001) ||
      (dto.longitude !== undefined &&
        Math.abs(dto.longitude - property.longitude) > 0.0001);

    return this.prisma.$transaction(async (tx) => {
      const suspendVerification =
        property.isVerified && sensitiveLocationChanged && user.role !== 'ADMIN';

      if (suspendVerification) {
        await tx.propertyVerification.updateMany({
          where: { propertyId: id, status: 'VERIFICADO' },
          data: {
            status: 'SUSPENDIDO',
            internalNotes:
              'Verificación suspendida automáticamente por modificación de ubicación del inmueble.',
          },
        });

        await tx.notification.create({
          data: {
            userId: property.userId,
            title: 'Verificación suspendida por cambio de ubicación',
            message: `Al modificar la ubicación de "${property.title}", el sello Verificado quedó suspendido hasta nueva revisión.`,
            type: 'VERIFICATION_SUSPENDED',
            metadata: { propertyId: id },
          },
        });
      }

      return tx.property.update({
        where: { id },
        data: {
          title: dto.title,
          description: dto.description,
          price: dto.price,
          currency: dto.currency as any,
          listingType: dto.listingType as any,
          propertyType: dto.propertyType as any,
          city: dto.city,
          zone: dto.zone,
          bedrooms: dto.bedrooms,
          latitude: dto.latitude,
          longitude: dto.longitude,
          whatsapp: dto.whatsapp,
          images: dto.images,
          facebookUrl: dto.facebookUrl,
          ...(suspendVerification ? { isVerified: false } : {}),
        },
      });
    });
  }

  async remove(userId: string, id: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const property = await this.prisma.property.findUnique({ where: { id } });

    if (!property) throw new NotFoundException('Propiedad no encontrada');
    if (property.userId !== userId && user?.role !== 'ADMIN') {
      throw new ForbiddenException(
        'No tienes permiso para eliminar esta propiedad',
      );
    }

    return this.prisma.property.delete({ where: { id } });
  }
}
