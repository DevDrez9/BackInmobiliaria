import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import * as bcrypt from 'bcryptjs';

const adapter = new PrismaMariaDb(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter });

async function main() {
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
    },
    create: {
      phone: adminPhone,
      password: hashedPassword,
      name: adminName,
      role: 'ADMIN',
    },
  });

  console.log('Admin user seeded:', {
    id: admin.id,
    phone: admin.phone,
    name: admin.name,
    role: admin.role,
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
