import { BadRequestException } from '@nestjs/common';
import { DiffusionsService } from './diffusions.service';

describe('DiffusionsService (Admin & Revisor moderation -> n8n)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const makeMockPrisma = () => ({
    socialDiffusion: {
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    notification: {
      create: jest.fn(),
    },
  });

  it('blocks approval to n8n when property is PAUSADO or lacks public image URLs', async () => {
    const prisma = makeMockPrisma();
    prisma.socialDiffusion.findUnique.mockResolvedValue({
      id: 'diff-1',
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

    const service = new DiffusionsService(prisma as any);
    await expect(
      service.approveDiffusion('revisor-1', 'diff-1'),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.socialDiffusion.update).not.toHaveBeenCalled();
  });

  it('dispatches approved diffusion to n8n with rounded privacy coordinates and X-Webhook-Secret', async () => {
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
      status: 'PENDIENTE',
      postText: 'Depto en Sopocachi',
      fbPostId: null,
      igMediaId: null,
      order: { status: 'PAGADA' },
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

    const service = new DiffusionsService(prisma as any);
    await service.approveDiffusion('revisor-1', 'diff-2', {
      internalNotes: 'Fotos verificadas, listo para publicar',
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, fetchOpts] = mockFetch.mock.calls[0];
    expect(calledUrl).toBe('http://n8n:5678/webhook/difusion-inmueble');
    expect(fetchOpts.headers['X-Webhook-Secret']).toBe('secret-n8n-xyz');

    const sentBody = JSON.parse(fetchOpts.body);
    // Coordenadas redondeadas a 3 decimales para privacidad
    expect(sentBody.latitud_aprox).toBe(-16.512);
    expect(sentBody.longitud_aprox).toBe(-68.127);
    expect(sentBody.callback_url).toBe(
      'http://backend:3000/webhooks/n8n/diffusion',
    );
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

    const service = new DiffusionsService(prisma as any);
    await service.rejectDiffusion('revisor-1', 'diff-3', {
      reason: 'Fotos oscuras y borrosas',
      internalNotes: 'Pedir fotos de día',
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
  });
});
