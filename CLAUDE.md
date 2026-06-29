# OTPsplash Server — Claude Code Specification

> Her oturumda bu dosyayı önce oku. Faz tamamlanma kriterlerini geçmeden sonraki faza geçme.

---

## Rol

Kıdemli backend mühendisi. Stripe/Google kalitesinde kod yaz.

---

## Proje

**OTPsplash** — Test hesaplarına gelen SMS OTP'lerini developer'a sıfır müdahaleyle iletir.

```
SMS gelir (Android: otomatik | iOS: Shortcuts)
  → POST /api/otp
    → JWT doğrula → parse → AES-256-GCM şifrele → DB kaydet
      → Socket.IO emit → project:${projectId} odası → X'in ekranı
```

**Kullanıcı rolleri:** RECEIVER (OTP gönderir) | DEVELOPER (OTP alır) | ADMIN (yönetir)
**Proje izolasyonu:** Banka OTP'si → sadece banka developer'larına. Her proje ayrı oda.

---

## Tech Stack

| Katman | Teknoloji | Karar Notu |
|--------|-----------|------------|
| Runtime | Node.js 20 LTS | — |
| Dil | TypeScript 5+ strict | `any` yasak |
| Framework | Express.js | — |
| Gerçek zamanlı | Socket.IO 4 | In-memory, adapter-ready |
| ORM | Prisma 5 | — |
| Veritabanı | PostgreSQL 15 | — |
| Auth | jsonwebtoken | access 15dk / refresh 30gün |
| Parola | **argon2id** | bcryptjs değil — OWASP 2024, C++ binding, 3-5x hızlı |
| Validation | Zod | Her endpointte zorunlu |
| Şifreleme | Node.js crypto | AES-256-GCM, native |
| Logging | pino | JSON structured, redact zorunlu |
| Rate limiting | express-rate-limit | In-memory yeterli |
| Cron | node-cron | TTL cleanup |
| Test | Jest + Supertest | Unit + integration |
| Güvenlik | helmet + cors | — |

---

## Mimari Kurallar

### SOLID
- **SRP:** Controller sadece HTTP katmanı. İş mantığı service'te, DB işlemi repository'de.
- **OCP:** Yeni OTP kaynağı (kayıt tipi) eklemek = yeni class, mevcut koda dokunma.
- **LSP:** Tüm interface implementasyonları birbirinin yerine geçebilmeli.
- **ISP:** `IOtpParser`, `IOtpEncryptor`, `IOtpRepository`, `IOtpNotifier` — tek büyük interface yok.
- **DIP:** Service'ler concrete class'a değil interface'e bağımlı. Constructor injection zorunlu.

### Temiz Kod
- Magic string/number yok — her şey `CONSTANTS` veya enum.
- Public fonksiyonlara JSDoc yaz.
- `try/catch` boş bırakılmaz.
- `console.log` ile hata yönetimi yapma — pino kullan.

### Asenkron / Senkron Kuralları
```
SYNC olmalı:
  ✓ OTP regex parse        (CPU, I/O yok)
  ✓ AES-256-GCM encrypt/decrypt  (crypto sync API)
  ✓ JWT sign/verify        (hızlı, QA iç aracı için yeterli — bottleneck görülürse async'e geç)
  ✓ Config/env okuma       (startup)

ASYNC olmalı:
  ✓ Her Prisma işlemi      (I/O)
  ✓ argon2 hash/verify     (CPU-intensive, event loop'u bloklar)
  ✓ Socket.IO emit         (I/O)

YASAK:
  ❌ argon2.hashSync() / bcrypt.hashSync()
  ❌ crypto.pbkdf2Sync()
  ❌ fs.readFileSync() (startup dışında)
```

### Hata Mimarisi
- `AppError` abstract base → tüm hatalar buradan türer.
- Her hata: `statusCode`, `errorCode` (enum), `isOperational` (true=beklenen, false=bug).
- Controller'da `next(error)` ile global handler'a ilet — exception sızdırma.
- `Result<T>` pattern: `{ success: true, data }` | `{ success: false, error }`.
- Stack trace asla client'a sızdırılmaz.

