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
  → POST /api/otp (X-Device-Secret header ile)
    → Device doğrula → parse → AES-256-GCM şifrele → DB kaydet
      → Socket.IO emit → project:${projectId} odası → X'in ekranı
```

**Kullanıcı rolleri:** RECEIVER (OTP gönderir) | DEVELOPER (OTP alır) | ADMIN (yönetir)
**Proje izolasyonu:** Banka OTP'si → sadece banka developer'larına. Her proje ayrı oda.

**İki auth modeli (FAZ 6 sonrası):**
```
Mobil Uygulama (Y açıp kapatıyor, login/dashboard)     → JWT (kullanıcı oturumu)
Android BroadcastReceiver (arka planda sürekli çalışan) → Device Secret (cihaz kimliği)
iOS Shortcut (arka planda sürekli çalışan)              → Device Secret (cihaz kimliği)
X Developer Dashboard                                    → JWT (kullanıcı oturumu)
```

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
| Auth (kullanıcı) | jsonwebtoken | access 15dk / refresh 30gün |
| Auth (cihaz) | Device Secret | 256-bit random, argon2id hash'li, süresiz |
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
  ✓ Device Secret üretimi  (crypto.randomBytes, sync)
  ✓ Config/env okuma       (startup)

ASYNC olmalı:
  ✓ Her Prisma işlemi      (I/O)
  ✓ argon2 hash/verify     (CPU-intensive, event loop'u bloklar — Device Secret hash'leme dahil)
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
- pino redact: `['body.password', 'body.code', 'body.smsText', 'headers.authorization', 'headers.x-device-secret']`
- Her request'e UUID (`req.id`) ekle, her response'da dön.
- Log seviyesi production'da `info`.

### Socket.IO Scaling Notu
Şu an in-memory — 5-10 kullanıcı için yeterli. Yatay büyüme gerekirse:
`io.adapter(createAdapter(pubClient, subClient))` — 1 satır, geri kalan kod değişmez.

### Device Auth Mimari Kararı (FAZ 6)
JWT bir **kullanıcı oturumunu** temsil eder ve kısa ömürlüdür (15dk). Android BroadcastReceiver
ve iOS Shortcut ise **kullanıcı oturumu olmayan, arka planda aylarca sessizce çalışan otomasyonlardır.**
Bu ikisini aynı auth mekanizmasıyla yönetmek mimari hata olur — kısa ömürlü bilet, uzun ömürlü
otomasyona gömülmüş olur.

Çözüm: Device Secret — süresiz, sadece `POST /api/otp` için yetkili, kullanıcı oturumundan bağımsız.

```
JWT          → "Ben Y'yim, oturumum açık"        → mobil uygulamanın kendisi kullanır
Device Secret → "Ben Y'nin şu cihazıyım"          → BroadcastReceiver ve Shortcut kullanır
```

Bu ayrım hem iOS hem Android için geçerlidir — ikisi de "sürekli arka planda çalışan otomasyon"
kategorisine girer, ikisi de aynı `deviceAuth` middleware'ini kullanır.

---

## Klasör Yapısı

```
src/
├── index.ts                  → Entry, process handlers, graceful shutdown
├── app.ts                    → Express + Socket.IO factory
├── config/
│   ├── env.ts                → Zod env parse — fail-fast
│   ├── constants.ts          → CONSTANTS (OTP, ARGON2, SOCKET, PAGINATION, RATE_LIMIT, DEVICE)
│   └── prisma.ts             → Singleton
├── errors/
│   ├── AppError.ts           → Abstract base
│   ├── errors.ts             → ValidationError, AuthenticationError, AuthorizationError,
│   │                           NotFoundError, ConflictError, OtpParseError,
│   │                           OtpEncryptionError, DeviceAuthError, InternalError
│   └── ErrorCode.ts          → Enum (VALIDATION_ERROR, AUTHENTICATION_FAILED,
│                               TOKEN_EXPIRED, TOKEN_INVALID, FORBIDDEN, NOT_FOUND,
│                               CONFLICT, USER_NOT_FOUND, PROJECT_NOT_FOUND,
│                               OTP_NOT_FOUND, OTP_DELIVERY_FAILED,
│                               OTP_ENCRYPTION_FAILED, INTERNAL_ERROR,
│                               DATABASE_ERROR, RATE_LIMIT_EXCEEDED,
│                               DEVICE_NOT_FOUND, DEVICE_REVOKED, DEVICE_SECRET_INVALID)
├── types/
│   ├── Result.ts             → Result<T>, ok(), fail()
│   ├── express.d.ts          → Request augmentation: id, user, device
│   └── index.ts              → JwtPayload, DevicePayload, PaginationOptions, PaginatedResult
├── infrastructure/
│   ├── logger.ts             → pino singleton, ILogger interface
│   └── socket.ts             → Socket.IO singleton, initSocket(), emitOtp()
├── middleware/
│   ├── requestId.ts          → UUID per request
│   ├── authenticate.ts       → JWT doğrulama (kullanıcı oturumu — login/dashboard/history)
│   ├── deviceAuth.ts         → Device Secret doğrulama (POST /api/otp)
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
│   ├── device/
│   │   ├── device.interfaces.ts  → IDeviceService, IDeviceRepository, ISecretService, DTO'lar
│   │   ├── secret.service.ts     → Device Secret üret (sync) + hash/verify (async, argon2id)
│   │   ├── device.repository.ts  → Prisma CRUD — ASYNC
│   │   ├── device.service.ts     → register, verify, revoke
│   │   ├── device.controller.ts  → HTTP katmanı
│   │   ├── device.routes.ts      → Route tanımları
│   │   └── device.schemas.ts     → Zod şemaları
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
  devices   Device[]
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
  devices   Device[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@map("projects")
}

