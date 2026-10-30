import { FulfillmentService } from './fulfillment.service';

describe('FulfillmentService', () => {
  const createMockPrisma = (overrides: Record<string, any> = {}) => {
    const tx: any = {
      order: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      payment: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      subscription: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn(),
        upsert: jest.fn(),
      },
      user: {
        update: jest.fn(),
      },
      property: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
        update: jest.fn(),
      },
      propertyBoost: {
        create: jest.fn(),
      },
      socialDiffusion: {
        create: jest.fn(),
      },
      propertyVerification: {
        create: jest.fn().mockResolvedValue({ id: 'verif-1' }),
      },
      notification: {
        create: jest.fn(),
      },
      ...overrides,
    };

    return {
      tx,
      prisma: {
        $transaction: jest.fn((cb) => cb(tx)),
      } as any,
    };
  };

  it('is idempotent when order is already PAGADA', async () => {
    const { prisma, tx } = createMockPrisma();
    tx.order.findUnique.mockResolvedValue({
      id: 'ord-1',
      status: 'PAGADA',
      amountBs: 49,
    });

    const service = new FulfillmentService(prisma);
    const res = await service.confirmPaymentFromGateway({
      idempotencyKey: 'ORD-SUB-1',
      amountPaid: 49,
      rawPayload: {},
    });

    expect(res).toEqual({
      found: true,
      alreadyProcessed: true,
      orderId: 'ord-1',
    });
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('marks order as EN_REVISION without activating when amountPaid differs from order.amountBs', async () => {
    const { prisma, tx } = createMockPrisma();
    tx.order.findUnique.mockResolvedValue({
      id: 'ord-2',
      userId: 'user-1',
      status: 'PENDIENTE_PAGO',
      type: 'SUSCRIPCION',
      amountBs: 149,
      plan: { id: 'plan-agente', name: 'Plan Agente', code: 'AGENTE' },
      user: { id: 'user-1', customMaxProperties: null },
    });

    const service = new FulfillmentService(prisma);
    const res = await service.confirmPaymentFromGateway({
      idempotencyKey: 'ORD-SUB-2',
      amountPaid: 49, // Pagó menos de lo esperado
      rawPayload: { test: true },
    });

    expect(res.status).toBe('EN_REVISION');
    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: 'ord-2' },
      data: { status: 'EN_REVISION' },
    });
    expect(tx.subscription.upsert).not.toHaveBeenCalled();
  });

  it('activates PAQUETE_DESTACADO_REDES extending existing featuredUntil and queuing diffusion', async () => {
    const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const { prisma, tx } = createMockPrisma();
    tx.order.findUnique.mockResolvedValue({
      id: 'ord-3',
      userId: 'user-1',
      status: 'PENDIENTE_PAGO',
      type: 'PRODUCTO',
      amountBs: 69,
      propertyId: 'prop-1',
      product: {
        id: 'prd-pack',
        code: 'PAQUETE_DESTACADO_REDES',
        name: 'Paquete Destacado + Redes',
        featuredDays: 15,
        includesDiffusion: true,
        includesVerification: false,
      },
      property: {
        id: 'prop-1',
        title: 'Depto en Sopocachi',
        listingType: 'ANTICRETICO',
        propertyType: 'DEPARTAMENTO',
        price: 25000,
        currency: 'USD',
        city: 'La Paz',
        zone: 'Sopocachi',
        bedrooms: 2,
        description: 'Hermoso departamento soleado',
        featuredUntil: futureDate,
      },
      user: { id: 'user-1' },
    });

    const service = new FulfillmentService(prisma);
    const res = await service.confirmPaymentFromGateway({
      idempotencyKey: 'ORD-PRD-3',
      externalReference: 'BANK-999',
      amountPaid: 69,
      rawPayload: {},
    });

    expect(res.status).toBe('PAGADA');
    expect(tx.propertyBoost.create).toHaveBeenCalledTimes(1);
    const boostArgs = tx.propertyBoost.create.mock.calls[0][0].data;
    // Se extiende desde futureDate (+15 días), no desde hoy
    expect(boostArgs.startDate).toEqual(futureDate);
    expect(boostArgs.endDate.getTime()).toBe(
      futureDate.getTime() + 15 * 24 * 60 * 60 * 1000,
    );
    expect(tx.socialDiffusion.create).toHaveBeenCalledTimes(1);
  });
});
