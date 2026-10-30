import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdatePlanDto, UpdateProductDto } from './dto/catalog.dto';

@Injectable()
export class CatalogService {
  constructor(private prisma: PrismaService) {}

  private serializePlan(plan: any) {
    if (!plan) return null;
    return {
      ...plan,
      monthlyPriceBs: Number(plan.monthlyPriceBs),
    };
  }

  private serializeProduct(product: any) {
    if (!product) return null;
    return {
      ...product,
      priceBs: Number(product.priceBs),
    };
  }

  async ensureDefaultFreePlan() {
    let freePlan = await this.prisma.plan.findUnique({
      where: { code: 'GRATIS' },
    });
    if (!freePlan) {
      freePlan = await this.prisma.plan.create({
        data: {
          code: 'GRATIS',
          name: 'Plan Gratis',
          description: 'Ideal para publicar tu primer inmueble sin costo.',
          monthlyPriceBs: 0,
          maxActiveProperties: 1,
          maxImagesPerProperty: 3,
          includesStats: false,
          includesLogo: false,
          isActive: true,
        },
      });
    }
    return freePlan;
  }

  async getActivePlans() {
    const plans = await this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { monthlyPriceBs: 'asc' },
    });
    return plans.map((p) => this.serializePlan(p));
  }

  async getAllPlans() {
    const plans = await this.prisma.plan.findMany({
      orderBy: { monthlyPriceBs: 'asc' },
    });
    return plans.map((p) => this.serializePlan(p));
  }

  async updatePlan(id: string, dto: UpdatePlanDto) {
    const existing = await this.prisma.plan.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Plan no encontrado');

    const updated = await this.prisma.plan.update({
      where: { id },
      data: dto,
    });
    return this.serializePlan(updated);
  }

  async getActiveProducts() {
    const products = await this.prisma.product.findMany({
      where: { isActive: true },
      orderBy: { priceBs: 'asc' },
    });
    return products.map((p) => this.serializeProduct(p));
  }

  async getAllProducts() {
    const products = await this.prisma.product.findMany({
      orderBy: { priceBs: 'asc' },
    });
    return products.map((p) => this.serializeProduct(p));
  }

  async updateProduct(id: string, dto: UpdateProductDto) {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Producto no encontrado');

    const updated = await this.prisma.product.update({
      where: { id },
      data: dto,
    });
    return this.serializeProduct(updated);
  }
}