### Logging
- pino redact: `['body.password', 'body.code', 'body.smsText', 'headers.authorization']`
- Her request'e UUID (`req.id`) ekle, her response'da dön.
- Log seviyesi production'da `info`.

### Socket.IO Scaling Notu
Şu an in-memory — 5-10 kullanıcı için yeterli. Yatay büyüme gerekirse:
`io.adapter(createAdapter(pubClient, subClient))` — 1 satır, geri kalan kod değişmez.

---

## Klasör Yapısı

```
src/
├── index.ts                  → Entry, process handlers, graceful shutdown
├── app.ts                    → Express + Socket.IO factory
├── config/
│   ├── env.ts                → Zod env parse — fail-fast
│   ├── constants.ts          → CONSTANTS (OTP, ARGON2, SOCKET, PAGINATION, RATE_LIMIT)
│   └── prisma.ts             → Singleton
├── errors/
│   ├── AppError.ts           → Abstract base
│   ├── errors.ts             → ValidationError, AuthenticationError, AuthorizationError,
│   │                           NotFoundError, ConflictError, OtpParseError,
│   │                           OtpEncryptionError, InternalError
│   └── ErrorCode.ts          → Enum (VALIDATION_ERROR, AUTHENTICATION_FAILED,
│                               TOKEN_EXPIRED, TOKEN_INVALID, FORBIDDEN, NOT_FOUND,
│                               CONFLICT, USER_NOT_FOUND, PROJECT_NOT_FOUND,
│                               OTP_NOT_FOUND, OTP_DELIVERY_FAILED,
│                               OTP_ENCRYPTION_FAILED, INTERNAL_ERROR,
│                               DATABASE_ERROR, RATE_LIMIT_EXCEEDED)
├── types/
│   ├── Result.ts             → Result<T>, ok(), fail()
│   ├── express.d.ts          → Request augmentation: id, user
│   └── index.ts              → JwtPayload, PaginationOptions, PaginatedResult
├── infrastructure/
│   ├── logger.ts             → pino singleton, ILogger interface
│   └── socket.ts             → Socket.IO singleton, initSocket(), emitOtp()
├── middleware/
│   ├── requestId.ts          → UUID per request
│   ├── authenticate.ts       → JWT doğrulama
│   ├── authorize.ts          → Rol kontrolü: authorize(...roles)
│   ├── validate.ts           → Generic Zod middleware
│   ├── rateLimiter.ts        → otpRateLimit, loginRateLimit, registerRateLimit
│   ├── requestLogger.ts      → method, path, status, responseTime, requestId
│   └── errorHandler.ts       → Global error handler
├── modules/
│   ├── auth/
│   │   ├── auth.interfaces.ts    → IPasswordService, ITokenService, IAuthService, DTO'lar
│   │   ├── password.service.ts   → argon2id hash/verify (async)
│   │   ├── token.service.ts      → JWT sign/verify (sync)
│   │   ├── auth.service.ts       → register, login, refresh, logout
│   │   ├── auth.controller.ts    → HTTP katmanı
│   │   ├── auth.routes.ts        → Route tanımları
│   │   └── auth.schemas.ts       → Zod şemaları
│   ├── otp/
│   │   ├── otp.interfaces.ts     → IOtpParser, IOtpEncryptor, IOtpRepository,
│   │   │                           IOtpNotifier, IOtpService, DTO'lar
│   │   ├── otp.parser.ts         → extract(smsText): string|null — SYNC
│   │   ├── otp.encryptor.ts      → AES-256-GCM encrypt/decrypt — SYNC
│   │   ├── otp.repository.ts     → Prisma CRUD — ASYNC
│   │   ├── otp.service.ts        → processAndDeliver, getHistory
│   │   ├── otp.controller.ts     → HTTP katmanı
│   │   ├── otp.routes.ts         → Route tanımları
│   │   └── otp.schemas.ts        → Zod şemaları
│   └── project/
│       ├── project.interfaces.ts → IProjectService, IProjectRepository, DTO'lar
│       ├── project.repository.ts → Prisma CRUD — ASYNC
│       ├── project.service.ts    → create, getById, addUser, removeUser
│       ├── project.controller.ts → HTTP katmanı
│       ├── project.routes.ts     → Route tanımları
│       └── project.schemas.ts    → Zod şemaları
├── jobs/
│   └── cleanup.job.ts        → node-cron, her gün UTC 02:00, hata uygulamayı durdurmamalı
└── routes/
    └── index.ts              → Tüm modül route'larını birleştir
```

