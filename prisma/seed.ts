import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import * as bcrypt from 'bcryptjs';

const adapter = new PrismaMariaDb(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter });

async function main() {
  // 1. Seed Plans
  const plansData = [
    {
      code: 'GRATIS',
      name: 'Plan Gratis',
      description: 'Ideal para publicar tu primer inmueble sin costo.',
      monthlyPriceBs: 0,
      maxActiveProperties: 1,
      maxImagesPerProperty: 3,
      includesStats: false,
      includesLogo: false,
      isActive: true,
    },
    {
      code: 'PROPIETARIO',
      name: 'Plan Propietario',
      description: 'Para propietarios con varios inmuebles en alquiler, venta o anticrético.',
      monthlyPriceBs: 49,
      maxActiveProperties: 5,
      maxImagesPerProperty: 8,
      includesStats: false,
      includesLogo: false,
      isActive: true,
    },
    {
      code: 'AGENTE',
      name: 'Plan Agente / Inmobiliaria',
      description: 'Publicaciones ilimitadas, logo de marca en anuncios y panel de estadísticas.',
      monthlyPriceBs: 149,
      maxActiveProperties: null,
      maxImagesPerProperty: 15,
      includesStats: true,
      includesLogo: true,
      isActive: true,
    },
  ];

  const plansByCode: Record<string, { id: string }> = {};
  for (const plan of plansData) {
    const saved = await prisma.plan.upsert({
      where: { code: plan.code },
      update: {
        name: plan.name,
        description: plan.description,
        monthlyPriceBs: plan.monthlyPriceBs,
        maxActiveProperties: plan.maxActiveProperties,
        maxImagesPerProperty: plan.maxImagesPerProperty,
        includesStats: plan.includesStats,
        includesLogo: plan.includesLogo,
      },
      create: plan,
    });
    plansByCode[plan.code] = saved;
  }
  console.log('Plans seeded:', Object.keys(plansByCode));

  // 2. Seed Products
  const productsData = [
    {
      code: 'DESTACADO_7',
      name: 'Destacado en el mapa (7 días)',
      description: 'Pin resaltado por encima del resto y prioridad en listados durante 7 días.',
      priceBs: 25,
      featuredDays: 7,
      includesDiffusion: false,
      includesVerification: false,
      isActive: true,
    },
    {
      code: 'DESTACADO_15',
      name: 'Destacado en el mapa (15 días)',
      description: 'Pin resaltado por encima del resto y prioridad en listados durante 15 días.',
      priceBs: 45,
      featuredDays: 15,
      includesDiffusion: false,
      includesVerification: false,
      isActive: true,
    },
    {
      code: 'DIFUSION_REDES',
      name: 'Difusión en Facebook e Instagram',
      description: 'Publicación profesional de tu inmueble en nuestras redes sociales oficiales.',
      priceBs: 35,
      featuredDays: null,
      includesDiffusion: true,
      includesVerification: false,
      isActive: true,
    },
    {
      code: 'PAQUETE_DESTACADO_REDES',
      name: 'Paquete Destacado 15 días + Redes Sociales',
      description: 'Combina 15 días de pin destacado en el mapa con difusión en Facebook e Instagram.',
      priceBs: 69,
      featuredDays: 15,
      includesDiffusion: true,
      includesVerification: false,
      isActive: true,
    },
    {
      code: 'VERIFICACION',
      name: 'Inmueble Verificado',
      description: 'Revisión documental para obtener el sello oficial de Inmueble Verificado.',
      priceBs: 120,
      featuredDays: null,
      includesDiffusion: false,
      includesVerification: true,
      isActive: true,
    },
  ];

  for (const product of productsData) {
    await prisma.product.upsert({
      where: { code: product.code },
      update: {
        name: product.name,
        description: product.description,
        priceBs: product.priceBs,
        featuredDays: product.featuredDays,
        includesDiffusion: product.includesDiffusion,
        includesVerification: product.includesVerification,
      },
      create: product,
    });
  }
  console.log('Products seeded:', productsData.map((p) => p.code));

  // 3. Seed Admin user
  const adminPhone = '73591909';
  const adminPassword = 'Xndre$99';
  const adminName = 'RatelApps';

  const hashedPassword = await bcrypt.hash(adminPassword, 10);

  const admin = await prisma.user.upsert({
    where: { phone: adminPhone },
    update: {
      password: hashedPassword,
      name: adminName,
      role: 'ADMIN',
      currentPlanId: plansByCode['AGENTE'].id,
    },
    create: {
      phone: adminPhone,
      password: hashedPassword,
      name: adminName,
      role: 'ADMIN',
      currentPlanId: plansByCode['AGENTE'].id,
    },
  });

  console.log('Admin user seeded:', {
    id: admin.id,
    phone: admin.phone,
    name: admin.name,
    role: admin.role,
  });

  // 4. Migrate legacy users without currentPlanId
  await prisma.user.updateMany({
    where: { role: 'INMOBILIARIA', currentPlanId: null },
    data: {
      role: 'USER',
      accountType: 'INMOBILIARIA',
      currentPlanId: plansByCode['PROPIETARIO'].id,
    },
  });

  await prisma.user.updateMany({
    where: { role: 'GRATIS', currentPlanId: null },
    data: {
      role: 'USER',
      accountType: 'PARTICULAR',
      currentPlanId: plansByCode['GRATIS'].id,
    },
  });

  await prisma.user.updateMany({
    where: { currentPlanId: null },
    data: {
      currentPlanId: plansByCode['GRATIS'].id,
    },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
