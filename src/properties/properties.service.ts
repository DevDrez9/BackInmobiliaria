import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePropertyDto, UpdatePropertyDto } from './dto/properties.dto';
import { FilterPropertiesDto } from './dto/filter-properties.dto';

@Injectable()
export class PropertiesService {
  constructor(private prisma: PrismaService) {}

  private getRoleLimit(role: string): number {
    switch (role) {
      case 'ADMIN': return 99999;
      case 'INMOBILIARIA': return 5;
      case 'GRATIS': return 1;
      default: return 1;
    }
  }

  private getImageLimit(role: string): number {
    switch (role) {
      case 'ADMIN': return 5;
      case 'INMOBILIARIA': return 3;
      case 'GRATIS': return 1;
      default: return 1;
    }
  }

  async create(userId: string, dto: CreatePropertyDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { _count: { select: { properties: true } } }
    });
    
    if (!user) throw new NotFoundException('User not found');

    // Validación de cantidad de imágenes permitidas
    const maxImages = this.getImageLimit(user.role);
    if (dto.images.length === 0) {
      throw new BadRequestException('Debes enviar al menos 1 imagen');
    }
    if (dto.images.length > maxImages) {
      throw new BadRequestException(`Tu plan ${user.role} permite un máximo de ${maxImages} imágenes.`);
    }

    // Validación de cantidad de propiedades activas
    const currentProperties = user._count.properties;
    const defaultRoleLimit = this.getRoleLimit(user.role);
    const maxAllowed = user.customMaxProperties !== null && user.customMaxProperties !== undefined
      ? Math.max(user.customMaxProperties, defaultRoleLimit)
      : defaultRoleLimit;

    if (currentProperties >= maxAllowed) {
      throw new BadRequestException(`Has alcanzado tu límite de ${maxAllowed} publicaciones.`);
    }

    return this.prisma.property.create({
      data: {
        title: dto.title,
        description: dto.description,
        price: dto.price,
        currency: dto.currency as any,
        listingType: dto.listingType as any,
        propertyType: dto.propertyType as any,
        city: dto.city,
        latitude: dto.latitude,
        longitude: dto.longitude,
        whatsapp: dto.whatsapp || user.phone,
        images: dto.images,
        facebookUrl: dto.facebookUrl,
        userId: user.id
      }
    });
  }

  async findAll(filterDto: FilterPropertiesDto) {
    const { city, listingType, propertyType, search, minPrice, maxPrice, page = 1, limit = 20 } = filterDto;
    const where: any = {};
    
    if (city) where.city = city;
    if (listingType && listingType !== 'TODOS') where.listingType = listingType;
    if (propertyType && propertyType !== 'TODOS') where.propertyType = propertyType;
    if (minPrice !== undefined || maxPrice !== undefined) {
      where.price = {};
      if (minPrice !== undefined) where.price.gte = minPrice;
      if (maxPrice !== undefined) where.price.lte = maxPrice;
    }
    if (search) {
      where.OR = [
        { title: { contains: search } },
        { description: { contains: search } },
      ];
    }

    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.property.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.property.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const property = await this.prisma.property.findUnique({ where: { id } });
    if (!property) throw new NotFoundException('Propiedad no encontrada');
    return property;
  }

  async update(userId: string, id: string, dto: UpdatePropertyDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const property = await this.prisma.property.findUnique({ where: { id } });

    if (!property) throw new NotFoundException('Propiedad no encontrada');
    if (property.userId !== userId && user?.role !== 'ADMIN') {
      throw new ForbiddenException('No tienes permiso para editar esta propiedad');
    }

    const maxImages = this.getImageLimit(user!.role);
    if (dto.images && dto.images.length > maxImages) {
      throw new BadRequestException(`Tu plan ${user!.role} permite un máximo de ${maxImages} imágenes.`);
    }

    return this.prisma.property.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        price: dto.price,
        currency: dto.currency as any,
        listingType: dto.listingType as any,
        propertyType: dto.propertyType as any,
        city: dto.city,
        latitude: dto.latitude,
        longitude: dto.longitude,
        whatsapp: dto.whatsapp,
        images: dto.images,
        facebookUrl: dto.facebookUrl,
      }
    });
  }

  async remove(userId: string, id: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const property = await this.prisma.property.findUnique({ where: { id } });

    if (!property) throw new NotFoundException('Propiedad no encontrada');
    if (property.userId !== userId && user?.role !== 'ADMIN') {
      throw new ForbiddenException('No tienes permiso para eliminar esta propiedad');
    }

    return this.prisma.property.delete({ where: { id } });
  }
}
