import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEMO_PROJECT_NAME = 'Demo Project';

/**
 * Geliştirme için minimal seed.
 * FAZ 1: yalnızca demo proje. Kullanıcılar argon2 hash gerektirir (FAZ 2'de eklenir).
 * Project.name unique olmadığı için findFirst + create ile idempotent tutulur.
 */
async function main(): Promise<void> {
  const existing = await prisma.project.findFirst({
    where: { name: DEMO_PROJECT_NAME },
  });

  const project =
    existing ?? (await prisma.project.create({ data: { name: DEMO_PROJECT_NAME } }));

  // eslint-disable-next-line no-console
  console.log(`Seed tamam — demo proje: ${project.id}`);
}

main()
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error('Seed başarısız:', error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
