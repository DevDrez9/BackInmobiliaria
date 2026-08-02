import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        _count: {
          select: { properties: true }
        }
      }
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    const { password, ...result } = user;
    return result;
  }

  async getAllUsers(adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (admin?.role !== 'ADMIN') throw new ForbiddenException('Solo administradores pueden listar los usuarios');

    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        customMaxProperties: true,
        createdAt: true,
        _count: {
          select: { properties: true }
        }
      }
    });
  }

  async updateUserRole(adminId: string, userId: string, role: 'ADMIN' | 'INMOBILIARIA' | 'GRATIS') {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (admin?.role !== 'ADMIN') throw new ForbiddenException('Solo administradores pueden cambiar roles');
    
    return this.prisma.user.update({
      where: { id: userId },
      data: { role },
      select: { id: true, email: true, role: true }
    });
  }

  async updateMaxProperties(adminId: string, userId: string, customMaxProperties: number | null) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (admin?.role !== 'ADMIN') throw new ForbiddenException('Solo administradores pueden cambiar límites');
    
    return this.prisma.user.update({
      where: { id: userId },
      data: { customMaxProperties },
      select: { id: true, email: true, customMaxProperties: true }
    });
  }
}
