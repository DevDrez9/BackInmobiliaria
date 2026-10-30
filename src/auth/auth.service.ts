import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { RegisterDto, LoginDto } from './dto/auth.dto';
import { CatalogService } from '../catalog/catalog.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private catalogService: CatalogService,
  ) {}

  private formatPlanSummary(plan: any) {
    if (!plan) return null;
    return {
      id: plan.id,
      code: plan.code,
      name: plan.name,
      monthlyPriceBs: Number(plan.monthlyPriceBs),
      maxActiveProperties: plan.maxActiveProperties,
      maxImagesPerProperty: plan.maxImagesPerProperty,
      includesStats: plan.includesStats,
      includesLogo: plan.includesLogo,
    };
  }

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
    });
    if (existing) {
      throw new BadRequestException('El usuario ya existe');
    }

    const freePlan = await this.catalogService.ensureDefaultFreePlan();
    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        phone: dto.phone,
        email: dto.email,
        password: hashedPassword,
        name: dto.name,
        role: 'USER',
        accountType: dto.accountType || 'PARTICULAR',
        logoUrl: dto.logoUrl,
        currentPlanId: freePlan.id,
      },
      include: { currentPlan: true },
    });

    const payload = { sub: user.id, phone: user.phone, role: user.role };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        phone: user.phone,
        email: user.email,
        name: user.name,
        role: user.role,
        accountType: user.accountType,
        logoUrl: user.logoUrl,
        currentPlan: this.formatPlanSummary(user.currentPlan),
      },
    };
  }

  async login(dto: LoginDto) {
    let user = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
      include: { currentPlan: true },
    });
    if (!user) throw new UnauthorizedException('Credenciales inválidas');

    const isValid = await bcrypt.compare(dto.password, user.password);
    if (!isValid) throw new UnauthorizedException('Credenciales inválidas');

    if (!user.currentPlanId) {
      const freePlan = await this.catalogService.ensureDefaultFreePlan();
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { currentPlanId: freePlan.id },
        include: { currentPlan: true },
      });
    }

    const payload = { sub: user.id, phone: user.phone, role: user.role };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        phone: user.phone,
        email: user.email,
        name: user.name,
        role: user.role,
        accountType: user.accountType,
        logoUrl: user.logoUrl,
        currentPlan: this.formatPlanSummary(user.currentPlan),
      },
    };
  }
}