model Device {
  id           String    @id @default(uuid()) @db.Uuid
  secretHash   String    @db.VarChar(512)   // argon2id hash — plain secret asla saklanmaz
  platform     Platform
  userId       String    @db.Uuid
  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  projectId    String    @db.Uuid
  project      Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  isRevoked    Boolean   @default(false)
  lastUsedAt   DateTime?
  createdAt    DateTime  @default(now())
  otpLogs      OTPLog[]
  @@index([userId])
  @@index([projectId])
  @@map("devices")
}

model OTPLog {
  id            String   @id @default(uuid()) @db.Uuid
  encryptedCode String   @db.VarChar(512)  // iv:authTag:ciphertext (base64)
  source        Source
  projectId     String   @db.Uuid
  project       Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  deviceId      String?  @db.Uuid          // hangi cihazdan geldi — izleme/analiz için
  device        Device?  @relation(fields: [deviceId], references: [id], onDelete: SetNull)
  createdAt     DateTime @default(now())
  expiresAt     DateTime
  @@index([projectId])
  @@index([expiresAt])
  @@index([deviceId])
  @@map("otp_logs")
}

enum Role     { RECEIVER DEVELOPER ADMIN }
enum Source   { ANDROID IOS_SHORTCUT }
enum Platform { ANDROID IOS }
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

POST   /api/devices/register  → 201 { deviceId, deviceSecret }   [JWT — RECEIVER]
                                 deviceSecret SADECE bu response'da düz metin döner,
                                 bir daha asla gösterilmez (DB'de hash'li saklanır)
DELETE /api/devices/:id       → 200 { message }                  [JWT — RECEIVER, sahibi]
GET    /api/devices           → 200 Device[] (secretHash hariç)  [JWT — RECEIVER]

POST /api/otp                 → 200 { message, deliveredTo }   [Device Secret — X-Device-Secret header]
GET  /api/otp/history         → 200 paginated OTPLog[]         [JWT — DEVELOPER]

POST   /api/projects               → 201 Project               [JWT — ADMIN]
GET    /api/projects/:id           → 200 Project + users       [JWT — üye]
POST   /api/projects/:id/users     → 200                       [JWT — ADMIN]
DELETE /api/projects/:id/users/:uid→ 200                       [JWT — ADMIN]

