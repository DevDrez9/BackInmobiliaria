import { BadRequestException } from '@nestjs/common';
import { DiffusionsService } from './diffusions.service';
import { SocialCardService } from './social-card.service';
import sharp from 'sharp';

describe('DiffusionsService (Weekly free quota + Admin/Revisor moderation -> n8n)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const makeMockPrisma = () => ({
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    property: {
      findUnique: jest.fn(),
    },
    socialDiffusion: {
      findUnique: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    notification: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  });

  const makeMockUsersService = (overrides: Record<string, any> = {}) => ({
    getDiffusionQuotaForUser: jest.fn().mockResolvedValue({
      weekStart: new Date('2026-10-26T04:00:00.000Z'),
      weekEnd: new Date('2026-11-02T03:59:59.999Z'),
      freeWeeklyLimit: 1,
      freeUsedThisWeek: 0,
      freeRemainingThisWeek: 1,
      canPublishFree: true,
      extraDiffusionPriceBs: 10,
      diffusionProductId: 'prd-difusion',
      ...overrides,
    }),
  });

  it('allows 1 free diffusion per week (Mon-Sun) and blocks the 2nd requiring 10 Bs or 35 Bs', async () => {
    const prisma = makeMockPrisma();
    prisma.$transaction.mockImplementation((cb: any) => cb(prisma));
    prisma.property.findUnique.mockResolvedValue({
      id: 'prop-free-1',
      userId: 'user-1',
      status: 'ACTIVO',
      title: 'Casa en Achumani',
      listingType: 'VENTA',
      price: 120000,
      currency: 'USD',
      city: 'La Paz',
      zone: 'Achumani',
      bedrooms: 3,
      description: 'Amplia casa con jardín',
    });
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'USER' });
    prisma.socialDiffusion.create.mockResolvedValue({
      id: 'diff-free-1',
      isFreeQuota: true,
      orderId: null,
      status: 'PENDIENTE',
    });

    const usersService = makeMockUsersService();
    const service = new DiffusionsService(prisma as any, usersService as any);

    const res = await service.createFreeWeeklyDiffusion('user-1', 'prop-free-1');
    expect(res.diffusion.isFreeQuota).toBe(true);
    expect(prisma.user.update).toHaveBeenCalledTimes(1);

    // Segundo intento en la misma semana para una Inmobiliaria (35 Bs)
    const usersServiceExhausted = makeMockUsersService({
      freeUsedThisWeek: 1,
      freeRemainingThisWeek: 0,
      canPublishFree: false,
      extraDiffusionPriceBs: 35,
    });
    const service2 = new DiffusionsService(
      prisma as any,
      usersServiceExhausted as any,
    );

    await expect(
      service2.createFreeWeeklyDiffusion('user-1', 'prop-free-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('blocks approval to n8n when property is PAUSADO or lacks public image URLs', async () => {
    const prisma = makeMockPrisma();
    prisma.socialDiffusion.findUnique.mockResolvedValue({
      id: 'diff-1',
      isFreeQuota: false,
      status: 'PENDIENTE',
      postText: 'Texto válido',
      order: { status: 'PAGADA' },
      property: {
        id: 'prop-1',
        status: 'PAUSADO',
        images: ['local-path-not-url.jpg'],
        latitude: -16.51234,
        longitude: -68.12345,
      },
    });

    const service = new DiffusionsService(
      prisma as any,
      makeMockUsersService() as any,
    );
    await expect(
      service.approveDiffusion('revisor-1', 'diff-1'),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.socialDiffusion.update).not.toHaveBeenCalled();
  });

  it('approves a FREE weekly diffusion (order=null, isFreeQuota=true) and dispatches to n8n', async () => {
    process.env.N8N_DIFFUSION_WEBHOOK_URL =
      'http://n8n:5678/webhook/difusion-inmueble';
    process.env.N8N_WEBHOOK_SECRET = 'secret-n8n-xyz';
    process.env.N8N_CALLBACK_BASE_URL = 'http://backend:3000';

    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    global.fetch = mockFetch as any;

    const prisma = makeMockPrisma();
    const record = {
      id: 'diff-2',
      isFreeQuota: true,
      order: null,
      status: 'PENDIENTE',
      postText: 'Depto en Sopocachi',
      fbPostId: null,
      igMediaId: null,
      property: {
        id: 'prop-2',
        title: 'Depto 2D',
        listingType: 'ANTICRETICO',
        propertyType: 'DEPARTAMENTO',
        status: 'ACTIVO',
        price: 25000,
        currency: 'USD',
        city: 'La Paz',
        zone: 'Sopocachi',
        bedrooms: 2,
        latitude: -16.51189,
        longitude: -68.12744,
        images: ['https://cdn.example.com/1.jpg', 'https://cdn.example.com/2.jpg'],
        isVerified: true,
      },
    };

    prisma.socialDiffusion.findUnique.mockResolvedValue(record);
    prisma.socialDiffusion.update.mockResolvedValue({
      ...record,
      status: 'APROBADO',
      approvedById: 'revisor-1',
    });

    const service = new DiffusionsService(
      prisma as any,
      makeMockUsersService() as any,
    );
    await service.approveDiffusion('revisor-1', 'diff-2', {
      internalNotes: 'Cupo gratis semanal aprobado',
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, fetchOpts] = mockFetch.mock.calls[0];
    expect(calledUrl).toBe('http://n8n:5678/webhook/difusion-inmueble');
    expect(fetchOpts.headers['X-Webhook-Secret']).toBe('secret-n8n-xyz');

    const sentBody = JSON.parse(fetchOpts.body);
    expect(sentBody.latitud_aprox).toBe(-16.512);
    expect(sentBody.longitud_aprox).toBe(-68.127);
    expect(sentBody.imagen_generada_url).toContain(
      '/public/diffusions/diff-2/social-card.png',
    );
    expect(sentBody.caption_redes).toContain(
      'Más información en la app AlquilaBo',
    );
    expect(sentBody.caption_redes).toContain(sentBody.url_mapa);
  });

  it('generates a 1080x1080 PNG social card with AlquilaBO logo, up to 3 photos, bullet list without price, and footer', async () => {
    const socialCardService = new SocialCardService();
    const makeSamplePhoto = async (r: number, g: number, b: number) => {
      const buf = await sharp({
        create: {
          width: 800,
          height: 600,
          channels: 3,
          background: { r, g, b },
        },
      })
        .png()
        .toBuffer();
      return `data:image/png;base64,${buf.toString('base64')}`;
    };

    const images = await Promise.all([
      makeSamplePhoto(180, 140, 100),
      makeSamplePhoto(120, 160, 190),
      makeSamplePhoto(150, 120, 110),
    ]);

    const pngBuffer = await socialCardService.generateSocialCardBuffer(
      {
        id: 'prop-card-1',
        title: 'Garzonier Amoblado',
        listingType: 'ALQUILER',
        propertyType: 'DEPARTAMENTO',
        price: 3200,
        currency: 'BOB',
        city: 'La Paz',
        zone: 'Calacoto Ballivian Calle 14',
        bedrooms: 1,
        whatsapp: '70503167',
        description:
          'Totalmente amoblado, Cocina equipada, Sala de estar luminosa, Excelente ubicación',
        isVerified: true,
        images,
      },
      'https://alquilabo.com/mapa?inmueble=prop-card-1',
    );

    const metadata = await sharp(pngBuffer).metadata();
    expect(metadata.format).toBe('png');
    expect(metadata.width).toBe(1080);
    expect(metadata.height).toBe(1080);
  });

  it('rejects diffusion without calling n8n and notifies property owner', async () => {
    const mockFetch = jest.fn();
    global.fetch = mockFetch as any;

    const prisma = makeMockPrisma();
    prisma.socialDiffusion.findUnique.mockResolvedValue({
      id: 'diff-3',
      propertyId: 'prop-3',
      status: 'PENDIENTE',
      property: {
        id: 'prop-3',
        userId: 'owner-1',
        title: 'Casa en Obrajes',
      },
    });
    prisma.socialDiffusion.update.mockResolvedValue({
      id: 'diff-3',
      status: 'RECHAZADO',
    });

    const service = new DiffusionsService(
      prisma as any,
      makeMockUsersService() as any,
    );
    await service.rejectDiffusion('revisor-1', 'diff-3', {
      reason: 'Fotos oscuras y borrosas',
      internalNotes: 'Pedir fotos de día',
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
  });

  it('generates a 1080x1080 JPEG city cover card with current publication date and groups daily approved diffusions by city', async () => {
    const socialCardService = new SocialCardService();
    const coverBuf = await socialCardService.generateCityCoverBuffer(
      {
        city: 'Santa Cruz',
        date: '2026-11-17',
        totalProperties: 2,
        samplePhotos: [],
      },
      'jpeg',
    );
    const meta = await sharp(coverBuf).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1080);

    const prisma = makeMockPrisma();
    prisma.socialDiffusion.findMany.mockResolvedValue([
      {
        id: 'diff-scz-1',
        status: 'APROBADO',
        approvedById: 'rev-1',
        postText: 'Depto en Equipetrol',
        property: {
          id: 'prop-scz-1',
          title: 'Depto 2D Equipetrol',
          listingType: 'ALQUILER',
          propertyType: 'DEPARTAMENTO',
          status: 'ACTIVO',
          price: 3500,
          currency: 'BOB',
          city: 'Santa Cruz',
          zone: 'Equipetrol',
          bedrooms: 2,
          latitude: -17.765,
          longitude: -63.195,
          images: ['https://cdn.example.com/scz1.jpg'],
          isVerified: true,
        },
      },
      {
        id: 'diff-lpz-1',
        status: 'APROBADO',
        approvedById: 'rev-1',
        postText: 'Casa en Calacoto',
        property: {
          id: 'prop-lpz-1',
          title: 'Casa 3D Calacoto',
          listingType: 'VENTA',
          propertyType: 'CASA',
          status: 'ACTIVO',
          price: 150000,
          currency: 'USD',
          city: 'La Paz',
          zone: 'Calacoto',
          bedrooms: 3,
          latitude: -16.535,
          longitude: -68.085,
          images: ['https://cdn.example.com/lpz1.jpg'],
          isVerified: false,
        },
      },
    ]);

    const service = new DiffusionsService(
      prisma as any,
      makeMockUsersService() as any,
    );
    const batches = await service.getDailyCityBatchesForN8n({
      network: 'tiktok',
      date: '2026-11-17',
    });

    expect(batches.totalCities).toBe(2);
    expect(batches.publicationDateDisplay).toBe('17/11/2026');
    const sczBatch = batches.cities.find((c) => c.city === 'Santa Cruz');
    expect(sczBatch).toBeDefined();
    expect(sczBatch?.carouselImagesJpg[0]).toContain(
      '/public/diffusions/city-cover/Santa%20Cruz/social-card.jpg?date=2026-11-17&count=1',
    );
    expect(sczBatch?.carouselImagesJpg[1]).toContain(
      '/public/diffusions/diff-scz-1/social-card.jpg',
    );
  });
});
