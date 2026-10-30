import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import {
  ApproveVerificationDto,
  RejectVerificationDto,
  UpdateVerificationNotesDto,
} from './dto/verifications.dto';

export interface StoredVerificationDoc {
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  docType: string;
  uploadedAt: string;
}

@Injectable()
export class VerificationsService {
  readonly storageDir = path.resolve(
    process.cwd(),
    'uploads',
    'private-verifications',
  );

  constructor(private prisma: PrismaService) {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  async getMyVerifications(userId: string) {
    return this.prisma.propertyVerification.findMany({
      where: {
        property: { userId },
      },
      include: {
        property: {
          select: { id: true, title: true, city: true, isVerified: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async attachDocuments(
    userId: string,
    verificationId: string,
    files: Array<{
      filename: string;
      originalname: string;
      mimetype: string;
      size: number;
    }>,
    docType?: string,
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException(
        'Debes adjuntar al menos un archivo para la verificación',
      );
    }

    const [verification, user] = await Promise.all([
      this.prisma.propertyVerification.findUnique({
        where: { id: verificationId },
        include: { property: true },
      }),
      this.prisma.user.findUnique({ where: { id: userId } }),
    ]);

    if (!verification) {
      throw new NotFoundException('Solicitud de verificación no encontrada');
    }

    if (verification.property.userId !== userId && user?.role !== 'ADMIN') {
      throw new ForbiddenException(
        'No tienes permiso para subir documentos a esta verificación',
      );
    }

    if (
      !['DOCUMENTOS_PENDIENTES', 'RECHAZADO', 'SUSPENDIDO', 'EN_REVISION'].includes(
        verification.status,
      )
    ) {
      throw new BadRequestException(
        `No es posible subir documentos cuando la verificación está en estado ${verification.status}`,
      );
    }

    const currentDocs: StoredVerificationDoc[] = Array.isArray(
      verification.documents,
    )
      ? (verification.documents as unknown as StoredVerificationDoc[])
      : [];

    const nowIso = new Date().toISOString();
    const addedDocs: StoredVerificationDoc[] = files.map((file) => ({
      filename: file.filename,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      docType: docType || 'general',
      uploadedAt: nowIso,
    }));

    return this.prisma.propertyVerification.update({
      where: { id: verificationId },
      data: {
        documents: [...currentDocs, ...addedDocs] as any,
        status: 'EN_REVISION',
        rejectionReason: null,
      },
    });
  }

  async getPrivateDocumentFile(
    userId: string,
    verificationId: string,
    filename: string,
  ): Promise<{ filePath: string; doc: StoredVerificationDoc }> {
    const [verification, user] = await Promise.all([
      this.prisma.propertyVerification.findUnique({
        where: { id: verificationId },
        include: { property: { select: { userId: true } } },
      }),
      this.prisma.user.findUnique({ where: { id: userId } }),
    ]);

    if (!verification) {
      throw new NotFoundException('Verificación no encontrada');
    }

    const canAccess =
      user?.role === 'ADMIN' ||
      user?.role === 'REVISOR' ||
      verification.property.userId === userId;

    if (!canAccess) {
      throw new ForbiddenException(
        'Acceso restringido a documentos privados de verificación',
      );
    }

    const safeFilename = path.basename(filename);
    const docs: StoredVerificationDoc[] = Array.isArray(verification.documents)
      ? (verification.documents as unknown as StoredVerificationDoc[])
      : [];

    const doc = docs.find((d) => d.filename === safeFilename);
    if (!doc) {
      throw new NotFoundException(
        'Documento no registrado en esta solicitud de verificación',
      );
    }

    const filePath = path.join(this.storageDir, safeFilename);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('Archivo físico no encontrado en el servidor');
    }

    return { filePath, doc };
  }

  async listAdminVerifications(status?: string) {
    const where: any = {};
    if (status) {
      where.status = status.toUpperCase();
    }

    return this.prisma.propertyVerification.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      include: {
        property: {
          include: {
            user: {
              select: { id: true, name: true, phone: true, email: true },
            },
          },
        },
        reviewer: {
          select: { id: true, name: true, role: true },
        },
      },
    });
  }

  async updateInternalNotes(id: string, dto: UpdateVerificationNotesDto) {
    const existing = await this.prisma.propertyVerification.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Verificación no encontrada');

    return this.prisma.propertyVerification.update({
      where: { id },
      data: { internalNotes: dto.internalNotes },
    });
  }

  async approveVerification(
    reviewerId: string,
    id: string,
    dto: ApproveVerificationDto,
  ) {
    const verification = await this.prisma.propertyVerification.findUnique({
      where: { id },
      include: { property: true },
    });
    if (!verification) {
      throw new NotFoundException('Verificación no encontrada');
    }

    const defaultMonths = Number(process.env.VERIFICATION_VALID_MONTHS || 6);
    const validMonths =
      dto.validMonths ?? (defaultMonths > 0 ? defaultMonths : 6);

    const now = new Date();
    const validUntil = new Date(now);
    validUntil.setMonth(validUntil.getMonth() + validMonths);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.propertyVerification.update({
        where: { id },
        data: {
          status: 'VERIFICADO',
          reviewerId,
          verifiedAt: now,
          validUntil,
          rejectionReason: null,
          ...(dto.internalNotes !== undefined
            ? { internalNotes: dto.internalNotes }
            : {}),
        },
      });

      await tx.property.update({
        where: { id: verification.propertyId },
        data: { isVerified: true },
      });

      await tx.notification.create({
        data: {
          userId: verification.property.userId,
          title: '¡Inmueble Verificado!',
          message: `Tu inmueble "${verification.property.title}" aprobó la revisión documental y ahora luce el sello Verificado hasta el ${validUntil.toISOString().split('T')[0]}.`,
          type: 'VERIFICATION_APPROVED',
          metadata: {
            verificationId: id,
            propertyId: verification.propertyId,
          },
        },
      });

      return updated;
    });
  }

  async rejectVerification(
    reviewerId: string,
    id: string,
    dto: RejectVerificationDto,
  ) {
    const verification = await this.prisma.propertyVerification.findUnique({
      where: { id },
      include: { property: true },
    });
    if (!verification) {
      throw new NotFoundException('Verificación no encontrada');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.propertyVerification.update({
        where: { id },
        data: {
          status: 'RECHAZADO',
          reviewerId,
          rejectionReason: dto.reason,
          ...(dto.internalNotes !== undefined
            ? { internalNotes: dto.internalNotes }
            : {}),
        },
      });

      await tx.property.update({
        where: { id: verification.propertyId },
        data: { isVerified: false },
      });

      await tx.notification.create({
        data: {
          userId: verification.property.userId,
          title: 'Documentos de verificación observados',
          message: `La revisión de "${verification.property.title}" tuvo la siguiente observación: ${dto.reason}. Puedes volver a subir los documentos corregidos desde tu panel.`,
          type: 'VERIFICATION_REJECTED',
          metadata: {
            verificationId: id,
            propertyId: verification.propertyId,
          },
        },
      });

      return updated;
    });
  }
}
