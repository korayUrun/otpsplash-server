# OTPsplash Server — Faz Detayları

> Mimari kararlar, tech stack, şema ve API kontratı için **CLAUDE.md**'ye bak.
> Bu dosya sadece faz faz görev listelerini, tamamlanma kriterlerini ve test kapsamlarını taşır.

## Mevcut Durum

```
[x] FAZ 1 — İskelet ve Altyapı           (commit edildi)
[x] FAZ 2 — Auth Sistemi                  (commit edildi)
[x] FAZ 3 — OTP Core                      (commit edildi — FAZ 8'de smsText/parser değişecek)
[x] FAZ 4 — Proje Yönetimi                (commit edildi)
[x] FAZ 5 — Test Coverage ve Deploy       (commit edildi)
[x] FAZ 6 — Device Authentication         (commit edildi)
[x] FAZ 7 — Gruplar ve Yönlendirme        (commit edildi — 5f00276)
[x] FAZ 8 — Servis Tespiti ve Kayıt Defteri (commit edildi — aef3c34)
[x] Fiziksel Cihaz Testi Düzeltmeleri (madde 3/6/11) — aşağıdaki bölüme bak
```

> **FAZ 8 — tamamlandı ve commit edildi (aef3c34):** service-registry modülü (resolver
> cache'i + ReDoS-korumalı şema + kova upsert), `OTPLog.serviceId` çözümlemesi, `POST /api/otp`
> body değişimi (`smsText` kaldırıldı, `code`/`senderRaw` zorunlu, `serviceHint` opsiyonel —
> parser/validate adımı service'ten çıktı), Device profili (`deviceName`/`phoneNumber`) ve tüm
> unit/integration testleri. `npm run typecheck` ve `npm test` (199 test) temiz geçiyor.

Yeni bir oturuma başlarken Claude Code'a şunu söyle:
```
CLAUDE.md ve PHASES.md'yi oku. PHASES.md'deki "Mevcut Durum" bölümüne göre
kaldığın fazdan devam et.
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
- `prisma/schema.prisma` — temel şema (User, Project, OTPLog)
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

> **Not:** Bu faz tamamlandığında `POST /api/otp` hâlâ JWT ile korunuyordu, body'de `smsText`
> kabul ediliyordu (backend parse ediyordu) ve hedef kitle otomatik olarak projedeki tüm
> developer'lardı (routing yoktu). FAZ 6 auth'u, FAZ 7 dağıtımı, FAZ 8 hem servis tespitini
> hem de parse yerini (cihaza taşıyarak `smsText`'i tamamen kaldırdı) değiştirdi. Aşağıdaki
> açıklama orijinal haliyle korunmuştur — ilgili fazlardaki değişiklik notlarına bak.
> `otp.parser.ts` FAZ 8 sonrası backend'de kullanılmaz hale gelir (kod cihazda parse edilir).

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

> ⚠️ **Aşağıdaki tamamlanma kriterleri ve test kapsamı FAZ 6/8'de geçersizleşir** (`smsText` body'den
> kalkar, auth Device Secret'a geçer, parser kullanım dışı kalır). Bunları yazarken zaman kaybetme —
> gerçek hedef FAZ 8 sonrası halidir, bu liste sadece "o anki" tarihsel doğruyu gösteriyor.

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

`tests/setup.ts` — beforeEach: OTPLog → Device → RoutingRule → GroupMember → Group → ServiceRegistry → User → Project sırasıyla deleteMany (FK sırası — FAZ 7/8 sonrası genişletildi)
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
  - `verify(plainSecret)`: tüm aktif device'ları gez, her biri için argon2.verify dene (AWAIT) — **NOT:** Bu yaklaşım device sayısı arttıkça yavaşlar; 5-10 cihaz için gereksiz optimizasyon, şimdilik basit tutulur
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
- POST /api/devices/register: JWT (DEVELOPER) → 403
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
- POST /api/otp: Authorization: Bearer header'ı artık işe yaramıyor
- OTPLog.deviceId doğru cihaza işaret ediyor

---

## FAZ 7 — Gruplar ve Yönlendirme Kuralları

> ✅ **Durum: Tamamlandı.** group/ ve routing/ modülleri, socket.ts'in user-bazlı
> hedeflemeye geçişi + `emitRevoked`, otp.service/controller/repository güncellemeleri
> (receiverId, sharing endpoint'leri, routingResolver entegrasyonu) ve tüm unit/integration
> testleri yazıldı. Tamamlanma kriterlerinin hepsi karşılanıyor; `npm run test` (172 test)
> ve `npm run typecheck` temiz geçiyor. Commit henüz atılmadı.

**Hedef:** OTP dağıtımı artık receiver'ın elle seçimiyle değil, admin'in önceden tanımladığı
`RoutingRule`'lara göre otomatik gerçekleşir. Receiver paylaşımı sadece salt-okunur görür
ve OTP bazında durdurabilir.

**Neden bu faz var:** Önceki mimaride `POST /api/otp` gelen her OTP, projedeki tüm
DEVELOPER'lara gidiyordu (basit broadcast). Gerçek kullanım senaryosunda ihtiyaç daha
ince taneli: bir receiver birden fazla servisten (banka, kripto vb.) kod üretebilir,
ve her servisin kodu farklı developer'lara gitmesi gerekebilir. Bu fazda hedef kitle
artık projedeki herkes değil, admin'in `(receiver, servis) → developer veya grup`
şeklinde tanımladığı kurallarla belirlenir.

**Yapılacaklar:**

`src/modules/group/`:
- **interfaces.ts** — IGroupService, IGroupRepository, DTO'lar
- **group.repository.ts** — create, findById, findByProject (members ile birlikte), addMember, removeMember — ASYNC
- **group.service.ts**:
  - `create(dto, admin)`: proje doğrula → grup oluştur (AWAIT)
  - `addMember(groupId, userId, admin)`: user DEVELOPER rolünde mi kontrol et (ValidationError, sadece developer gruba eklenir) → zaten üye mi (ConflictError) → ekle (AWAIT)
  - `removeMember`: AWAIT
  - `listForProject(projectId)`: AWAIT — hem admin hem receiver'lar görebilir (salt-okunur, isim görünür)
- **group.controller.ts**, **group.routes.ts**, **group.schemas.ts**

`src/modules/routing/`:
- **interfaces.ts** — IRoutingService, IRoutingRepository, IRoutingResolver, DTO'lar (CreateRoutingRuleDto)
- **routing.repository.ts** — create, findById, findActiveByReceiverAndService, listByProject — ASYNC
- **routing.resolver.ts**:
  - `resolveTargets(receiverId, serviceId)`: AWAIT — o receiver+servis için aktif kuralları çek.
    Her kural targetType=DEVELOPER ise direkt User.id, targetType=GROUP ise grubun
    GroupMember'larını çek ve flatten et (SYNC, bellekte). Sonuç: benzersiz User.id listesi
    (bir developer hem direkt hem grup üzerinden hedeflenmiş olabilir, Set ile dedupe et)
  - Hiç aktif kural yoksa boş liste döner — **kimseye gitmez**, eski "herkese broadcast" davranışı tamamen kalkar
- **routing.service.ts**:
  - `createRule(dto, admin)`: receiver gerçekten RECEIVER rolünde mi, hedef (developer/grup) projeye ait mi doğrula → unique constraint çakışması → ConflictError (AWAIT)
  - `toggleRule(id, isActive, admin)`: AWAIT
  - `deleteRule(id, admin)`: AWAIT
  - `listForReceiver(receiverId)`: receiver kendi kurallarını salt-okunur görür — bu, OTP detay ekranındaki "kimlerle paylaşıyorum" görünümünün veri kaynağıdır (AWAIT)
- **routing.controller.ts**, **routing.routes.ts**, **routing.schemas.ts**

**Mevcut kod değişiklikleri:**
- `prisma/schema.prisma` — `Group`, `GroupMember`, `RoutingRule` modelleri, `RoutingTarget` enum,
  `OTPLog.receiverId` alanı eklenir (bkz. "OTP Sahiplik Kararı")
- `src/modules/otp/otp.service.ts` — `processAndDeliver` artık DB kaydından sonra
  `routingResolver.resolveTargets(receiverId, serviceId)` çağırır (AWAIT), dönen User.id
  listesini `socket.service.ts`'teki `emitOtp`'a iletir. `emitOtp` artık tüm proje odasına
  **broadcast etmez** — SADECE hedef developer'ların bireysel `user:${userId}` odalarına emit
  eder. (`project:${projectId}` odası bu fazdan sonra OTP/revoked event'leri için kullanılmaz —
  o oda sadece ileride proje-geneli duyurular gibi farklı bir amaç için saklı tutulur, hedefli
  OTP dağıtımı tamamen user-bazlı odalara taşınmıştır.) DB kaydında `receiverId`
  artık `req.device.userId`'den doğrudan yazılır (deviceId'ye bağımlı değil)
- `src/infrastructure/socket.ts` — Developer bağlanınca `user:${userId}` odasına join olur
  (bireysel hedefleme için gerekli — tek strateji budur, proje odasına da AYRICA join olup
  oradan da event almaz, çift dinleme önlenir). `emitRevoked(otpId, targetUserIds)` fonksiyonu
  eklenir — `otp:revoked` event'i için, SADECE `user:${userId}` odalarına emit eder
- `src/modules/otp/otp.controller.ts` — `PATCH /api/otp/:id/sharing` ve
  `GET /api/otp/:id/sharing` endpoint'leri eklenir
- `src/modules/otp/otp.repository.ts` — `updateSharingActive(otpId, receiverId, isActive)`
  eklenir — sahiplik kontrolü artık **`OTPLog.receiverId` üzerinden doğrudan** yapılır
  (`device.userId` zinciri üzerinden DEĞİL — cihaz silinmiş olsa bile sahiplik geçerli kalır)
- `src/modules/otp/otp.service.ts` — `toggleSharing(otpId, receiverId, isActive)`:
  sahiplik doğrula (AWAIT) → `repository.updateSharingActive` (AWAIT) → `isActive: false`
  ise aynı zamanda `routingResolver.resolveTargets()` ile o OTP'nin hedeflerini tekrar
  bul (AWAIT) → `socket.emitRevoked(otpId, targetUserIds)` çağır (SYNC, fire-and-forget,
  response'u bekletmez) — **bu adım yeni eklenen `otp:revoked` event'idir**
- Migration dosyasına elle iki adet partial unique index SQL'i eklenir (bkz. şemadaki
  RoutingRule yorum bloğu) — Prisma `schema.prisma` üzerinden ifade edilemediği için
  migration SQL dosyası migration oluşturulduktan sonra elle düzenlenir
- `npx prisma migrate dev --name add_groups_and_routing`

**Tamamlanma Kriterleri:**
- [ ] Admin grup oluşturabilir, developer ekleyip çıkarabilir
- [ ] Receiver `GET /api/groups` ile grup isimlerini görebilir (salt-okunur)
- [ ] Admin `(receiver, servis) → developer` veya `(receiver, servis) → grup` kuralı oluşturabilir
- [ ] Aynı receiver+servis için birden fazla kural olabilir (bir developer'a, bir gruba aynı anda)
- [ ] Aynı (receiver, servis, developer) ikinci kez eklenmeye çalışılırsa → 409 (hem servis
      katmanında hem partial unique index'te yakalanıyor — ikisi de test edilir)
- [ ] Kuralı olmayan receiver+servis kombinasyonundan gelen OTP **kimseye gitmez**, sadece DB'ye kaydedilir
- [ ] OTP geldiğinde sadece kuraldaki hedef developer'lar Socket.IO ile bildirim alır, proje genelindeki diğer developer'lar almaz
- [ ] Receiver `GET /api/otp/:id/sharing` ile o OTP'nin kimlere gittiğini salt-okunur görür
- [ ] Receiver `PATCH /api/otp/:id/sharing` ile `sharingActive: false` yapabilir
- [ ] `sharingActive: false` olan OTP artık developer'ın `GET /api/otp/history` listesinde görünmez
- [ ] `sharingActive: false` yapıldığında ilgili developer'lara `otp:revoked` Socket event'i gider
- [ ] `otp:revoked`, OTP'nin zaten gönderilmiş `otp:received` event'ini geri almaz, sadece
      developer tarafındaki UI'ın o kartı kaldırması için bir sinyaldir
- [ ] Başka receiver'ın OTP'sinde sharing toggle denemesi → 403
- [ ] Device silindikten sonra bile receiver kendi eski OTP'sinin sharing'ini durdurabilir
      (`receiverId` ile test edilir, `deviceId` null olsa da çalışmalı)
- [ ] `npm run test:integration` → group, routing ve güncellenmiş otp testleri geçer

**Unit test kapsamı** (`tests/unit/routing.resolver.test.ts`):
- Sadece DEVELOPER hedefli kural → tek User.id döner
- Sadece GROUP hedefli kural → grubun tüm üyeleri döner
- Hem DEVELOPER hem GROUP kuralı aynı developer'ı kapsıyorsa → dedupe edilmiş tek sonuç
- Hiç kural yok → boş liste
- isActive: false olan kural → sonuca dahil edilmez

**Integration test kapsamı** (`tests/integration/group.test.ts`):
- createGroup: ADMIN → 201, diğer roller → 403
- addMember: DEVELOPER rolünde olmayan user eklenmeye çalışılırsa → 400 ValidationError
- addMember: zaten üye → 409
- listGroups: RECEIVER de görebilir (salt-okunur)

**Integration test kapsamı** (`tests/integration/routing.test.ts`):
- createRule: ADMIN → 201
- createRule: receiver rolü RECEIVER değilse → 400
- createRule: aynı (receiver, service, target) tekrar → 409 (servis katmanı kontrolü)
- createRule: servis katmanı kontrolünü bypass edip doğrudan DB'ye aynı kayıt yazılmaya
  çalışılırsa partial unique index hata fırlatır (DB seviyesi koruma testi)
- toggleRule: isActive false → o kuralla eşleşen yeni OTP'ler artık iletilmiyor
- deleteRule: 200

**Integration test kapsamı** (`tests/integration/otp.test.ts` — eklenen):
- Kuralı olan receiver+servis → sadece hedef developer Socket event alır
- Kuralı olmayan receiver+servis → hiçbir developer Socket event almaz, DB kaydı yine de oluşur
- PATCH sharing: sahibi → 200, sahibi değil → 403
- sharingActive: false → history'de görünmüyor
- sharingActive: false → hedef developer'lara otp:revoked event'i gider (mock socket ile doğrulanır)
- Device'ı silinmiş bir receiver, eski bir OTP'sinin sharing'ini yine de durdurabilir

---

## FAZ 8 — Servis Tespiti ve Kayıt Defteri

**Hedef:** Cihazdan gelen `senderRaw` ve `serviceHint` sinyalleri backend'de bir servise
(Binance, Garanti vb.) çözümlenir. Eşleşmeyen sinyaller otomatik olarak Servis Kayıt
Defteri'nde inaktif satır olarak birikir, admin oradan tek tıkla aktive eder.

**Neden bu faz var:** FAZ 7'deki `RoutingRule` bir `serviceId`'ye bağlı çalışıyor, ama
o `serviceId`'nin nereden geleceği henüz tanımlı değildi. Bu faz, gelen SMS sinyalini
somut bir servis kimliğine çeviren çözümleme katmanını ekler. Aynı zamanda yeni bir
şirket eklemenin mobil uygulamaya hiç dokunmadan, sadece admin panelden bir kural
eklemekle mümkün olmasını sağlar.

**Yapılacaklar:**

`src/modules/service-registry/`:
- **interfaces.ts** — IServiceRegistryService, IServiceRegistryRepository, IServiceResolver, DTO'lar
- **registry.repository.ts**:
  - `findActiveRules(projectId)`: isActive:true olan tüm kayıtları çek — ASYNC
  - `upsertUnmatched(projectId, senderRaw)`: senderPattern eşleşmesi yoksa, lastSeenSender'a göre
    var olan inaktif kaydı bul, varsa unmatchedCount+1 ve lastSeenAt güncelle, yoksa
    `isActive: false, name: null` yeni kayıt oluştur — ASYNC (upsert)
  - `activate(id, dto)`: name, senderPattern, keywordPattern set et, isActive: true yap — ASYNC
  - `findUnmatched(projectId)`: isActive:false olanları listele — ASYNC
- **registry.resolver.ts**:
  - In-memory cache: `Map<projectId, { rules: ServiceRegistry[], expiresAt: number }>`
  - `resolve(projectId, senderRaw, serviceHint)`:
    1. Cache'te bu proje için kural var mı ve süresi dolmamış mı kontrol et (SYNC) —
       yoksa `registry.repository.findActiveRules(projectId)` ile çek (AWAIT) ve cache'e yaz
    2. Kuralları sırayla gez: önce `senderPattern` ile `senderRaw` eşleştir (regex test, SYNC) —
       eşleşirse o servisin id'sini dön
    3. Hiçbiri eşleşmediyse ve `serviceHint` varsa, `keywordPattern` ile `serviceHint` eşleştir (SYNC)
    4. Hiçbiri eşleşmediyse `null` dön — çağıran taraf (otp.service.ts) bunu görünce
       `registry.service.recordUnmatched()` çağırır
  - Cache TTL: `env.SERVICE_REGISTRY_CACHE_TTL_MS` (varsayılan 60sn) — admin yeni kural
    eklediğinde en geç bu süre içinde devreye girer; anlık tutarlılık bu proje ölçeğinde gerekmez
- **registry.service.ts**:
  - `createRule(dto, admin)`: doğrudan aktif bir kural oluşturur (manuel ekleme) — **kayıt
    öncesi `senderPattern`/`keywordPattern` ReDoS kontrolünden geçer** (bkz. "senderPattern —
    ReDoS Koruması" mimari kararı: uzunluk ≤200 karakter, tehlikeli quantifier reddi) — AWAIT
  - `activateFromUnmatched(id, dto, admin)`: kova satırını isim ve kural vererek aktive eder —
    aynı ReDoS kontrolü burada da çalışır — AWAIT
  - `recordUnmatched(projectId, senderRaw)`: repository.upsertUnmatched çağırır — AWAIT,
    **response'u bekletmemeli** (otp.service.ts'te fire-and-forget olarak çağrılabilir,
    OTP'nin kendisinin işlenmesini yavaşlatmamalı)
  - `listAll(projectId)`, `listUnmatched(projectId)` — AWAIT
- **registry.controller.ts**, **registry.routes.ts**, **registry.schemas.ts**:
  - `registry.schemas.ts`'de `senderPattern`/`keywordPattern` için Zod `.max(200)` ve
    tehlikeli kalıpları reddeden bir `.refine()` (iç içe quantifier kontrolü)

`src/modules/device/`:
- `device.schemas.ts` — `registerDeviceSchema`'ya opsiyonel `deviceName` ve `phoneNumber`
  alanları eklenir (Device modelindeki yeni alanlarla eşleşir)
- `device.service.ts` — `register` artık bu iki opsiyonel alanı da DB'ye yazar

**Mevcut kod değişiklikleri:**
- `prisma/schema.prisma` — `ServiceRegistry` modeli, `OTPLog.serviceId` ilişkisi,
  `Device.phoneNumber`/`Device.deviceName` alanları eklenir
- `src/modules/otp/otp.schemas.ts` — `receiveOtpSchema` **tamamen değişir**: `smsText` alanı
  KALDIRILIR, `code` artık zorunlu hale gelir (önceden opsiyoneldi), `senderRaw: z.string().min(1)`
  zorunlu olarak eklenir, `serviceHint: z.string().optional()` eklenir. Yeni şema:
  `{ code: string (6 haneli), source: enum, senderRaw: string, serviceHint?: string }`
- `src/modules/otp/otp.parser.ts` — **FAZ 8 sonrası backend'de tamamen kullanılmaz**, hem
  `extract()` hem `validate()` metotları için. Parse işlemi FAZ 3'te backend'de yapılacak
  şekilde tasarlanmıştı, ama FAZ 8 ile parse yeri cihaza taşındı (bkz. "Proje" bölümündeki
  "Parse yeri kararı"). `validate(code)`'un yaptığı format kontrolü (6 haneli rakam) artık
  `receiveOtpSchema`'daki Zod tanımıyla (`code: z.string().length(6).regex(/^\d{6}$/)`) zaten
  karşılanıyor — **aynı doğrulamayı iki katmanda tutmamak için `otp.service.ts` artık
  `validate()`'i de çağırmaz**, controller'a gelene kadar `validate` middleware'i (Zod) işi
  bitirmiş olur. Dosya kod tabanında kalabilir (gelecekte farklı bir bağlamda fallback olarak
  kullanılabilir) ama `otp.service.ts` hiçbir metodunu çağırmaz.
- `src/modules/otp/otp.service.ts` — `processAndDeliver` akışı **parse VE validate adımları
  olmadan** çalışır (DRY — format kontrolü artık tek yerde, Zod'da):
  1. ~~parse~~ — KALDIRILDI, `code` zaten cihazdan parse edilmiş olarak gelir
  2. ~~validate(code)~~ — KALDIRILDI, format kontrolü `receiveOtpSchema` (Zod) tarafından
     controller'a ulaşmadan önce zaten yapılmış olur — middleware request'i reddeder, service'e
     hiç gelmez
  3. `serviceResolver.resolve(projectId, senderRaw, serviceHint)` (cache nedeniyle içeride
     bazen AWAIT bazen SYNC, dışarıdan her zaman await edilir)
  4. Çözülemezse: `registryService.recordUnmatched()` fire-and-forget çağrılır, `serviceId: null`
     ile devam edilir — **OTP yine de kaydedilir**, sadece routing'de hedef bulunamayacağı
     için kimseye gitmez (FAZ 7'deki "kural yoksa kimseye gitmez" davranışıyla tutarlı)
  5. encrypt (SYNC, mevcut)
  6. DB kaydet — artık `serviceId` ve `receiverId` alanlarıyla birlikte (AWAIT)
  7. `routingResolver.resolveTargets(receiverId, serviceId)` (AWAIT, FAZ 7)
  8. emit (SYNC, mevcut)
- `npx prisma migrate dev --name add_service_registry`

**Tamamlanma Kriterleri:**
- [ ] Admin doğrudan bir servis kuralı oluşturabilir (`name`, `senderPattern`, `keywordPattern`)
- [ ] 200 karakterden uzun `senderPattern` → 400 VALIDATION_ERROR
- [ ] Tehlikeli iç içe quantifier içeren pattern (`(a+)+` gibi) → 400 VALIDATION_ERROR
- [ ] Tanınan `senderRaw` ile gelen OTP doğru `serviceId` ile kaydedilir
- [ ] Tanınmayan `senderRaw` → `serviceId: null` ile kaydedilir, kimseye gitmez, ServiceRegistry'de inaktif satır oluşur/güncellenir
- [ ] Aynı tanınmayan `senderRaw` ikinci kez gelirse → yeni satır açılmaz, `unmatchedCount` artar
- [ ] `GET /api/service-registry/unmatched` → sadece inaktif satırları döner
- [ ] Admin bir inaktif satırı `PATCH` ile aktive edip isim/kural verebilir
- [ ] Aktive edildikten sonra **gelecekteki** aynı sinyaller doğru servise çözülür (geçmiş OTP'ler değişmez)
- [ ] `senderPattern` eşleşmesi `keywordPattern`'dan önceliklidir
- [ ] Cache TTL süresi dolunca kurallar DB'den yeniden çekilir
- [ ] `recordUnmatched` çağrısı OTP işleme süresini bloklamıyor (fire-and-forget doğrulanmış)
- [ ] `POST /api/otp` artık `smsText` kabul etmiyor — gönderilse bile yok sayılır veya 400 döner (Zod strict mode)
- [ ] SMS gövdesi hiçbir zaman ne JS tarafında ne backend'de tutulmuyor — sadece kod ve sinyaller
- [ ] `POST /api/devices/register` artık opsiyonel `deviceName`/`phoneNumber` kabul ediyor
- [ ] `npm run test:unit` → registry.resolver testleri geçer
- [ ] `npm run test:integration` → service-registry ve güncellenmiş otp testleri geçer

**Unit test kapsamı** (`tests/unit/registry.resolver.test.ts`):
- senderPattern eşleşmesi → doğru serviceId
- senderPattern eşleşmiyor ama keywordPattern eşleşiyor → doğru serviceId
- hiçbiri eşleşmiyor → null
- senderPattern ve keywordPattern ikisi de eşleşebiliyorsa senderPattern kazanır
- cache süresi dolmadan ikinci çağrı → DB'ye tekrar gitmez (mock repository call count ile doğrula)
- cache süresi dolduktan sonra → DB'ye tekrar gider

**Unit test kapsamı** (`tests/unit/registry.schema.test.ts` — ReDoS koruması):
- 200 karakter sınırını aşan senderPattern → Zod validation hatası
- `(a+)+` gibi iç içe quantifier içeren pattern → refine hatası
- Normal, güvenli bir pattern (örn. `^BINANCE.*$`) → geçer

**Integration test kapsamı** (`tests/integration/service-registry.test.ts`):
- POST /api/service-registry: ADMIN → 201
- POST /api/service-registry: 200+ karakter senderPattern → 400
- POST /api/service-registry: tehlikeli regex pattern → 400
- PATCH /api/service-registry/:id (kova satırını aktive et): isActive true olur, name set edilir
- GET /api/service-registry/unmatched: sadece isActive:false dönenler

**Integration test kapsamı** (`tests/integration/otp.test.ts` — eklenen):
- Tanınan senderRaw → OTPLog.serviceId dolu, routing'e göre doğru developer'a gider
- Tanınmayan senderRaw → OTPLog.serviceId null, kimseye gitmiyor, ServiceRegistry'de kova satırı oluşuyor
- Aynı tanınmayan senderRaw tekrar gelirse → ServiceRegistry'de yeni satır değil, mevcut satırın sayacı artıyor
- senderRaw eksikse → 400 VALIDATION_ERROR (artık zorunlu alan)

---

## Fiziksel Cihaz Testi Düzeltmeleri (FAZ 8 Sonrası)

**Hedef:** Fiziksel telefon (Android/iOS) testinde ortaya çıkan eksiklerin giderilmesi.
Mimari kararlar CLAUDE.md'ye işlendi (Self-Register / OTP TTL / Receiver Rol Kapsamı blokları).

**Yapılanlar:**

- **madde 3 — OTP geçerlilik süresi 90 sn.** `expiresAt = createdAt + 90 sn`, artık
  `CONSTANTS.OTP.TTL_SECONDS` sabitinden hesaplanır. `OTP_TTL_DAYS` env değişkeni tüm kod
  tabanından ve `.env*` dosyalarından kaldırıldı. Mobil zaten `expiresAt`'e göre geri sayıyor.

- **madde 6 — `DELETE /api/groups/:id`.** ADMIN kendi projesindeki grubu siler; başka
  proje/olmayan grup → 404 GROUP_NOT_FOUND. Üyelikler ve o grubu hedefleyen routing kuralları
  DB seviyesinde `ON DELETE CASCADE` ile temizlenir — dangling kural kalmaz (cascade testiyle
  doğrulandı). group modülüne `delete` (interface/repo/service/controller/route) eklendi.

- **madde 11 — Self-register uyarlandı.** `POST /api/auth/register` body'sinden `projectId`
  KALDIRILDI; kullanıcı varsayılan projeye (`Project.isDefault`) bağlanır. `name` zorunlu,
  `phoneNumber` opsiyonel eklendi (`User.phoneNumber`). Rol yalnızca RECEIVER/DEVELOPER —
  ADMIN reddedilir (400). Varsayılan proje yoksa 404. Migration `add_register_fields`
  (`User.phoneNumber`, `Project.isDefault` + partial unique index `projects_isDefault_key`).
  Seed demo projeyi varsayılan işaretler.

- **madde 8 — senderRaw/serviceName (zaten kodluydu, doğrulandı).** Socket payload'ı
  (`OtpNotification`), developer history ve receiver history üçü de `serviceName` + `senderRaw`
  taşıyor; entegrasyon testleri assert ediyor. Kod tarafında ek değişiklik gerekmedi.

- **madde 2 — iOS canlı akış: EKLENMEDİ (karar).** Receiver'ın tek işlevi kayıt + SMS akışını
  başlatmak; cihazda canlı OTP feed'i yok. Bu yüzden receiver'ın kendi odasına emit eklenmedi
  (CLAUDE.md "Receiver Rol Kapsamı — iOS Canlı Emit Yok").

**Tamamlanma Kriterleri:**
- [x] OTP `expiresAt` = createdAt + 90 sn; `OTP_TTL_DAYS` hiçbir yerde yok
- [x] `DELETE /api/groups/:id` → 200 (ADMIN), 403 (diğer rol), 404 (başka proje/olmayan)
- [x] Grup silinince üyelik + hedef routing kuralları cascade ile siliniyor
- [x] register body'sinde `projectId` yok; varsayılan projeye bağlanıyor
- [x] register ADMIN rolünü reddediyor (400); `name` zorunlu, `phoneNumber` opsiyonel
- [x] `npm run typecheck` temiz, `npm test` (213 test) geçiyor

---

## Notlar

- Redis yok. 5-10 kullanıcı için PostgreSQL + in-memory Socket.IO + in-memory ServiceRegistry cache yeterli.
- Socket.IO adapter geçişi: `io.adapter(createAdapter(pub, sub))` — 1 satır, geri kalan değişmez.
- JWT verify sync — QA iç aracı için bottleneck değil. Profiling'de sorun görülürse async'e geç.
- Mobil: `otpsplash-mobile` — ayrı repo, React Native + TypeScript. Üç ayrı rol arayüzü (Receiver/Developer/Admin) + Admin için ayrıca web dashboard.
- Device Secret: hem Android hem iOS aynı modeli kullanır — tutarlı, tek middleware.
- Grup kavramı opsiyoneldir — admin önce tek tek developer hedefleyebilir, istediğinde grup kısayoluna geçebilir.
- Kova mantığı ayrı bir tablo değil, ServiceRegistry'nin `isActive: false` satırlarıdır — tek tablo, tek liste, admin için tek ekran.
- Geçmişe dönük OTP kurtarma yapılmaz — admin yeni servis kuralı eklediğinde sadece o andan sonraki SMS'ler doğru yere akar.
- İleride: Redis adapter, argon2 rehash, refresh token blacklist, key rotation, Device Secret lookup prefix optimizasyonu, ServiceRegistry cache'i Redis pub/sub ile invalidate etme (multi-instance senaryosunda).