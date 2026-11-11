import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { SocialCardService } from './social-card.service';
import {
  ApproveDiffusionDto,
  FilterAdminDiffusionsDto,
  N8nDiffusionCallbackDto,
  RejectDiffusionDto,
  UpdateDiffusionDto,
} from './dto/diffusions.dto';

export interface DiffusionQualityReport {
  canPublishToN8n: boolean;
  blockers: string[];
  warnings: string[];
}

@Injectable()
export class DiffusionsService {
  private readonly logger = new Logger(DiffusionsService.name);

  constructor(
    private prisma: PrismaService,
    private usersService: UsersService,
    @Optional()
    private socialCardService: SocialCardService = new SocialCardService(),
  ) {}

  buildPropertyAppUrl(propertyId?: string): string {
    const customAppLink = (
      process.env.PUBLIC_APP_LINK || 'https://alquila.ratelapps.com/ir'
    )
      .trim()
      .replace(/\/+$/, '');

    if (/play\.google\.com|apps\.apple\.com/i.test(customAppLink)) {
      return customAppLink;
    }
    if (!propertyId) return customAppLink;
    return `${customAppLink}/${propertyId}`;
  }

  buildAppRedirectHtml(propertyId?: string): string {
    const scheme = (process.env.APP_DEEP_LINK_SCHEME || 'alquilabo').replace(
      /:\/\/.*$/,
      '',
    );
    const androidPackage =
      process.env.ANDROID_PACKAGE_NAME || 'com.ratelapps.alquilabo';
    const playStoreUrl =
      process.env.PLAY_STORE_URL ||
      `https://play.google.com/store/apps/details?id=${androidPackage}`;
    const appStoreUrl = process.env.APP_STORE_URL || playStoreUrl;

    const deepLinkPath = propertyId ? `inmueble/${propertyId}` : 'home';
    const customSchemeUrl = `${scheme}://${deepLinkPath}`;
    // Intent directo al paquete com.ratelapps.alquilabo: si está instalado abre la app; si no, abre Google Play Store automáticamente
    const androidIntentUrl = `intent://${deepLinkPath}#Intent;scheme=${scheme};package=${androidPackage};S.browser_fallback_url=${encodeURIComponent(
      playStoreUrl,
    )};end`;
    const androidLauncherIntentUrl = `intent://#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=${androidPackage};S.browser_fallback_url=${encodeURIComponent(
      playStoreUrl,
    )};end`;

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Abrir en la app AlquilaBO</title>
  <style>
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0b1f3a;
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      text-align: center;
      padding: 24px;
    }
    .card {
      background: #ffffff;
      color: #0f172a;
      border-radius: 20px;
      padding: 32px 24px;
      max-width: 380px;
      width: 100%;
      box-shadow: 0 20px 40px rgba(0,0,0,0.35);
    }
    .logo {
      width: 180px;
      height: auto;
      margin-bottom: 16px;
    }
    h1 {
      font-size: 22px;
      margin: 0 0 8px;
      color: #0b1f3a;
    }
    p {
      font-size: 15px;
      color: #475569;
      margin: 0 0 24px;
    }
    .btn {
      display: block;
      width: 100%;
      box-sizing: border-box;
      padding: 14px 20px;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 700;
      text-decoration: none;
      margin-bottom: 12px;
    }
    .btn-primary {
      background: #16a34a;
      color: #ffffff;
    }
    .btn-secondary {
      background: #0b1f3a;
      color: #ffffff;
    }
  </style>
  <script>
    (function() {
      var ua = navigator.userAgent || '';
      var isAndroid = /android/i.test(ua);
      var isIOS = /iPad|iPhone|iPod/.test(ua);
      var customScheme = ${JSON.stringify(customSchemeUrl)};
      var intentUrl = ${JSON.stringify(androidIntentUrl)};
      var launcherIntentUrl = ${JSON.stringify(androidLauncherIntentUrl)};
      var playStore = ${JSON.stringify(playStoreUrl)};
      var appStore = ${JSON.stringify(appStoreUrl)};

      // Intentar abrir directamente la app móvil AlquilaBO (si está instalada la abre; si no, Play Store)
      window.location.href = isAndroid ? launcherIntentUrl : customScheme;

      setTimeout(function() {
        if (!document.hidden) {
          window.location.href = isIOS ? appStore : playStore;
        }
      }, 1800);
    })();
  </script>
</head>
<body>
  <div class="card">
    <img class="logo" src="/public/logo-alquilabo.jpg" alt="AlquilaBO" />
    <h1>Abriendo la app AlquilaBO...</h1>
    <p>Estamos abriendo este inmueble directamente en la aplicación móvil.</p>
    <a class="btn btn-primary" href="${androidLauncherIntentUrl}">Abrir en la app AlquilaBO</a>
    <a class="btn btn-secondary" href="${playStoreUrl}">Descargar en Google Play</a>
  </div>
</body>
</html>`;
  }

  buildInitialPostText(property: {
    id?: string;
    title: string;
    listingType: string;
    propertyType?: string | null;
    price: number;
    currency: string;
    city: string;
    zone?: string | null;
    bedrooms?: number | null;
    whatsapp?: string | null;
    description: string;
  }): string {
    const location = property.zone
      ? `Zona ${property.zone}, ${property.city}`
      : property.city;
    const propTypeLabel = property.propertyType
      ? ` (${property.propertyType})`
      : '';
    const bedroomsLine =
      property.bedrooms !== null && property.bedrooms !== undefined
        ? `🛏️ Dormitorios: ${property.bedrooms}\n`
        : '';
    const whatsappLine = property.whatsapp
      ? `📱 Contacto / WhatsApp: ${property.whatsapp}\n`
      : '';
    const appUrl = this.buildPropertyAppUrl(property.id);

    return (
      `🏠 En ${property.listingType}${propTypeLabel} — ${property.title}\n` +
      `📍 Ubicación: ${location}\n` +
      bedroomsLine +
      whatsappLine +
      `\n${(property.description || '').slice(0, 300)}\n\n` +
      `✨ Más información en la app AlquilaBo\n` +
      `🔗 ${appUrl}`
    );
  }

  buildFinalSocialCaption(postText: string, urlMapa: string): string {
    const trimmed = (postText || '').trim();
    const hasAlquilaBoFooter = /m[aá]s informaci[oó]n en (la app )?alquilabo/i.test(
      trimmed,
    );
    const hasLink = trimmed.includes(urlMapa);

    if (hasAlquilaBoFooter && hasLink) {
      return trimmed;
    }

    if (hasAlquilaBoFooter && !hasLink) {
      return `${trimmed}\n🔗 ${urlMapa}`;
    }

    return `${trimmed}\n\n✨ Más información en la app AlquilaBo\n🔗 ${urlMapa}`;
  }

  async getQuotaForUser(userId: string) {
    return this.usersService.getDiffusionQuotaForUser(userId);
  }

  async createFreeWeeklyDiffusion(userId: string, propertyId: string) {
    const [property, user] = await Promise.all([
      this.prisma.property.findUnique({ where: { id: propertyId } }),
      this.prisma.user.findUnique({ where: { id: userId } }),
    ]);

    if (!property) {
      throw new NotFoundException('El inmueble indicado no existe');
    }

    if (property.userId !== userId && user?.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Solo puedes solicitar difusión para tus propios inmuebles',
      );
    }

    if (property.status !== 'ACTIVO') {
      throw new BadRequestException(
        'Solo los inmuebles con estado ACTIVO pueden difundirse en redes sociales',
      );
    }

    const activePending = await this.prisma.socialDiffusion.findFirst({
      where: {
        propertyId: property.id,
        status: { in: ['PENDIENTE', 'APROBADO'] },
      },
    });
    if (activePending) {
      throw new BadRequestException(
        'Este inmueble ya tiene una difusión pendiente de revisión o en proceso de publicación',
      );
    }

    const quota = await this.usersService.getDiffusionQuotaForUser(userId);
    if (!quota.canPublishFree) {
      throw new BadRequestException({
        message: `Ya utilizaste tu difusión gratuita de esta semana (lunes a domingo). Si deseas difundir más veces esta semana, el costo es de ${quota.extraDiffusionPriceBs} Bs.`,
        code: 'FREE_DIFFUSION_QUOTA_EXCEEDED',
        extraDiffusionPriceBs: quota.extraDiffusionPriceBs,
        diffusionProductId: quota.diffusionProductId,
        weekStart: quota.weekStart,
        weekEnd: quota.weekEnd,
      });
    }

    const postText = this.buildInitialPostText(property);
    const now = new Date();

    const created = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { lastFreeDiffusionAt: now },
      });

      const diffusion = await tx.socialDiffusion.create({
        data: {
          userId,
          propertyId: property.id,
          orderId: null,
          isFreeQuota: true,
          status: 'PENDIENTE',
          postText,
        },
      });

      await tx.notification.create({
        data: {
          userId,
          title: 'Difusión gratuita enviada a revisión',
          message: `Usaste tu difusión gratis semanal para "${property.title}". Nuestro equipo la revisará antes de publicarla en redes.`,
          type: 'FREE_DIFFUSION_QUEUED',
          metadata: { diffusionId: diffusion.id, propertyId: property.id },
        },
      });

      return diffusion;
    });

    return {
      diffusion: created,
      quotaAfter: await this.usersService.getDiffusionQuotaForUser(userId),
    };
  }

  /**
   * Redondea las coordenadas a ~3 decimales (~110m) para no exponer nunca
   * la dirección exacta del inmueble en imágenes públicas de redes sociales.
   */
  private getApproximateCoords(lat: number, lng: number) {
    const latApprox = Math.round(lat * 1000) / 1000;
    const lngApprox = Math.round(lng * 1000) / 1000;
    // Imagen estática pública de zona aproximada (sin pin exacto de domicilio)
    const staticMapUrl = `https://staticmap.openstreetmap.de/staticmap.php?center=${latApprox},${lngApprox}&zoom=15&size=800x800&maptype=mapnik`;
    return { latApprox, lngApprox, staticMapUrl };
  }

  evaluateQualityChecks(diffusion: any): DiffusionQualityReport {
    const blockers: string[] = [];
    const warnings: string[] = [];
    const prop = diffusion.property;
    const order = diffusion.order;

    if (!diffusion.isFreeQuota) {
      if (!order || order.status !== 'PAGADA') {
        blockers.push(
          `La orden asociada no figura como PAGADA (estado actual: ${order?.status || 'SIN_ORDEN'}).`,
        );
      }
    }

    if (!prop) {
      blockers.push('El inmueble asociado no existe.');
    } else {
      if (prop.status !== 'ACTIVO') {
        blockers.push(
          `El inmueble debe estar ACTIVO para difundirse (estado actual: ${prop.status}).`,
        );
      }

      const rawImages = Array.isArray(prop.images) ? prop.images : [];
      const validPublicUrls = rawImages.filter(
        (img: unknown) =>
          typeof img === 'string' && /^https?:\/\/.+/i.test(img.trim()),
      );

      if (validPublicUrls.length === 0) {
        blockers.push(
          'El inmueble no tiene fotos con URL pública directa (http/https) requeridas por Meta Graph API.',
        );
      } else if (validPublicUrls.length < 2) {
        warnings.push(
          'El inmueble solo tiene 1 foto; en Instagram rinde mejor un carrusel con al menos 3 fotos.',
        );
      }

      if (!prop.zone) {
        warnings.push(
          'El inmueble no especifica zona/barrio; se mostrará únicamente la ciudad.',
        );
      }

      if (prop.bedrooms === null || prop.bedrooms === undefined) {
        warnings.push('No se especificó el número de dormitorios.');
      }
    }

    const postText = (diffusion.postText || '').trim();
    if (!postText) {
      blockers.push('El texto del post (postText) no puede estar vacío.');
    } else if (postText.length > 2100) {
      warnings.push(
        `El texto del post tiene ${postText.length} caracteres y se acerca al límite de 2200 caracteres de Instagram.`,
      );
    }

    return {
      canPublishToN8n: blockers.length === 0,
      blockers,
      warnings,
    };
  }

  private buildN8nPayload(diffusion: any) {
    const prop = diffusion.property;
    const callbackBaseUrl = (
      process.env.N8N_CALLBACK_BASE_URL ||
      process.env.PUBLIC_API_BASE_URL ||
      'http://backend:3000'
    ).replace(/\/+$/, '');
    const publicApiBaseUrl = (
      process.env.PUBLIC_API_BASE_URL || callbackBaseUrl
    ).replace(/\/+$/, '');

    const { latApprox, lngApprox, staticMapUrl } = this.getApproximateCoords(
      prop.latitude,
      prop.longitude,
    );

    const fotos = Array.isArray(prop.images)
      ? prop.images.filter(
          (img: unknown) =>
            typeof img === 'string' && /^https?:\/\/.+/i.test(img.trim()),
        )
      : [];

    const urlMapa = this.buildPropertyAppUrl(prop.id);
    const captionRedes = this.buildFinalSocialCaption(
      diffusion.postText,
      urlMapa,
    );
    const imagenGeneradaUrl = `${publicApiBaseUrl}/public/diffusions/${diffusion.id}/social-card.png`;
    const imagenGeneradaInternalUrl = `${callbackBaseUrl}/public/diffusions/${diffusion.id}/social-card.png`;

    return {
      difusion_id: diffusion.id,
      inmueble_id: prop.id,
      titulo: prop.title,
      tipo_operacion: prop.listingType.toLowerCase(),
      tipo_inmueble: prop.propertyType.toLowerCase(),
      precio: prop.price,
      moneda: prop.currency,
      zona: prop.zone || prop.city,
      ciudad: prop.city,
      dormitorios: prop.bedrooms ?? null,
      whatsapp: prop.whatsapp ?? null,
      latitud_aprox: latApprox,
      longitud_aprox: lngApprox,
      mapa_zona_url: staticMapUrl,
      foto_principal_url: fotos[0] || null,
      imagen_generada_url: imagenGeneradaUrl,
      imagen_generada_internal_url: imagenGeneradaInternalUrl,
      texto_post: diffusion.postText,
      caption_redes: captionRedes,
      fotos,
      url_mapa: urlMapa,
      verificado: prop.isVerified,
      prev_fb_post_id: diffusion.fbPostId ?? null,
      prev_ig_media_id: diffusion.igMediaId ?? null,
      callback_url: `${callbackBaseUrl}/webhooks/n8n/diffusion`,
    };
  }

  async getDiffusionSocialCardBuffer(diffusionId: string): Promise<Buffer> {
    const diffusion = await this.prisma.socialDiffusion.findUnique({
      where: { id: diffusionId },
      include: { property: true },
    });
    if (!diffusion || !diffusion.property) {
      throw new NotFoundException('Difusión o inmueble no encontrado');
    }

    const appUrl = this.buildPropertyAppUrl(diffusion.property.id);
    const { buffer } = await this.socialCardService.generateAndSaveSocialCard(
      diffusion.property,
      appUrl,
    );
    return buffer;
  }

  async getPropertySocialCardBuffer(propertyId: string): Promise<Buffer> {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
    });
    if (!property) {
      throw new NotFoundException('Inmueble no encontrado');
    }

    const appUrl = this.buildPropertyAppUrl(property.id);
    const { buffer } = await this.socialCardService.generateAndSaveSocialCard(
      property,
      appUrl,
    );
    return buffer;
  }

  async getQueueStats() {
    const grouped = await this.prisma.socialDiffusion.groupBy({
      by: ['status'],
      _count: { _all: true },
    });

    const stats: Record<string, number> = {
      PENDIENTE: 0,
      APROBADO: 0,
      PUBLICADO: 0,
      RECHAZADO: 0,
      ERROR: 0,
    };

    for (const row of grouped) {
      stats[row.status] = row._count._all;
    }

    return stats;
  }

  async listAdminDiffusions(filter: FilterAdminDiffusionsDto) {
    const { status, city, page = 1, limit = 20 } = filter;
    const where: any = {};

    if (status) {
      where.status = status.toUpperCase();
    }
    if (city) {
      where.property = { city };
    }

    const orderDirection =
      !status || status.toUpperCase() === 'PENDIENTE' ? 'asc' : 'desc';
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.socialDiffusion.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: orderDirection },
        include: {
          order: {
            select: {
              id: true,
              status: true,
              amountBs: true,
              paidAt: true,
            },
          },
          property: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  phone: true,
                  email: true,
                  accountType: true,
                },
              },
            },
          },
          approvedBy: {
            select: { id: true, name: true, role: true },
          },
        },
      }),
      this.prisma.socialDiffusion.count({ where }),
    ]);

    return {
      data: items.map((item) => ({
        ...item,
        order: item.order
          ? { ...item.order, amountBs: Number(item.order.amountBs) }
          : null,
        qualityChecks: this.evaluateQualityChecks(item),
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getDiffusionDetail(id: string) {
    const diffusion = await this.prisma.socialDiffusion.findUnique({
      where: { id },
      include: {
        order: true,
        property: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                phone: true,
                email: true,
                accountType: true,
                logoUrl: true,
              },
            },
          },
        },
        approvedBy: {
          select: { id: true, name: true, role: true },
        },
      },
    });

    if (!diffusion) throw new NotFoundException('Difusión no encontrada');

    return {
      ...diffusion,
      order: diffusion.order
        ? {
            ...diffusion.order,
            amountBs: Number(diffusion.order.amountBs),
          }
        : null,
      qualityChecks: this.evaluateQualityChecks(diffusion),
    };
  }

  async previewDiffusionForN8n(id: string) {
    const diffusion = await this.prisma.socialDiffusion.findUnique({
      where: { id },
      include: {
        order: true,
        property: true,
      },
    });
    if (!diffusion) throw new NotFoundException('Difusión no encontrada');

    const qualityChecks = this.evaluateQualityChecks(diffusion);
    const n8nPayload = this.buildN8nPayload(diffusion);

    return {
      diffusionId: diffusion.id,
      currentStatus: diffusion.status,
      qualityChecks,
      socialPreview: {
        generatedImageUrl: n8nPayload.imagen_generada_url,
        facebookCaption: n8nPayload.caption_redes,
        instagramCaption: n8nPayload.caption_redes,
        carouselMedia: [n8nPayload.imagen_generada_url],
      },
      n8nPayload,
    };
  }

  async updateDiffusionDraft(id: string, dto: UpdateDiffusionDto) {
    const diffusion = await this.prisma.socialDiffusion.findUnique({
      where: { id },
    });
    if (!diffusion) throw new NotFoundException('Difusión no encontrada');

    return this.prisma.socialDiffusion.update({
      where: { id },
      data: {
        ...(dto.postText !== undefined ? { postText: dto.postText } : {}),
        ...(dto.internalNotes !== undefined
          ? { internalNotes: dto.internalNotes }
          : {}),
      },
    });
  }

  private async dispatchToN8n(diffusionId: string) {
    const diffusion = await this.prisma.socialDiffusion.findUnique({
      where: { id: diffusionId },
      include: { property: true, order: true },
    });
    if (!diffusion) throw new NotFoundException('Difusión no encontrada');

    const webhookUrl = process.env.N8N_DIFFUSION_WEBHOOK_URL;
    const webhookSecret = process.env.N8N_WEBHOOK_SECRET || '';

    if (!webhookUrl) {
      return this.prisma.socialDiffusion.update({
        where: { id: diffusion.id },
        data: {
          status: 'ERROR',
          errorDetail:
            'N8N_DIFFUSION_WEBHOOK_URL no está configurada en las variables de entorno.',
        },
      });
    }

    const payload = this.buildN8nPayload(diffusion);

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': webhookSecret,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${errBody.slice(0, 300)}`);
      }

      return this.prisma.socialDiffusion.findUnique({
        where: { id: diffusion.id },
        include: {
          approvedBy: { select: { id: true, name: true, role: true } },
        },
      });
    } catch (err: any) {
      this.logger.error(
        `Error enviando difusión ${diffusion.id} a n8n: ${err?.message}`,
      );
      return this.prisma.socialDiffusion.update({
        where: { id: diffusion.id },
        data: {
          status: 'ERROR',
          errorDetail: err?.message || 'Error de conexión con n8n',
        },
      });
    }
  }

  async approveDiffusion(
    reviewerId: string,
    id: string,
    dto?: ApproveDiffusionDto,
  ) {
    const diffusion = await this.prisma.socialDiffusion.findUnique({
      where: { id },
      include: { property: true, order: true },
    });
    if (!diffusion) throw new NotFoundException('Difusión no encontrada');

    if (diffusion.status === 'PUBLICADO') {
      throw new BadRequestException('Esta difusión ya fue publicada en redes');
    }

    // Evaluar con el postText actualizado (si el revisor lo envió al aprobar)
    const candidate = {
      ...diffusion,
      postText: dto?.postText ?? diffusion.postText,
    };
    const quality = this.evaluateQualityChecks(candidate);
    if (!quality.canPublishToN8n) {
      throw new BadRequestException({
        message:
          'No se puede aprobar la publicación hacia n8n porque existen requisitos incumplidos',
        blockers: quality.blockers,
      });
    }

    await this.prisma.socialDiffusion.update({
      where: { id },
      data: {
        status: 'APROBADO',
        approvedById: reviewerId,
        reviewedAt: new Date(),
        errorDetail: null,
        rejectionReason: null,
        ...(dto?.postText !== undefined ? { postText: dto.postText } : {}),
        ...(dto?.internalNotes !== undefined
          ? { internalNotes: dto.internalNotes }
          : {}),
      },
    });

    return this.dispatchToN8n(id);
  }

  async rejectDiffusion(
    reviewerId: string,
    id: string,
    dto: RejectDiffusionDto,
  ) {
    const diffusion = await this.prisma.socialDiffusion.findUnique({
      where: { id },
      include: { property: true },
    });
    if (!diffusion) throw new NotFoundException('Difusión no encontrada');

    if (diffusion.status === 'PUBLICADO') {
      throw new BadRequestException(
        'No se puede rechazar una difusión que ya fue publicada en redes',
      );
    }

    const updated = await this.prisma.socialDiffusion.update({
      where: { id },
      data: {
        status: 'RECHAZADO',
        approvedById: reviewerId,
        reviewedAt: new Date(),
        rejectionReason: dto.reason,
        ...(dto.internalNotes !== undefined
          ? { internalNotes: dto.internalNotes }
          : {}),
      },
      include: {
        approvedBy: { select: { id: true, name: true, role: true } },
      },
    });

    await this.prisma.notification.create({
      data: {
        userId: diffusion.property.userId,
        title: 'Difusión en redes no aprobada',
        message: `Un revisor observó la difusión de "${diffusion.property.title}" por el siguiente motivo: ${dto.reason}. No se publicó en redes; corrige tu anuncio y reenvíalo sin costo.`,
        type: 'DIFFUSION_REJECTED',
        metadata: { diffusionId: id, propertyId: diffusion.propertyId },
      },
    });

    return updated;
  }

  async retryDiffusion(reviewerId: string, id: string) {
    const diffusion = await this.prisma.socialDiffusion.findUnique({
      where: { id },
      include: { property: true, order: true },
    });
    if (!diffusion) throw new NotFoundException('Difusión no encontrada');

    if (diffusion.status !== 'ERROR' && diffusion.status !== 'APROBADO') {
      throw new BadRequestException(
        'Solo se pueden reintentar difusiones en estado ERROR o APROBADO',
      );
    }

    const quality = this.evaluateQualityChecks(diffusion);
    if (!quality.canPublishToN8n) {
      throw new BadRequestException({
        message: 'No se puede reintentar hacia n8n por requisitos pendientes',
        blockers: quality.blockers,
      });
    }

    await this.prisma.socialDiffusion.update({
      where: { id },
      data: {
        status: 'APROBADO',
        approvedById: reviewerId,
        reviewedAt: new Date(),
        errorDetail: null,
      },
    });

    return this.dispatchToN8n(id);
  }

  async resubmitDiffusionByOwner(userId: string, id: string) {
    const diffusion = await this.prisma.socialDiffusion.findUnique({
      where: { id },
      include: { property: true },
    });
    if (!diffusion) throw new NotFoundException('Difusión no encontrada');
    if (diffusion.property.userId !== userId) {
      throw new ForbiddenException('No tienes permiso sobre esta difusión');
    }
    if (diffusion.status !== 'RECHAZADO') {
      throw new BadRequestException(
        'Solo puedes reenviar una difusión que haya sido observada/rechazada',
      );
    }

    return this.prisma.socialDiffusion.update({
      where: { id },
      data: {
        status: 'PENDIENTE',
        rejectionReason: null,
      },
    });
  }

  async handleN8nCallback(dto: N8nDiffusionCallbackDto) {
    const diffusion = await this.prisma.socialDiffusion.findUnique({
      where: { id: dto.difusion_id },
      include: { property: true },
    });
    if (!diffusion) {
      throw new NotFoundException('Difusión no encontrada');
    }

    const isError =
      dto.estado.toUpperCase() === 'ERROR' || Boolean(dto.error);

    const updated = await this.prisma.socialDiffusion.update({
      where: { id: diffusion.id },
      data: {
        status: isError ? 'ERROR' : 'PUBLICADO',
        fbPostId: dto.fb_post_id ?? diffusion.fbPostId,
        igMediaId: dto.ig_media_id ?? diffusion.igMediaId,
        errorDetail: dto.error ?? null,
        publishedAt: isError ? diffusion.publishedAt : new Date(),
      },
    });

    if (!isError) {
      await this.prisma.notification.create({
        data: {
          userId: diffusion.property.userId,
          title: '¡Tu inmueble ya está en nuestras redes sociales!',
          message: `"${diffusion.property.title}" fue publicado exitosamente en nuestras redes oficiales.`,
          type: 'DIFFUSION_PUBLISHED',
          metadata: {
            diffusionId: diffusion.id,
            propertyId: diffusion.propertyId,
            fbPostId: updated.fbPostId,
            igMediaId: updated.igMediaId,
          },
        },
      });
    }

    return updated;
  }

  async getWeeklySummaryForN8n() {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const properties = await this.prisma.property.findMany({
      where: {
        status: 'ACTIVO',
        createdAt: { gte: sevenDaysAgo },
      },
      orderBy: [
        { featuredUntil: 'desc' },
        { isVerified: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    const grouped: Record<
      string,
      {
        city: string;
        zone: string;
        count: number;
        items: any[];
      }
    > = {};

    for (const p of properties) {
      const zoneName = p.zone || 'General';
      const key = `${p.city}::${zoneName}`;
      if (!grouped[key]) {
        grouped[key] = {
          city: p.city,
          zone: zoneName,
          count: 0,
          items: [],
        };
      }
      grouped[key].count += 1;
      grouped[key].items.push({
        id: p.id,
        title: p.title,
        listingType: p.listingType,
        propertyType: p.propertyType,
        price: p.price,
        currency: p.currency,
        bedrooms: p.bedrooms,
        isFeatured: Boolean(p.featuredUntil && p.featuredUntil > now),
        isVerified: p.isVerified,
        images: p.images,
      });
    }

    return {
      since: sevenDaysAgo,
      until: now,
      totalNewProperties: properties.length,
      zones: Object.values(grouped).sort((a, b) => b.count - a.count),
    };
  }
}
