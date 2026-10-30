import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogService } from '../catalog/catalog.service';

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: {} },
        { provide: CatalogService, useValue: {} },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('computes Monday 00:00:00 to Sunday 23:59:59.999 in Bolivia time (UTC-4)', () => {
    // Viernes 30 Oct 2026 11:28:19 -04:00 (15:28:19Z)
    const sampleDate = new Date('2026-10-30T15:28:19.000Z');
    const { weekStart, weekEnd } = service.getCurrentBoliviaWeekBounds(sampleDate);

    // Lunes 26 Oct 2026 00:00:00 -04:00 = 04:00:00.000Z
    expect(weekStart.toISOString()).toBe('2026-10-26T04:00:00.000Z');
    // Domingo 1 Nov 2026 23:59:59.999 -04:00 = Lunes 2 Nov 03:59:59.999Z
    expect(weekEnd.toISOString()).toBe('2026-11-02T03:59:59.999Z');
  });
});
