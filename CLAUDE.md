# OTPsplash Server — Claude Code Specification

> Her oturumda bu dosyayı önce oku. Faz tamamlanma kriterlerini geçmeden sonraki faza geçme.

---

## Rol

Kıdemli backend mühendisi. Stripe/Google kalitesinde kod yaz.

---

## Proje

**OTPsplash** — Test hesaplarına gelen SMS OTP'lerini ilgili developer'lara sıfır müdahaleyle,
admin tarafından tanımlanmış kurallara göre dağıtan bir orkestrasyon platformudur.

```
SMS gelir (Android: otomatik | iOS: Shortcuts) → CİHAZDA parse edilir (code + senderRaw + serviceHint?)
  → POST /api/otp (X-Device-Secret header ile) { code, source, senderRaw, serviceHint? }
    → Device doğrula → senderRaw/serviceHint ile servis çözümle
      → AES-256-GCM şifrele → DB kaydet (receiverId doğrudan yazılır, deviceId'ye bağımlı değil)
        → RoutingRule'a göre hedef belirle (developer veya grup)
          → Socket.IO emit → ilgili developer(lar)ın ekranı
```

**Parse yeri kararı:** OTP kodu cihazda parse edilir, backend'e asla ham SMS metni (`smsText`)
gönderilmez. Bu hem mobil tarafta zaten var olan regex mantığını tekrar kullanır hem de
"SMS gövdesi asla cihazdan çıkmaz" güvenlik prensibini gerçek anlamda korur — eğer backend
parse etseydi, ham metnin backend'e gitmesi şart olurdu ve bu prensip kağıt üzerinde kalırdı.

**Kullanıcı rolleri:** RECEIVER (OTP üretir) | DEVELOPER (OTP alır) | ADMIN (kuralları yönetir)
Üç rol de ayrı mobil arayüze sahiptir — bir kullanıcı aynı anda iki rolü birden taşımaz.
Admin için ayrıca web dashboard da vardır (mobil admin paneli + web dashboard birlikte var olur).

**Otomasyonun iki katmanı:**
```
Katman 1 — SMS yakalama (cihazda otomatik)
  Receiver hiçbir şey seçmez, SMS geldiği an cihaz backend'e gönderir.

Katman 2 — Dağıtım (backend'de, admin kuralına göre otomatik)
  Hangi developer'ın hangi receiver'ın hangi servisten gelen kodunu göreceğini
  admin önceden tanımlar (RoutingRule). Receiver paylaşımı elle seçmez, sadece
  admin'in kurduğu kuralı salt-okunur görür ve dilerse o OTP özelinde paylaşımı durdurabilir.
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
- **OCP:** Yeni OTP kaynağı (kayıt tipi) veya yeni servis tespiti kuralı eklemek = yeni veri/class, mevcut koda dokunma.
- **LSP:** Tüm interface implementasyonları birbirinin yerine geçebilmeli.
- **ISP:** `IOtpParser`, `IOtpEncryptor`, `IOtpRepository`, `IOtpNotifier`, `IRoutingResolver`, `IServiceResolver` — tek büyük interface yok.
- **DIP:** Service'ler concrete class'a değil interface'e bağımlı. Constructor injection zorunlu.

### Temiz Kod
- Magic string/number yok — her şey `CONSTANTS` veya enum.
- Public fonksiyonlara JSDoc yaz.
- `try/catch` boş bırakılmaz.
- `console.log` ile hata yönetimi yapma — pino kullan.

### Asenkron / Senkron Kuralları
```
SYNC olmalı:
  ✓ OTP regex parse              (CPU, I/O yok)
  ✓ AES-256-GCM encrypt/decrypt  (crypto sync API)
  ✓ JWT sign/verify              (hızlı, QA iç aracı için yeterli)
  ✓ Device Secret üretimi        (crypto.randomBytes, sync)
  ✓ senderRaw/serviceHint eşleştirme (string/regex karşılaştırma, CPU bound — DB'den
    çekilen kuralları bellekte regex ile eşleştirmek I/O değil)
  ✓ Config/env okuma             (startup)