---

## Veritabanı Şeması

```prisma
model User {
  id        String   @id @default(uuid()) @db.Uuid
  email     String   @unique @db.VarChar(255)
  password  String   @db.VarChar(512)
  role      Role
  projectId String   @db.Uuid
  project   Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@index([email])
  @@index([projectId])
  @@map("users")
}

model Project {
  id        String   @id @default(uuid()) @db.Uuid
  name      String   @db.VarChar(100)
  apiKey    String   @unique @default(uuid()) @db.Uuid
  users     User[]
  otpLogs   OTPLog[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@map("projects")
}

model OTPLog {
  id            String   @id @default(uuid()) @db.Uuid
  encryptedCode String   @db.VarChar(512)  // iv:authTag:ciphertext (base64)
  source        Source
  projectId     String   @db.Uuid
  project       Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  createdAt     DateTime @default(now())
  expiresAt     DateTime
  @@index([projectId])
  @@index([expiresAt])
  @@map("otp_logs")
}

enum Role   { RECEIVER DEVELOPER ADMIN }
enum Source { ANDROID IOS_SHORTCUT }
```

---

## API Kontratı

### Yanıt Formatı
```
Başarılı:  { success: true,  data: T,                        requestId: string }
Hata:      { success: false, error: { code, message },       requestId: string }
Paginated: { success: true,  data: T[], pagination: {...},   requestId: string }
```

### Endpointler
```
POST /api/auth/register       → 201 { accessToken, refreshToken, user }
POST /api/auth/login          → 200 { accessToken, refreshToken, user }
POST /api/auth/refresh        → 200 { accessToken }
POST /api/auth/logout         → 200 { message }

POST /api/otp                 → 200 { message, deliveredTo }   [RECEIVER]
GET  /api/otp/history         → 200 paginated OTPLog[]         [DEVELOPER]

POST   /api/projects               → 201 Project               [ADMIN]
GET    /api/projects/:id           → 200 Project + users       [üye]
POST   /api/projects/:id/users     → 200                       [ADMIN]
DELETE /api/projects/:id/users/:uid→ 200                       [ADMIN]

GET /health                   → 200 { status: 'ok', timestamp }
```

---

## Güvenlik Kuralları

1. **JWT** — access: 15dk, refresh: 30gün. İki secret FARKLI olmalı.
2. **Parola** — argon2id: `{ memoryCost: 65536, timeCost: 3, parallelism: 4 }`. Plain text asla loglama.
3. **AES-256-GCM** — Her encrypt için `crypto.randomBytes(16)` IV. Format: `base64(iv):base64(authTag):base64(ciphertext)`. Decrypt'te her bileşeni parse et, boyut doğrula (IV=16 byte, authTag=16 byte), `decipher.final()` try/catch zorunlu — hata → OtpEncryptionError.
4. **Rate limiting** — `/api/otp`: 60/dk | `/api/auth/login`: 10/dk | `/api/auth/register`: 5/dk.
5. **HTTP** — `helmet()`, `express.json({ limit: '10kb' })`, CORS whitelist.
6. **Loglama** — Parola, OTP kodu, JWT token asla loglanmaz (pino redact).

