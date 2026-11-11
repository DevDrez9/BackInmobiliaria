import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import sharp from 'sharp';

export interface SocialCardPropertyInput {
  id: string;
  title: string;
  listingType: string;
  propertyType?: string | null;
  price?: number | null;
  currency?: string | null;
  city: string;
  zone?: string | null;
  bedrooms?: number | null;
  whatsapp?: string | null;
  description?: string | null;
  isVerified?: boolean | null;
  images?: unknown;
}

@Injectable()
export class SocialCardService {
  private readonly logger = new Logger(SocialCardService.name);
  private readonly outputDir = path.join(
    process.cwd(),
    'uploads',
    'social-cards',
  );
  private readonly logoPath = path.join(
    process.cwd(),
    'assets',
    'logo-alquilabo.jpg',
  );

  private escapeXml(unsafe: string): string {
    return String(unsafe ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private wrapText(
    text: string,
    maxCharsPerLine: number,
    maxLines: number,
  ): string[] {
    const clean = String(text ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!clean) return [];

    const words = clean.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (candidate.length <= maxCharsPerLine) {
        currentLine = candidate;
      } else {
        if (currentLine) {
          lines.push(currentLine);
          if (lines.length >= maxLines) {
            const lastIdx = lines.length - 1;
            lines[lastIdx] =
              lines[lastIdx]
                .slice(0, Math.max(0, maxCharsPerLine - 3))
                .trimEnd() + '...';
            return lines;
          }
        }
        currentLine =
          word.length > maxCharsPerLine
            ? word.slice(0, maxCharsPerLine - 3) + '...'
            : word;
      }
    }

    if (currentLine && lines.length < maxLines) {
      lines.push(currentLine);
    }

    return lines;
  }

  private formatOperationTitle(listingType: string): string {
    const op = String(listingType || 'ALQUILER').toUpperCase();
    if (op === 'VENTA') return 'Venta';
    if (op === 'ANTICRETICO') return 'Anticrético';
    return 'Alquiler';
  }

  private formatPropertyTypeLabel(propertyType?: string | null): string {
    const raw = String(propertyType || 'INMUEBLE').toUpperCase();
    if (raw === 'DEPARTAMENTO') return 'Departamento';
    if (raw === 'CASA') return 'Casa';
    if (raw === 'TIENDA') return 'Tienda comercial';
    if (raw === 'LOCAL') return 'Local comercial';
    return 'Inmueble';
  }

  private getPhotoSources(images: unknown, maxCount = 3): string[] {
    if (!Array.isArray(images)) return [];
    return images
      .filter((img): img is string => typeof img === 'string' && img.trim().length > 0)
      .map((img) => img.trim())
      .slice(0, maxCount);
  }

  private async loadPhotoBuffer(source: string): Promise<Buffer | null> {
    if (!source) return null;

    try {
      if (source.startsWith('data:image/')) {
        const base64Part = source.split(',')[1];
        if (base64Part) {
          return Buffer.from(base64Part, 'base64');
        }
      }

      if (/^https?:\/\/.+/i.test(source)) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
          const response = await fetch(source, { signal: controller.signal });
          if (response.ok && typeof response.arrayBuffer === 'function') {
            const arrayBuf = await response.arrayBuffer();
            return Buffer.from(arrayBuf);
          }
        } finally {
          clearTimeout(timeout);
        }
        return null;
      }

      const localPath = source.startsWith('/')
        ? path.join(process.cwd(), source.replace(/^\/+/, ''))
        : path.resolve(process.cwd(), source);
      return await fs.readFile(localPath);
    } catch (err: any) {
      this.logger.warn(
        `No se pudo cargar la imagen (${source}): ${err?.message}`,
      );
      return null;
    }
  }

  private async loadLogoBuffer(): Promise<Buffer | null> {
    try {
      const rawLogo = await fs.readFile(this.logoPath);
      return await sharp(rawLogo)
        .trim({ threshold: 20 })
        .resize(290, 175, {
          fit: 'contain',
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        })
        .png()
        .toBuffer();
    } catch (err: any) {
      this.logger.warn(`No se pudo cargar el logo AlquilaBO: ${err?.message}`);
      return null;
    }
  }

  private async prepareTileBuffer(
    buf: Buffer | null,
    width: number,
    height: number,
    fallbackRgb = { r: 30, g: 41, b: 59 },
  ): Promise<Buffer> {
    if (buf) {
      try {
        return await sharp(buf)
          .resize(width, height, { fit: 'cover', position: 'center' })
          .png()
          .toBuffer();
      } catch {
        // Fallback si el buffer no es una imagen válida
      }
    }

    return sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { ...fallbackRgb, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
  }

  private buildBulletItems(property: SocialCardPropertyInput): string[] {
    const items: string[] = [];

    // 1. Tipo de propiedad
    items.push(`Tipo: ${this.formatPropertyTypeLabel(property.propertyType)}`);

    // 2. Dormitorios (si aplica)
    if (property.bedrooms !== null && property.bedrooms !== undefined) {
      items.push(
        `Dormitorios: ${property.bedrooms}`,
      );
    }

    // 3. Ciudad
    if (property.city) {
      items.push(`Ciudad: ${property.city}`);
    }

    // 4. Zona
    if (property.zone) {
      items.push(`Zona: ${property.zone}`);
    }

    // 5. Estado Verificado (si aplica)
    if (property.isVerified) {
      items.push('Inmueble Verificado ✓');
    }

    // 6. Características extraídas de la descripción que llenó el usuario
    if (property.description) {
      const descParts = property.description
        .split(/[\n•,;]+/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 4);

      for (const part of descParts) {
        if (items.length >= 8) break;
        const wrapped = this.wrapText(part, 27, 2);
        if (wrapped.length > 0) {
          items.push(wrapped[0]);
        }
      }
    }

    return items.slice(0, 8);
  }

  buildLeftPanelSvg(property: SocialCardPropertyInput, appLink: string): string {
    const opLabel = this.escapeXml(
      this.formatOperationTitle(property.listingType),
    );

    // Título / Tipo de inmueble en mayúsculas (envuelto a ~15 caracteres como en la referencia)
    const rawHeading = (
      property.title || this.formatPropertyTypeLabel(property.propertyType)
    ).toUpperCase();
    const headingLines = this.wrapText(rawHeading, 15, 2);
    const heading1 = this.escapeXml(headingLines[0] || 'INMUEBLE');
    const heading2 = headingLines[1] ? this.escapeXml(headingLines[1]) : null;

    // Zona y Ciudad junto al ícono de ubicación rojo
    const zoneRaw = (property.zone || property.city || 'BOLIVIA').toUpperCase();
    const cityRaw = (property.city || '').toUpperCase();
    const zoneLines = this.wrapText(zoneRaw, 16, 2);
    const locLine1 = this.escapeXml(zoneLines[0] || cityRaw);
    const locLine2 = zoneLines[1]
      ? this.escapeXml(zoneLines[1])
      : property.zone && cityRaw
        ? this.escapeXml(cityRaw)
        : null;
    const locLine3 =
      zoneLines[1] && property.zone && cityRaw
        ? this.escapeXml(cityRaw)
        : null;

    // Lista de características de la publicación (SIN PRECIO)
    const bulletItems = this.buildBulletItems(property);
    const bulletStartY = 615;
    const bulletSvgs = bulletItems
      .map((item, idx) => {
        const y = bulletStartY + idx * 36;
        if (y > 905) return '';
        const textEscaped = this.escapeXml(
          item.length > 27 ? item.slice(0, 25).trimEnd() + '...' : item,
        );
        return `
        <circle cx="34" cy="${y - 7}" r="4.5" fill="#16A34A" />
        <text x="48" y="${y}" font-family="DejaVu Sans, Arial, Helvetica, sans-serif" font-size="20" font-weight="bold" fill="#1E293B">${textEscaped}</text>`;
      })
      .join('');

    const shortDomain = this.escapeXml(
      appLink.replace(/^https?:\/\//i, '').split('?')[0],
    );

    return `<svg width="375" height="1080" viewBox="0 0 375 1080" xmlns="http://www.w3.org/2000/svg">
      <!-- Fondo blanco columna izquierda -->
      <rect x="0" y="0" width="375" height="1080" fill="#FFFFFF" />

      <!-- Línea separadora bajo el espacio del logo -->
      <line x1="24" y1="206" x2="351" y2="206" stroke="#E2E8F0" stroke-width="2" />

      <!-- Tipo de operación: En Alquiler / En Venta / En Anticrético -->
      <text x="26" y="262" font-family="DejaVu Serif, Georgia, Times New Roman, serif" font-size="46" font-weight="bold" fill="#111827">En</text>
      <text x="26" y="316" font-family="DejaVu Serif, Georgia, Times New Roman, serif" font-size="48" font-weight="bold" fill="#111827">${opLabel}</text>
      <line x1="0" y1="338" x2="265" y2="338" stroke="#1E3A8A" stroke-width="4" />

      <!-- Título / Tipo de inmueble en mayúsculas -->
      <text x="26" y="392" font-family="DejaVu Sans, Arial, Helvetica, sans-serif" font-size="29" font-weight="bold" fill="#111827">${heading1}</text>
      ${
        heading2
          ? `<text x="26" y="428" font-family="DejaVu Sans, Arial, Helvetica, sans-serif" font-size="29" font-weight="bold" fill="#111827">${heading2}</text>`
          : ''
      }

      <!-- Pin de Ubicación Rojo + Zona y Ciudad -->
      <g transform="translate(24, ${heading2 ? 458 : 430})">
        <path d="M22 0C9.85 0 0 9.85 0 22C0 38.5 22 58 22 58C22 58 44 38.5 44 22C44 9.85 34.15 0 22 0Z" fill="#EF4444" stroke="#111827" stroke-width="2.5" />
        <circle cx="22" cy="21" r="8" fill="#7F1D1D" />
      </g>

      <text x="80" y="${heading2 ? 488 : 460}" font-family="DejaVu Sans, Arial, Helvetica, sans-serif" font-size="25" font-weight="bold" fill="#111827" letter-spacing="0.5">${locLine1}</text>
      ${
        locLine2
          ? `<text x="80" y="${heading2 ? 520 : 492}" font-family="DejaVu Sans, Arial, Helvetica, sans-serif" font-size="23" font-weight="bold" fill="#1E293B" letter-spacing="0.5">${locLine2}</text>`
          : ''
      }
      ${
        locLine3
          ? `<text x="80" y="${heading2 ? 550 : 522}" font-family="DejaVu Sans, Arial, Helvetica, sans-serif" font-size="21" font-weight="bold" fill="#475569">${locLine3}</text>`
          : ''
      }

      <!-- Encabezado de Lista de Características (Sin Precio) -->
      <line x1="24" y1="${bulletStartY - 36}" x2="351" y2="${bulletStartY - 36}" stroke="#CBD5E1" stroke-width="1.5" />
      ${bulletSvgs}

      <!-- Parte inferior: Más información en la app AlquilaBo -->
      <g transform="translate(16, 932)">
        <rect x="0" y="0" width="343" height="122" rx="16" fill="#0B1F3A" />
        <rect x="0" y="0" width="343" height="6" rx="3" fill="#16A34A" />
        <text x="171" y="52" font-family="DejaVu Sans, Arial, Helvetica, sans-serif" font-size="23" font-weight="bold" fill="#F8FAFC" text-anchor="middle">Más información en</text>
        <text x="171" y="92" font-family="DejaVu Sans, Arial, Helvetica, sans-serif" font-size="30" font-weight="bold" fill="#FFFFFF" text-anchor="middle">la app <tspan fill="#22C55E">AlquilaBO</tspan></text>
      </g>
    </svg>`;
  }

  async generateSocialCardBuffer(
    property: SocialCardPropertyInput,
    appLink: string,
  ): Promise<Buffer> {
    // 1. Tomar máximo 3 imágenes subidas a la app
    const sources = this.getPhotoSources(property.images, 3);
    const loadedBuffers = await Promise.all(
      sources.map((src) => this.loadPhotoBuffer(src)),
    );

    const validPhotos = loadedBuffers.filter((b): b is Buffer => b !== null);

    // 2. Construir el collage derecho (x = 375..1080, ancho = 705, alto = 1080)
    const composites: sharp.OverlayOptions[] = [];

    if (validPhotos.length >= 3) {
      // 3 fotos: 2 arriba (348x536 y 349x536) y 1 grande abajo (705x536), igual a la imagen de referencia
      const [top1, top2, bottom3] = await Promise.all([
        this.prepareTileBuffer(validPhotos[0], 348, 536),
        this.prepareTileBuffer(validPhotos[1], 349, 536),
        this.prepareTileBuffer(validPhotos[2], 705, 536),
      ]);
      composites.push(
        { input: top1, left: 375, top: 0 },
        { input: top2, left: 731, top: 0 },
        { input: bottom3, left: 375, top: 544 },
      );
    } else if (validPhotos.length === 2) {
      // 2 fotos: 1 arriba (705x536) y 1 abajo (705x536)
      const [top1, bottom2] = await Promise.all([
        this.prepareTileBuffer(validPhotos[0], 705, 536),
        this.prepareTileBuffer(validPhotos[1], 705, 536),
      ]);
      composites.push(
        { input: top1, left: 375, top: 0 },
        { input: bottom2, left: 375, top: 544 },
      );
    } else {
      // 1 foto (o fallback si no hay fotos): ocupa todo el panel derecho (705x1080)
      const single = await this.prepareTileBuffer(
        validPhotos[0] ?? null,
        705,
        1080,
      );
      composites.push({ input: single, left: 375, top: 0 });
    }

    // 3. Panel izquierdo blanco con textos en lista, zona, operación y pie de AlquilaBo
    const leftPanelSvg = this.buildLeftPanelSvg(property, appLink);
    composites.push({
      input: Buffer.from(leftPanelSvg),
      left: 0,
      top: 0,
    });

    // 4. Logo oficial de AlquilaBO en la parte superior izquierda
    const logoBuffer = await this.loadLogoBuffer();
    if (logoBuffer) {
      composites.push({
        input: logoBuffer,
        left: 42,
        top: 18,
      });
    }

    // Lienzo base 1080x1080 con fondo oscuro para las líneas divisorias entre las 3 fotos
    return sharp({
      create: {
        width: 1080,
        height: 1080,
        channels: 4,
        background: { r: 15, g: 23, b: 42, alpha: 1 },
      },
    })
      .composite(composites)
      .png({ quality: 92 })
      .toBuffer();
  }

  async generateAndSaveSocialCard(
    property: SocialCardPropertyInput,
    appLink: string,
  ): Promise<{ buffer: Buffer; filePath: string; fileName: string }> {
    const buffer = await this.generateSocialCardBuffer(property, appLink);
    await fs.mkdir(this.outputDir, { recursive: true });
    const fileName = `alquilabo-${property.id}.png`;
    const filePath = path.join(this.outputDir, fileName);
    await fs.writeFile(filePath, buffer);
    return { buffer, filePath, fileName };
  }
}