GET /health                   → 200 { status: 'ok', timestamp }
```

### POST /api/otp — Header Değişikliği
```
ÖNCE:  Authorization: Bearer <accessToken>
SONRA: X-Device-Secret: <deviceSecret>
```

---

## Güvenlik Kuralları

1. **JWT** — access: 15dk, refresh: 30gün. İki secret FARKLI olmalı. Sadece kullanıcı oturumu (login/dashboard/history) için.
2. **Device Secret** — `crypto.randomBytes(32)` ile üret (256-bit), hex string olarak döndür. DB'de argon2id ile hash'lenir, plain text asla saklanmaz. Süresiz — sadece manuel revoke ile geçersiz olur. Sadece `POST /api/otp` yetkisi var, başka hiçbir endpointe erişemez.
3. **Parola** — argon2id: `{ memoryCost: 65536, timeCost: 3, parallelism: 4 }`. Plain text asla loglama. Aynı parametreler Device Secret hash'leme için de kullanılır.
4. **AES-256-GCM** — Her encrypt için `crypto.randomBytes(16)` IV. Format: `base64(iv):base64(authTag):base64(ciphertext)`. Decrypt'te her bileşeni parse et, boyut doğrula (IV=16 byte, authTag=16 byte), `decipher.final()` try/catch zorunlu — hata → OtpEncryptionError.
5. **Rate limiting** — `/api/otp`: 60/dk | `/api/auth/login`: 10/dk | `/api/auth/register`: 5/dk | `/api/devices/register`: 5/dk.
6. **HTTP** — `helmet()`, `express.json({ limit: '10kb' })`, CORS whitelist.
7. **Loglama** — Parola, OTP kodu, JWT token, Device Secret asla loglanmaz (pino redact).

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
DEVICE_SECRET_BYTES=32      # 256-bit
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

> **Not:** Bu faz tamamlandığında `POST /api/otp` hâlâ JWT ile korunuyordu (eski mimari).
> FAZ 6'da bu endpoint Device Secret'a geçirildi. Aşağıdaki açıklama orijinal haliyle
> korunmuştur — FAZ 6'daki değişiklik notlarına bak.

**Yapılacaklar:**

`src/infrastructure/socket.ts`:
- Singleton initSocket() + emitOtp()
- Bağlantıda JWT doğrula (middleware olarak) — bu değişmedi, dashboard bağlantısı için JWT kalır
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

`tests/setup.ts` — beforeEach: OTPLog → Device → User → Project sırasıyla deleteMany (FK sırası)
`tests/helpers/fixtures.ts` — createTestProject, createTestUser, createTestOtpLog, createTestDevice fabrikaları
`tests/helpers/auth.helper.ts` — getReceiverToken, getDeveloperToken, getAdminToken, getDeviceSecret

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

## FAZ 6 — Device Authentication (JWT'den Ayrıştırma)

**Hedef:** `POST /api/otp` artık JWT yerine Device Secret ile korunur. Android BroadcastReceiver
ve iOS Shortcut süresiz, kullanıcı oturumundan bağımsız bir kimlikle çalışır.

**Neden bu faz var:** FAZ 2-3'te `POST /api/otp` JWT (access token, 15dk ömürlü) ile korunuyordu.
Ancak Android'in arka plan servisi ve iOS Shortcut'ı aylarca kullanıcı müdahalesi olmadan
çalışması gereken otomasyonlardır. 15 dakikalık bir bileti bu kadar uzun süre taşımaları
mimari olarak yanlıştır. Bu faz, "kullanıcı oturumu" (JWT) ile "cihaz kimliği" (Device Secret)
kavramlarını birbirinden ayırır.

**Yapılacaklar:**

`src/modules/device/`:
- **interfaces.ts** — `IDeviceService`, `IDeviceRepository`, `ISecretService`, DTO'lar (RegisterDeviceDto, DeviceResult)
- **secret.service.ts**:
  - `generate()`: `crypto.randomBytes(env.DEVICE_SECRET_BYTES).toString('hex')` — SYNC, 256-bit
  - `hash(secret)`: argon2id ile hash'le — ASYNC (password.service.ts ile aynı argon2 parametreleri, tekrar kullan)
  - `verify(secret, hash)`: argon2.verify — ASYNC
- **device.repository.ts** — `create()`, `findById()`, `findActiveById()` (isRevoked: false filtresi), `revoke()`, `updateLastUsed()` — hepsi ASYNC
- **device.service.ts**:
  - `register(dto, user)`: secret üret (SYNC) → hash'le (AWAIT) → DB'ye kaydet (AWAIT) → plain secret'ı SADECE bu response'ta dön, bir daha asla
  - `verify(plainSecret)`: tüm aktif device'ları gez, her biri için argon2.verify dene (AWAIT) — **NOT:** Bu yaklaşım device sayısı arttıkça yavaşlar; alternatif olarak secret'ın ilk N karakterini DB'de indexlenebilir bir "lookup prefix" olarak saklamak performans optimizasyonudur, ama 5-10 cihaz için gereksiz, şimdilik basit tutulur
  - `revoke(deviceId, requestingUserId)`: sahiplik kontrolü (AuthorizationError) → isRevoked: true (AWAIT)
- **device.controller.ts**, **device.routes.ts**, **device.schemas.ts**

`src/middleware/deviceAuth.ts`:
- `X-Device-Secret` header'ını oku — yoksa `DeviceAuthError` (401)
- `deviceService.verify(secret)` çağır — bulunamazsa veya revoke edilmişse `DeviceAuthError`
- `device.updateLastUsed()` çağır (AWAIT, fire-and-forget olabilir — response'u bekletmesin)
- `req.device = { id, userId, projectId, platform }` olarak set et
- `next()`

**Mevcut kod değişiklikleri:**
- `src/modules/otp/otp.routes.ts` — `POST /` route'undaki `authenticate, authorize('RECEIVER')` middleware'leri kaldırılır, yerine `deviceAuth` middleware'i konur
- `src/modules/otp/otp.controller.ts` — `receiveOtp` artık `req.user.projectId` yerine `req.device.projectId` kullanır
- `src/modules/otp/otp.service.ts` — `processAndDeliver` imzasına `deviceId` parametresi eklenir, `OTPLog.deviceId` alanına yazılır
- `prisma/schema.prisma` — `Device` modeli, `Platform` enum, `OTPLog.deviceId` ilişkisi eklenir
- `src/errors/errors.ts` — `DeviceAuthError extends AppError` eklenir (statusCode 401, errorCode DEVICE_SECRET_INVALID)
- `src/types/index.ts` — `DevicePayload` interface eklenir, `express.d.ts`'e `req.device` eklenir
- `npx prisma migrate dev --name add_device_auth`

**Tamamlanma Kriterleri:**
- [ ] `POST /api/devices/register` → JWT (RECEIVER) ile çağrılır, 201 + `{ deviceId, deviceSecret }` döner
- [ ] Dönen `deviceSecret` bir daha hiçbir endpointte görünmez (DB'de sadece hash var)
- [ ] `POST /api/otp` artık `X-Device-Secret` header'ı ile çalışır, `Authorization: Bearer` ile çalışmaz
- [ ] Geçersiz Device Secret → 401 `DEVICE_SECRET_INVALID`
- [ ] Revoke edilmiş Device Secret → 401 `DEVICE_REVOKED`
- [ ] `DELETE /api/devices/:id` → sadece cihazın sahibi (JWT ile) revoke edebilir, başkası → 403
- [ ] `GET /api/devices` → kullanıcının kendi cihazlarını listeler, `secretHash` response'ta yok
- [ ] OTP kaydı artık `deviceId` ile ilişkilendiriliyor
- [ ] Eski JWT tabanlı `POST /api/otp` testleri kaldırıldı/güncellendi, yeni Device Secret testleri eklendi
- [ ] `npm run test:unit` → secret.service testleri geçer
- [ ] `npm run test:integration` → device ve güncellenmiş otp testleri geçer

**Unit test kapsamı** (`tests/unit/secret.service.test.ts`):
- generate() → 64 karakter hex string (32 byte) üretir
- generate() → her çağrıda farklı değer üretir
- hash() → verify() → aynı secret için true döner
- verify() → yanlış secret için false döner (exception değil)
- hash() → her çağrıda farklı hash üretir (argon2 salt randomness)

**Integration test kapsamı** (`tests/integration/device.test.ts`):
- POST /api/devices/register: JWT (RECEIVER) → 201, deviceSecret döner
- POST /api/devices/register: JWT (DEVELOPER) → 403 (sadece RECEIVER cihaz kaydedebilir)
- POST /api/devices/register: token yok → 401
- DELETE /api/devices/:id: sahibi → 200
- DELETE /api/devices/:id: sahibi değil → 403
- DELETE /api/devices/:id: olmayan device → 404
- GET /api/devices: sadece kendi cihazları döner, secretHash içermez

**Integration test kapsamı** (`tests/integration/otp.test.ts` — güncellenmiş):
- POST /api/otp: geçerli X-Device-Secret → 200
- POST /api/otp: X-Device-Secret yok → 401 DEVICE_SECRET_INVALID
- POST /api/otp: geçersiz X-Device-Secret → 401 DEVICE_SECRET_INVALID
- POST /api/otp: revoke edilmiş device → 401 DEVICE_REVOKED
- POST /api/otp: Authorization: Bearer header'ı artık işe yaramıyor (eski davranış kaldırıldı)
- OTPLog.deviceId doğru cihaza işaret ediyor

---

## Notlar

- Redis yok. 5-10 kullanıcı için PostgreSQL + in-memory Socket.IO yeterli.
- Socket.IO adapter geçişi: `io.adapter(createAdapter(pub, sub))` — 1 satır, geri kalan değişmez.
- JWT verify sync — QA iç aracı için bottleneck değil. Profiling'de sorun görülürse async'e geç.
- Mobil: `otpsplash-mobile` — ayrı repo, React Native + TypeScript.
- Device Secret: hem Android hem iOS aynı modeli kullanır — tutarlı, tek middleware.
- İleride: Redis adapter, argon2 rehash, refresh token blacklist, key rotation, Device Secret lookup prefix optimizasyonu (cihaz sayısı 100+ olursa).