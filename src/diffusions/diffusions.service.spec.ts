import { BadRequestException } from '@nestjs/common';
import { DiffusionsService } from './diffusions.service';

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
});