---

## Environment Variables

```env
NODE_ENV=development
PORT=3000
LOG_LEVEL=info
DATABASE_URL=postgresql://user:pass@localhost:5432/otpsplash
JWT_ACCESS_SECRET=          # min 32 karakter
JWT_REFRESH_SECRET=         # min 32 karakter, ACCESS'ten FARKLI
JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=30d
OTP_ENCRYPTION_KEY=         # 64 hex karakter (32 byte) — node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
OTP_TTL_DAYS=7
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=60
```

---

# FAZLAR

---

## FAZ 1 — İskelet ve Altyapı

**Hedef:** Proje çalışır, DB bağlanır, health check döner.

**Yapılacaklar:**
- `docker-compose.yml` — postgres:15-alpine, healthcheck ile
- `docker-compose.test.yml` — ayrı DB, port 5433
- `package.json` — scripts: dev, build, start, test, test:unit, test:integration, test:coverage, db:migrate, db:generate, db:seed, lint, typecheck
- `tsconfig.json` — strict, noUncheckedIndexedAccess, noImplicitReturns, path aliases (@modules, @config, @errors, @middleware, @infrastructure, @types, @jobs)
- `src/config/env.ts` — Zod parse, eksik değişkende `process.exit(1)` + açıklayıcı hata
- `src/config/constants.ts` — CONSTANTS.OTP, ARGON2, SOCKET, PAGINATION, RATE_LIMIT
- `src/config/prisma.ts` — Singleton, globalThis pattern (hot reload güvenli)
- `src/infrastructure/logger.ts` — pino, ILogger interface, redact konfigürasyonu
- `src/app.ts` — Express + Socket.IO factory, `{ app, httpServer, io }` döndür
- `src/index.ts` — bootstrap: DB connect → listen → cron start. `process.on('SIGTERM'/'SIGINT'/'unhandledRejection'/'uncaughtException')` ile graceful shutdown
- `prisma/schema.prisma` — yukarıdaki şema
- `npx prisma migrate dev --name init`

**Tamamlanma Kriterleri:**
- [ ] `docker-compose up` → PostgreSQL sağlıklı başlar
- [ ] `npm run dev` → server başlar
- [ ] `GET /health` → `{ status: 'ok', timestamp }`
- [ ] `npm run typecheck` → sıfır hata
- [ ] Eksik env → `process.exit(1)`, hangi değişken eksik açıkça yazar
- [ ] SIGTERM → graceful shutdown, DB bağlantısı kapatılır

---

## FAZ 2 — Auth Sistemi

**Hedef:** Register, login, refresh tam çalışır. Middleware'ler hazır.

**Yapılacaklar:**

`src/errors/` — AppError (abstract), errors.ts (tüm sınıflar), ErrorCode.ts (enum)

`src/types/` — Result.ts (`ok()`, `fail()`), express.d.ts (req.id, req.user), index.ts (JwtPayload vb.)

`src/middleware/` — requestId, authenticate, authorize, validate, rateLimiter, requestLogger, errorHandler

`src/modules/auth/`:
- **interfaces.ts** — IPasswordService, ITokenService, IAuthService, tüm DTO'lar
- **password.service.ts** — argon2id, `hash()` ve `verify()` async. `argon2.verify()` exception'ı yakala → AuthenticationError
- **token.service.ts** — jwt.sign/verify sync. TokenExpiredError → AuthenticationError (code: TOKEN_EXPIRED). JsonWebTokenError → AuthenticationError (code: TOKEN_INVALID)
- **auth.service.ts** — register: email çakışması → ConflictError, proje yok → NotFoundError. login: user yoksa veya şifre yanlışsa aynı hata (bilgi sızdırma yok). refresh: token doğrula → user DB'de hâlâ var mı kontrol et
- **auth.controller.ts** — Result unwrap → next(error) veya res.json
- **auth.routes.ts** — rate limit + validate + controller
- **auth.schemas.ts** — şifre: min 8, en az 1 büyük harf, en az 1 rakam

