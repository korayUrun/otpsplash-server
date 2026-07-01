import { PrismaClient, Role } from '@prisma/client';
import { Argon2PasswordService } from '@modules/auth/password.service';

const prisma = new PrismaClient();
const passwordService = new Argon2PasswordService();

const DEMO_PROJECT_NAME = 'Demo Project';

/**
 * Geliştirme/mobil test için ortak parola.
 * Parola politikasını karşılar: min 8 karakter, ≥1 büyük harf, ≥1 rakam.
 */
const TEST_PASSWORD = 'Test1234';

/** Üç rolü de kapsayan sabit test hesapları (mobil login/signup denemeleri için). */
const TEST_USERS: ReadonlyArray<{ email: string; name: string; role: Role }> = [
  { email: 'admin@otpsplash.dev', name: 'Admin Kullanıcı', role: Role.ADMIN },
  { email: 'developer@otpsplash.dev', name: 'Developer Kullanıcı', role: Role.DEVELOPER },
  { email: 'receiver@otpsplash.dev', name: 'Receiver Kullanıcı', role: Role.RECEIVER },
];

/**
 * Geliştirme için idempotent seed.
 * - Demo proje (Project.name unique olmadığından findFirst + create ile idempotent).
 * - Üç rol için sabit test kullanıcısı (argon2id hash'li). Kullanıcı zaten varsa dokunulmaz
 *   (upsert.update boş) — mevcut parolalar korunur, tekrar çalıştırmak güvenlidir.
 */
async function main(): Promise<void> {
  const existing = await prisma.project.findFirst({
    where: { name: DEMO_PROJECT_NAME },
  });
  const project =
    existing ?? (await prisma.project.create({ data: { name: DEMO_PROJECT_NAME } }));

  const hashed = await passwordService.hash(TEST_PASSWORD);

  for (const { email, name, role } of TEST_USERS) {
    await prisma.user.upsert({
      where: { email },
      update: { name }, // parolaya dokunma; sadece görünen adı senkronla — idempotent
      create: { email, name, password: hashed, role, projectId: project.id },
    });
  }

  // eslint-disable-next-line no-console
  console.log(
    [
      'Seed tamam.',
      `  Demo proje id : ${project.id}   (mobil signup'ta projectId olarak kullan)`,
      `  Test parolası : ${TEST_PASSWORD}   (üç hesap için de aynı)`,
      ...TEST_USERS.map((u) => `  ${u.role.padEnd(9)} : ${u.email}`),
    ].join('\n'),
  );
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