ASYNC olmalı:
  ✓ Her Prisma işlemi            (I/O)
  ✓ argon2 hash/verify           (CPU-intensive, event loop'u bloklar)
  ✓ Socket.IO emit               (I/O)
  ✓ ServiceRegistry kurallarını DB'den çekme (I/O — sonra senkron eşleştirme yapılır)

YASAK:
  ❌ argon2.hashSync() / bcrypt.hashSync()
  ❌ crypto.pbkdf2Sync()
  ❌ fs.readFileSync() (startup dışında)
  ❌ Her OTP isteğinde ServiceRegistry kurallarını tekrar tekrar sorgulamak —
     kurallar nadiren değişir, kısa süreli in-memory cache uygundur (bkz. FAZ 8)
```

### Hata Mimarisi
- `AppError` abstract base → tüm hatalar buradan türer.
- Her hata: `statusCode`, `errorCode` (enum), `isOperational` (true=beklenen, false=bug).
- Controller'da `next(error)` ile global handler'a ilet — exception sızdırma.
- `Result<T>` pattern: `{ success: true, data }` | `{ success: false, error }`.
- Stack trace asla client'a sızdırılmaz.

### Logging
- pino redact: `['body.password', 'body.code', 'body.senderRaw', 'headers.authorization', 'headers.x-device-secret']`
  (`smsText` artık listede yok — çünkü hiçbir zaman backend'e gelmiyor, redact etmeye gerek kalmadı)
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

### Dağıtım Mimari Kararı (FAZ 7)
Receiver paylaşımı elle yapmaz. Hedef kitle admin tarafından `RoutingRule` ile önceden
tanımlanır. Bir kural şu üçlüye bağlıdır: hangi receiver, hangi servisten gelen kod,
kime gidecek. "Kime gidecek" kısmı esnek tutulur — başlangıçta tek tek developer
seçmek yeterlidir, admin isterse sonradan developer'ları bir grup altında toplayıp
kuralı gruba bağlayabilir. Grup zorunlu bir kavram değil, bir kısayoldur.

```
RoutingRule.targetType = 'DEVELOPER' → targetId bir User.id'ye işaret eder
RoutingRule.targetType = 'GROUP'     → targetId bir Group.id'ye işaret eder
                                        (grup içindeki tüm developer'lara gider)
```

Receiver OTP detayında bu kuralın sonucunu salt-okunur görür ("şu an kimlerle
paylaşıyorum") ve o OTP'ye özel `sharingActive` toggle'ı ile görünürlüğü durdurabilir.
Durdurma geçmişe etkimez — developer zaten görmüşse geri alınmaz, sadece bundan
sonraki canlı görünürlük ve liste varlığı kesilir.

### Servis Tespiti Mimari Kararı (FAZ 8)
Hangi SMS'in hangi şirkete (Binance, Garanti vb.) ait olduğunu **cihaz değil backend
karar verir.** Cihaz pipeline'ı kasıtlı olarak "aptal" bırakılır: SMS'in tam gövdesini
hiçbir zaman backend'e göndermez, sadece iki küçük sinyal gönderir — `senderRaw`
(ham gönderici kimliği, Android'de güvenilir, iOS'ta yedek) ve opsiyonel `serviceHint`
(mesaj içinde yakalanan anahtar kelime, iOS'ta gönderici temiz gelmediğinde devreye girer).

Bu ayrım iki kazanç sağlar: SMS gövdesi hiçbir zaman cihazdan çıkmadığı için güvenlik
artar, ve yeni bir şirket eklemek mobil uygulamayı güncellemeyi gerektirmez — admin
panelden bir `ServiceRegistry` kuralı eklemesi yeterlidir.

Eşleşmeyen sinyaller ayrı bir "kova" tablosunda tutulmaz. `ServiceRegistry`'nin
`isActive: false, name: null` olan satırları zaten bu işlevi görür — backend tanımadığı
bir `senderRaw` gördüğünde inaktif bir kayıt upsert eder (varsa sayaç/son görülme
zamanını günceller, yoksa oluşturur). Admin panelde bu inaktif satırları görür, isim
ve eşleşme kuralı ekleyip aktif hale getirir. Geçmişe dönük kurtarma yapılmaz — o ana
kadar kovaya düşmüş OTP'ler zaten süresi dolmuş olur, kural eklendiği andan itibaren
gelecek SMS'ler otomatik doğru yere akar.

### OTP Sahiplik Kararı — receiverId Doğrudan Yazılır
`OTPLog.deviceId` nullable'dır (`onDelete: SetNull`) — cihaz silinirse bu alan null'a düşer.
Eğer sahiplik sadece `deviceId → Device.userId` zincirinden türetilseydi, cihazı silinen bir
receiver kendi geçmiş OTP'lerinin paylaşımını artık durduramaz hale gelirdi (sahiplik kanıtlanamaz).

Bunu önlemek için `OTPLog` doğrudan bir `receiverId` alanı taşır. OTP kaydedilirken bu değer
zaten elde olan `req.device.userId`'den yazılır — ekstra bir sorgu gerektirmez. `deviceId` hâlâ
izleme/analiz amacıyla ayrıca tutulur ama sahiplik kontrolü artık ona bağımlı değildir.

**Kabul edilen kademeli bozulma (graceful degradation):** `receiverId` sayesinde sahiplik
(sharing toggle yetkisi) her zaman korunur — ama `Device.phoneNumber`/`deviceName` bilgisi
`deviceId` üzerinden geliyor. Cihaz silinirse (`deviceId` null'a düşerse) bu iki alan da
kaybolur; developer'ın "cihaz bilgisi" görünümünde sadece `receiver` (kullanıcı adı/email)
kalır, telefon numarası ve cihaz adı boş görünür. Bu bilinçli kabul edilen bir davranıştır —
sahiplik (kritik) her koşulda korunurken, görüntüleme bilgisi (kozmetik) cihazla birlikte
kaybolabilir. Mobil tarafta bu durum zaten "Belirtilmemiş" yazısıyla ele alınıyor (bkz. mobil
CLAUDE.md, Developer OtpDetailScreen).

### RoutingRule Unique Constraint — Partial Index Zorunluluğu
PostgreSQL'de unique constraint'lerde NULL değerler "birbirinden farklı" sayılır. Eğer
`@@unique([receiverId, serviceId, targetType, developerId, groupId])` düz bir constraint olarak
tanımlanırsa, `targetType=DEVELOPER` olan kayıtlarda `groupId` hep NULL olacağından aynı
`(receiver, servis, developer)` üçlüsü teknik olarak birden fazla kez eklenebilir — DB bunu
yakalamaz. Bu yüzden **iki ayrı partial unique index** kullanılır (bkz. şema), ve servis
katmanında da `createRule` öncesi açık bir "zaten var mı" kontrolü yapılır — sadece DB
constraint'ine güvenilmez, çift katmanlı korunur.

### ServiceRegistry Proje İzolasyonu — Bilinçli Karar
`ServiceRegistry` proje bazlıdır (`@@index([projectId])`) — aynı "Binance" deseni her proje için
ayrı ayrı tanımlanmak zorundadır, global/paylaşımlı bir servis tanımı yoktur. Bu, çok projeli
kurulumlarda admin'in aynı kuralı tekrar tekrar girmesi anlamına gelir. **Bu bilinçli bir
kapsam dışı bırakma kararıdır** — "global servis + proje override" modeli gelecekte eklenebilir
ama şu an gereksiz karmaşıklık. Projeler arası veri sızıntısını da bu izolasyon engeller.

### senderPattern — ReDoS Koruması
Admin panelden girilen `senderPattern` ve `keywordPattern` doğrudan `regex.test()`'e gider ve
bu **senkron**, her gelen OTP isteğinde çalışır. Kötü yazılmış bir regex (catastrophic
backtracking) event loop'u bloklayabilir. QA iç aracı ölçeğinde risk düşük ama önlem ucuz:
pattern uzunluğu en fazla 200 karakter (Zod schema'da kontrol edilir), kayıt sırasında tehlikeli
quantifier kombinasyonlarını reddet (iç içe `(...)+`, `(...)*` gibi kalıpları reddeden basit bir
custom Zod refine `registry.schemas.ts`'de yer alır).

### Sharing Durdurma — Developer Ekranına Anlık Bildirim
Receiver `sharingActive: false` yaptığında, sadece `GET /api/otp/history`'den o OTP düşmekle
kalmaz, zaten Socket.IO ile gönderilmiş ve developer'ın ekranında duran canlı kart için de
bir `otp:revoked` event'i yayınlanır.

**Tek oda stratejisi — çift emit önlenir:** Bu event SADECE `user:${userId}` odalarına gider
(`otp:received` ile aynı hedefleme mantığı — bkz. FAZ 7'deki `resolveTargets` çıktısı), asla
`project:${projectId}` odasına da AYRICA gönderilmez. Eğer hem proje odasına hem kullanıcı
odasına gönderilseydi, aynı developer'ın her iki odada da bulunması durumunda event'i iki kez
alması riski doğardı. `emitRevoked(otpId, targetUserIds)` imzası zaten user-bazlı tek hedef
listesi alır — bu fonksiyonun davranışı budur, `project:${projectId}` odasına broadcast YAPMAZ.
Bu, "durdurdum" diyen receiver'ın gerçek davranışla tutarlı bir deneyim yaşaması için gereklidir
— aksi halde developer'ın ekranındaki kart, receiver durdurduktan sonra da görünmeye devam eder
ve güven kaybına yol açar. Event sadece görünürlüğü kapatır, developer'ın daha önce kodu
görmüş/kullanmış olmasını geri almaz — bu zaten teknik olarak mümkün değildir, sadece UI
senkronizasyonu sağlanır.

**Mobil tarafa not:** Tek oda stratejisi uygulansa bile, mobil taraftaki `removeLog(otpId)`
action'ı idempotent olmalıdır (zaten kaldırılmış veya hiç var olmayan bir `otpId` ile çağrılması
no-op olmalı, hata fırlatmamalı). Bu, ileride oda stratejisi değişirse veya ağ katmanında
event tekrarı olursa savunma sağlar — tek katmanlı korumaya güvenilmez.

---

## Klasör Yapısı

```
src/
├── index.ts                  → Entry, process handlers, graceful shutdown
├── app.ts                    → Express + Socket.IO factory
├── config/
│   ├── env.ts                → Zod env parse — fail-fast
│   ├── constants.ts          → CONSTANTS (OTP, ARGON2, SOCKET, PAGINATION, RATE_LIMIT, DEVICE, ROUTING)
│   └── prisma.ts             → Singleton
├── errors/
│   ├── AppError.ts           → Abstract base
│   ├── errors.ts             → ValidationError, AuthenticationError, AuthorizationError,
│   │                           NotFoundError, ConflictError,
│   │                           OtpParseError (FAZ 8 sonrası ulaşılamaz — parse cihaza taşındı,
│   │                           backend artık bu hatayı hiç fırlatmaz, bkz. otp.parser.ts notu),
│   │                           OtpEncryptionError, DeviceAuthError, RoutingError, InternalError
│   └── ErrorCode.ts          → Enum (VALIDATION_ERROR, AUTHENTICATION_FAILED,
│                               TOKEN_EXPIRED, TOKEN_INVALID, FORBIDDEN, NOT_FOUND,
│                               CONFLICT, USER_NOT_FOUND, PROJECT_NOT_FOUND,
│                               OTP_NOT_FOUND (FAZ 8 sonrası ulaşılamaz — bkz. OtpParseError notu),
│                               OTP_DELIVERY_FAILED,
│                               OTP_ENCRYPTION_FAILED, INTERNAL_ERROR,
│                               DATABASE_ERROR, RATE_LIMIT_EXCEEDED,
│                               DEVICE_NOT_FOUND, DEVICE_REVOKED, DEVICE_SECRET_INVALID,
│                               GROUP_NOT_FOUND, ROUTING_RULE_NOT_FOUND, ROUTING_RULE_CONFLICT,
│                               SERVICE_NOT_FOUND, SERVICE_INACTIVE)
├── types/
│   ├── Result.ts             → Result<T>, ok(), fail()
│   ├── express.d.ts          → Request augmentation: id, user, device
│   └── index.ts              → JwtPayload, DevicePayload, PaginationOptions, PaginatedResult
├── infrastructure/
│   ├── logger.ts             → pino singleton, ILogger interface
│   └── socket.ts             → Socket.IO singleton, initSocket(), emitOtp() (hedef listesi alır),
│                                emitRevoked() (otp:revoked event'i, FAZ 7)
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
│   │   ├── otp.parser.ts         → (FAZ 3'te yazıldı, FAZ 8'de KULLANIM DIŞI BIRAKILDI —
│   │   │                            parse artık cihazda yapılıyor, bkz. FAZ 8 değişiklik notları)
│   │   ├── otp.encryptor.ts      → AES-256-GCM encrypt/decrypt — SYNC
│   │   ├── otp.repository.ts     → Prisma CRUD — ASYNC
│   │   ├── otp.service.ts        → processAndDeliver (artık servis çözümleme + routing dahil), getHistory
│   │   ├── otp.controller.ts     → HTTP katmanı
│   │   ├── otp.routes.ts         → Route tanımları
│   │   └── otp.schemas.ts        → Zod şemaları (senderRaw, serviceHint eklendi)
│   ├── project/
│   │   ├── project.interfaces.ts → IProjectService, IProjectRepository, DTO'lar
│   │   ├── project.repository.ts → Prisma CRUD — ASYNC
│   │   ├── project.service.ts    → create, getById, addUser, removeUser
│   │   ├── project.controller.ts → HTTP katmanı
│   │   ├── project.routes.ts     → Route tanımları
│   │   └── project.schemas.ts    → Zod şemaları
│   ├── group/
│   │   ├── group.interfaces.ts   → IGroupService, IGroupRepository, DTO'lar
│   │   ├── group.repository.ts   → Prisma CRUD — ASYNC
│   │   ├── group.service.ts      → create, addMember, removeMember, listForProject
│   │   ├── group.controller.ts   → HTTP katmanı
│   │   ├── group.routes.ts       → Route tanımları
│   │   └── group.schemas.ts      → Zod şemaları
│   ├── routing/
│   │   ├── routing.interfaces.ts → IRoutingService, IRoutingRepository, IRoutingResolver, DTO'lar
│   │   ├── routing.repository.ts → Prisma CRUD — ASYNC
│   │   ├── routing.resolver.ts   → resolveTargets(receiverId, serviceId): User[] — ASYNC (DB) sonra SYNC (flatten)
│   │   ├── routing.service.ts    → createRule, toggleRule, deleteRule, listForReceiver
│   │   ├── routing.controller.ts → HTTP katmanı
│   │   ├── routing.routes.ts     → Route tanımları
│   │   └── routing.schemas.ts    → Zod şemaları
│   └── service-registry/
│       ├── registry.interfaces.ts → IServiceRegistryService, IServiceRegistryRepository,
│       │                            IServiceResolver, DTO'lar
│       ├── registry.repository.ts → Prisma CRUD — ASYNC
│       ├── registry.resolver.ts   → resolve(senderRaw, serviceHint): serviceId|null — SYNC eşleştirme,
│       │                            kurallar kısa TTL'li in-memory cache'ten okunur
│       ├── registry.service.ts    → createRule, activateFromUnmatched (kova satırını aktive et),
│       │                            recordUnmatched (upsert inaktif satır), listAll, listUnmatched
│       ├── registry.controller.ts → HTTP katmanı
│       ├── registry.routes.ts     → Route tanımları
│       └── registry.schemas.ts    → Zod şemaları
├── jobs/
│   └── cleanup.job.ts        → node-cron, her gün UTC 02:00, hata uygulamayı durdurmamalı
└── routes/
    └── index.ts              → Tüm modül route'larını birleştir
```

---

## Veritabanı Şeması

```prisma
model User {
  id            String         @id @default(uuid()) @db.Uuid
  email         String         @unique @db.VarChar(255)
  password      String         @db.VarChar(512)
  role          Role
  projectId     String         @db.Uuid
  project       Project        @relation(fields: [projectId], references: [id], onDelete: Cascade)
  devices       Device[]
  groupMembers  GroupMember[]
  routingRules  RoutingRule[]  @relation("ReceiverRules")
  receivedOtps  OTPLog[]       @relation("ReceiverOtps")  // sahiplik kanıtı — deviceId'den bağımsız
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt
  @@index([email])
  @@index([projectId])
  @@map("users")
}

model Project {
  id        String          @id @default(uuid()) @db.Uuid
  name      String          @db.VarChar(100)
  apiKey    String          @unique @default(uuid()) @db.Uuid
  users     User[]
  otpLogs   OTPLog[]
  devices   Device[]
  groups    Group[]
  services  ServiceRegistry[]
  createdAt DateTime        @default(now())
  updatedAt DateTime        @updatedAt
  @@map("projects")
}

model Device {
  id           String    @id @default(uuid()) @db.Uuid
  secretHash   String    @db.VarChar(512)   // argon2id hash — plain secret asla saklanmaz
  platform     Platform
  deviceName   String?   @db.VarChar(100)   // receiver kayıt sırasında girer, opsiyonel ("İş Telefonum")
  phoneNumber  String?   @db.VarChar(32)    // receiver kayıt sırasında girer, opsiyonel —
                                             // SMS'ten OTOMATİK türetilmez, sadece kullanıcının
                                             // kendi beyanıdır. Developer'a "cihaz bilgisi" olarak gösterilir.
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

model Group {
  id          String         @id @default(uuid()) @db.Uuid
  name        String         @db.VarChar(100)   // admin tarafından konur, receiver'a görünür
  projectId   String         @db.Uuid
  project     Project        @relation(fields: [projectId], references: [id], onDelete: Cascade)
  members     GroupMember[]
  routingRules RoutingRule[] @relation("GroupRules")
  createdAt   DateTime       @default(now())
  @@index([projectId])
  @@map("groups")
}

model GroupMember {
  id        String   @id @default(uuid()) @db.Uuid
  groupId   String   @db.Uuid
  group     Group    @relation(fields: [groupId], references: [id], onDelete: Cascade)
  userId    String   @db.Uuid          // DEVELOPER rolünde bir User
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())
  @@unique([groupId, userId])
  @@index([userId])
  @@map("group_members")
}

// Servis Kayıt Defteri — hem aktif kuralları hem "henüz adlandırılmamış" (kova) satırları tutar
model ServiceRegistry {
  id              String   @id @default(uuid()) @db.Uuid
  name            String?  @db.VarChar(100)   // null = henüz adlandırılmadı (kova durumu)
  isActive        Boolean  @default(false)    // false = kova, true = kural olarak çalışıyor
  senderPattern   String?  @db.VarChar(255)   // senderRaw eşleştirme deseni (regex veya exact)
  keywordPattern  String?  @db.VarChar(255)   // serviceHint eşleştirme deseni (yedek sinyal)
  iconUrl         String?  @db.VarChar(500)
  projectId       String   @db.Uuid
  project         Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  lastSeenSender  String?  @db.VarChar(255)   // kova durumundayken en son görülen ham gönderici
  unmatchedCount  Int      @default(0)        // kova durumundayken kaç kez görüldü
  lastSeenAt      DateTime?
  routingRules    RoutingRule[]
  otpLogs         OTPLog[]
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@index([projectId])
  @@index([isActive])
  @@map("service_registry")
}

// Hangi receiver'ın hangi servisten gelen kodu kime (developer veya grup) gidecek
model RoutingRule {
  id          String          @id @default(uuid()) @db.Uuid
  receiverId  String          @db.Uuid
  receiver    User            @relation("ReceiverRules", fields: [receiverId], references: [id], onDelete: Cascade)
  serviceId   String          @db.Uuid
  service     ServiceRegistry @relation(fields: [serviceId], references: [id], onDelete: Cascade)
  targetType  RoutingTarget   // DEVELOPER | GROUP
  developerId String?         @db.Uuid        // targetType=DEVELOPER ise dolu
  groupId     String?         @db.Uuid        // targetType=GROUP ise dolu
  group       Group?          @relation("GroupRules", fields: [groupId], references: [id], onDelete: Cascade)
  isActive    Boolean         @default(true)
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt
  @@index([receiverId])
  @@index([serviceId])
  @@map("routing_rules")
}

// NOT: PostgreSQL'de düz @@unique([...]) NULL'ları "farklı" sayar — targetType=DEVELOPER
// kayıtlarında groupId hep NULL olduğundan aynı (receiver, servis, developer) tekrar
// eklenebilirdi. Bu yüzden migration'da @@unique yerine İKİ AYRI partial unique index
// raw SQL ile eklenir (Prisma migration dosyasına elle eklenir, schema.prisma'da ifade
// edilemez):
//
//   CREATE UNIQUE INDEX routing_rule_developer_unique
//     ON routing_rules (receiver_id, service_id, developer_id)
//     WHERE target_type = 'DEVELOPER';
//
//   CREATE UNIQUE INDEX routing_rule_group_unique
//     ON routing_rules (receiver_id, service_id, group_id)
//     WHERE target_type = 'GROUP';
//
// Bu DB seviyesi koruma, routing.service.ts'teki createRule'da yapılan açık "zaten var mı"
// kontrolünün YERİNE değil, ONUN YANINDA çalışır — çift katmanlı korunur.

model OTPLog {
  id            String           @id @default(uuid()) @db.Uuid
  encryptedCode String           @db.VarChar(512)  // iv:authTag:ciphertext (base64)
  source        Source
  projectId     String           @db.Uuid
  project       Project          @relation(fields: [projectId], references: [id], onDelete: Cascade)
  deviceId      String?          @db.Uuid          // izleme/analiz amaçlı — onDelete: SetNull
  device        Device?          @relation(fields: [deviceId], references: [id], onDelete: SetNull)
  receiverId    String           @db.Uuid          // SAHİPLİK KAYNAĞI — deviceId silinse bile kalıcı,
  receiver      User             @relation("ReceiverOtps", fields: [receiverId], references: [id], onDelete: Cascade)
  serviceId     String?          @db.Uuid          // çözümlenen servis — null ise hiç çözülemedi
  service       ServiceRegistry? @relation(fields: [serviceId], references: [id], onDelete: SetNull)
  sharingActive Boolean          @default(true)    // receiver bu OTP'nin paylaşımını durdurabilir
  createdAt     DateTime         @default(now())
  expiresAt     DateTime
  @@index([projectId])
  @@index([expiresAt])
  @@index([deviceId])
  @@index([receiverId])
  @@index([serviceId])
  @@map("otp_logs")
}

enum Role          { RECEIVER DEVELOPER ADMIN }
enum Source        { ANDROID IOS_SHORTCUT }
enum Platform      { ANDROID IOS }
enum RoutingTarget { DEVELOPER GROUP }
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

POST   /api/devices/register  → Body: { deviceName?, phoneNumber? } (ikisi de opsiyonel)
                                 → 201 { deviceId, deviceSecret }   [JWT — RECEIVER]
DELETE /api/devices/:id       → 200 { message }                  [JWT — RECEIVER, sahibi]
GET    /api/devices           → 200 Device[] (secretHash hariç, deviceName/phoneNumber dahil) [JWT — RECEIVER]

POST /api/otp                 → 200 { message, deliveredTo }   [Device Secret — X-Device-Secret header]
GET  /api/otp/history         → 200 paginated OTPLog[]         [JWT — DEVELOPER]
PATCH /api/otp/:id/sharing    → 200 { sharingActive }          [JWT — RECEIVER, OTP'nin sahibi]
GET  /api/otp/:id/sharing     → 200 { targets: [...] }         [JWT — RECEIVER, salt-okunur, kimlerle paylaşılıyor]

POST   /api/projects               → 201 Project               [JWT — ADMIN]
GET    /api/projects/:id           → 200 Project + users       [JWT — üye]
POST   /api/projects/:id/users     → 200                       [JWT — ADMIN]
DELETE /api/projects/:id/users/:uid→ 200                       [JWT — ADMIN]

POST   /api/groups                 → 201 Group                 [JWT — ADMIN]
GET    /api/groups                 → 200 Group[] (proje bazlı) [JWT — herkes, sadece görüntüleme]
POST   /api/groups/:id/members     → 200                       [JWT — ADMIN]
DELETE /api/groups/:id/members/:uid→ 200                       [JWT — ADMIN]

POST   /api/routing-rules          → 201 RoutingRule           [JWT — ADMIN]
GET    /api/routing-rules          → 200 RoutingRule[]         [JWT — ADMIN]
PATCH  /api/routing-rules/:id      → 200 { isActive }          [JWT — ADMIN]
DELETE /api/routing-rules/:id      → 200 { message }           [JWT — ADMIN]

POST   /api/service-registry            → 201 ServiceRegistry  [JWT — ADMIN] (yeni kural veya kovayı aktive et)
GET    /api/service-registry            → 200 ServiceRegistry[] (hem aktif hem inaktif/kova) [JWT — ADMIN]
GET    /api/service-registry/unmatched  → 200 ServiceRegistry[] (sadece isActive:false) [JWT — ADMIN]
PATCH  /api/service-registry/:id        → 200                  [JWT — ADMIN] (isim/kural güncelle, aktive et)
DELETE /api/service-registry/:id        → 200 { message }      [JWT — ADMIN]

GET /health                   → 200 { status: 'ok', timestamp }
```

### POST /api/otp — Body Değişikliği (FAZ 8)
```
ÖNCE:  { smsText?: string, code?: string, source: 'ANDROID'|'IOS_SHORTCUT' }
SONRA: { code: string, source: 'ANDROID'|'IOS_SHORTCUT',
         senderRaw: string, serviceHint?: string }
```
`smsText` body'den TAMAMEN KALDIRILDI — FAZ 8'de parse yeri kararı cihaz tarafına verildi
(bkz. "Proje" bölümündeki "Parse yeri kararı" notu). `code` artık zorunlu (önceden opsiyoneldi,
`smsText` ile birlikte alternatifti). `senderRaw` zorunlu hale gelir — servis çözümlemesinin
birincil sinyalidir. `serviceHint` opsiyoneldir.

---

## Güvenlik Kuralları

1. **JWT** — access: 15dk, refresh: 30gün. İki secret FARKLI olmalı. Sadece kullanıcı oturumu (login/dashboard/history/admin işlemleri) için.
2. **Device Secret** — `crypto.randomBytes(32)` ile üret (256-bit), hex string olarak döndür. DB'de argon2id ile hash'lenir, plain text asla saklanmaz. Süresiz — sadece manuel revoke ile geçersiz olur. Sadece `POST /api/otp` yetkisi var, başka hiçbir endpointe erişemez.
3. **Parola** — argon2id: `{ memoryCost: 65536, timeCost: 3, parallelism: 4 }`. Plain text asla loglama. Aynı parametreler Device Secret hash'leme için de kullanılır.
4. **AES-256-GCM** — Her encrypt için `crypto.randomBytes(16)` IV. Format: `base64(iv):base64(authTag):base64(ciphertext)`. Decrypt'te her bileşeni parse et, boyut doğrula (IV=16 byte, authTag=16 byte), `decipher.final()` try/catch zorunlu — hata → OtpEncryptionError.
5. **SMS gövdesi asla saklanmaz** — sadece parse edilen 6 haneli kod (şifreli) ve servis çözümleme sinyalleri (`senderRaw`, `serviceHint`) işlenir, ham SMS metni DB'ye hiçbir zaman yazılmaz.
6. **Rate limiting** — `/api/otp`: 60/dk | `/api/auth/login`: 10/dk | `/api/auth/register`: 5/dk | `/api/devices/register`: 5/dk.
7. **Yetkilendirme** — RoutingRule, Group ve ServiceRegistry yönetimi sadece ADMIN rolüne açık. Receiver kendi OTP'sinin paylaşım hedefini görebilir ama değiştiremez, sadece `sharingActive` toggle'ına dokunabilir.
8. **HTTP** — `helmet()`, `express.json({ limit: '10kb' })`, CORS whitelist.
9. **Loglama** — Parola, OTP kodu, JWT token, Device Secret, senderRaw asla loglanmaz (pino redact).

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
OTP_ENCRYPTION_KEY=         # 64 hex karakter (32 byte)
OTP_TTL_DAYS=7
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=60
DEVICE_SECRET_BYTES=32      # 256-bit
SERVICE_REGISTRY_CACHE_TTL_MS=60000   # ServiceRegistry kurallarının in-memory cache ömrü
```

---


---

## Faz Detayları

Faz faz görev listeleri, tamamlanma kriterleri ve test kapsamları **PHASES.md** dosyasındadır.
Bu dosya (CLAUDE.md) sabit mimari kararları taşır — her oturumda oku. PHASES.md'yi şu an
üzerinde çalıştığın faz için oku, geçmiş fazları referans amacıyla kullan.