**Tamamlanma Kriterleri:**
- [ ] `npm run test:unit` → token ve password servisleri geçer
- [ ] `npm run test:integration` → tüm auth testleri geçer
- [ ] argon2 async — sync versiyonu yok
- [ ] Yanlış şifre ve olmayan email → aynı 401 (AUTHENTICATION_FAILED)
- [ ] requestId her response'da var
- [ ] Login rate limit 10/dk aşılınca 429

**Unit test kapsamı** (`tests/unit/token.service.test.ts`):
- generateAccessToken → geçerli JWT
- verifyAccessToken → doğru payload
- Süresi dolmuş → AuthenticationError (TOKEN_EXPIRED)
- Geçersiz imza → AuthenticationError (TOKEN_INVALID)

**Integration test kapsamı** (`tests/integration/auth.test.ts`):
- register: 201, 400 (zayıf şifre), 404 (proje yok), 409 (email çakışma)
- login: 200, 401 (yanlış şifre), 401 (olmayan email)
- refresh: 200, 401 (geçersiz), 401 (süresi dolmuş)
- logout: 200, 401 (token yok)

---

## FAZ 3 — OTP Core

**Hedef:** OTP gelir → parse → şifrele → DB → Socket emit.

**Yapılacaklar:**

`src/infrastructure/socket.ts`:
- Singleton initSocket() + emitOtp()
- Bağlantıda JWT doğrula (middleware olarak)
- DEVELOPER rolü → `project:${projectId}` odasına katıl
- RECEIVER → odaya katılmaz
- Scaling notu: adapter geçişi için hazır, kod değişmez

`src/modules/otp/`:
- **interfaces.ts** — IOtpParser, IOtpEncryptor, IOtpRepository, IOtpNotifier, IOtpService, DTO'lar
- **otp.parser.ts** — `extract(smsText)` SYNC. SMS'de birden fazla 6 haneli sayı varsa sonuncuyu al. `validate(code)` SYNC
- **otp.encryptor.ts** — AES-256-GCM, tam olarak güvenlik kuralları bölümündeki spec'i uygula. Decrypt'te her adımda validasyon, `decipher.final()` try/catch → OtpEncryptionError
- **otp.repository.ts** — `save()`, `findByProject()` (expiresAt > now, Promise.all ile count+findMany), `deleteExpired()` — hepsi ASYNC
- **otp.service.ts**:
  - `processAndDeliver`: parse (SYNC) → validate → encrypt (SYNC) → DB kaydet (AWAIT) → emit (SYNC). DB hata → fail dön, emit yapma
  - `getHistory`: findByProject (AWAIT) → decrypt (SYNC, map içinde) → ok(paginated)
- **otp.controller.ts**, **otp.routes.ts**, **otp.schemas.ts**

`POST /api/otp` body: `{ smsText?: string, code?: string, source: 'ANDROID'|'IOS_SHORTCUT' }` — ikisinden biri zorunlu

**Tamamlanma Kriterleri:**
- [ ] `npm run test:unit` → parser ve encryptor geçer
- [ ] `npm run test:integration` → tüm otp testleri geçer
- [ ] DB kaydet → Socket emit sırası: DB hata olursa emit yok
- [ ] DB'de encryptedCode hiçbir zaman plain text değil
- [ ] Socket auth: token olmadan bağlantı reddedilir
- [ ] Süresi dolmuş OTP history'de gelmiyor
- [ ] Rate limit aşılınca 429

**Unit test kapsamı** (`tests/unit/otp.parser.test.ts`, `otp.encryptor.test.ts`):
- parser: "Kodunuz: 847291" → "847291", 7 haneli → null, boş → null, birden fazla 6 haneli → doğrusu
- encryptor: encrypt → decrypt → orijinal, her encrypt farklı ciphertext (IV randomness), bozuk ciphertext → OtpEncryptionError, yanlış authTag → OtpEncryptionError

**Integration test kapsamı** (`tests/integration/otp.test.ts`):
- RECEIVER + smsText → 200
- RECEIVER + code → 200
- DEVELOPER → 403
- Token yok → 401
- OTP içermeyen smsText → 422 (OTP_NOT_FOUND)
- Rate limit → 429
- DB'de şifreli saklanıyor
- History: DEVELOPER → 200, RECEIVER → 403, süresi dolmuş gelmiyor

---

## FAZ 4 — Proje Yönetimi ve Tamamlayıcılar

**Hedef:** Proje CRUD, cleanup cron, graceful shutdown.

**Yapılacaklar:**

`src/modules/project/` — interfaces, repository, service, controller, routes, schemas

- **project.service.ts**: getById → kullanıcı projeye ait mi kontrol et (AuthorizationError). addUser → zaten projede mi (ConflictError). Tüm DB işlemleri ASYNC
- **cleanup.job.ts** — `cron.schedule('0 2 * * *', ...)` UTC. Job hatası `try/catch` ile yakalanır, sadece loglanır — uygulamayı durdurmamalı

**Tamamlanma Kriterleri:**
- [ ] Proje CRUD çalışır
- [ ] Cleanup job başlar, hata → log, uygulama çalışmaya devam eder
- [ ] `npm run test:integration` → tüm project testleri geçer

**Integration test kapsamı** (`tests/integration/project.test.ts`):
- createProject: ADMIN → 201, DEVELOPER → 403
- getProject: üye → 200, başka proje → 403, olmayan → 404
- addUser: 200, olmayan user → 404, zaten projede → 409
- removeUser: 200, projede yok → 404

---

## FAZ 5 — Test Coverage ve Deploy

**Hedef:** %80+ coverage, Docker image, production-ready.

**Yapılacaklar:**

`tests/setup.ts` — beforeEach: OTPLog → User → Project sırasıyla deleteMany (FK sırası)
`tests/helpers/fixtures.ts` — createTestProject, createTestUser, createTestOtpLog fabrikaları
`tests/helpers/auth.helper.ts` — getReceiverToken, getDeveloperToken, getAdminToken

`jest.config.ts` — ts-jest, path alias mapper, coverageThreshold: 80% (branches, functions, lines, statements)

**Dockerfile (production):**
- Multi-stage: builder (npm ci + prisma generate + tsc) → runner (non-root user, production deps)

**Dockerfile.dev:** — nodemon + ts-node

**Production Checklist:**
- [ ] NODE_ENV=production
- [ ] JWT secret'lar `crypto.randomBytes(64).toString('hex')` ile üretildi
- [ ] OTP_ENCRYPTION_KEY `crypto.randomBytes(32).toString('hex')` ile üretildi
- [ ] .env → .gitignore
- [ ] `npm audit --audit-level=high` → temiz
- [ ] `npm run typecheck` → sıfır hata
- [ ] `npm run test:coverage` → %80+
- [ ] `docker build` → başarılı, non-root user
- [ ] CORS origin wildelist ayarlı
- [ ] `npx prisma migrate deploy` (migrate dev değil)

**Tamamlanma Kriterleri:**
- [ ] `npm run test:coverage` → global %80+
- [ ] `npm run build` → sıfır TypeScript hatası
- [ ] Docker image non-root user ile çalışıyor

---

## Notlar

- Redis yok. 5-10 kullanıcı için PostgreSQL + in-memory Socket.IO yeterli.
- Socket.IO adapter geçişi: `io.adapter(createAdapter(pub, sub))` — 1 satır, geri kalan değişmez.
- JWT verify sync — QA iç aracı için bottleneck değil. Profiling'de sorun görülürse async'e geç.
- Mobil: `otpsplash-mobile` — ayrı repo, React Native + TypeScript.
- İleride: Redis adapter, argon2 rehash, refresh token blacklist, key rotation.